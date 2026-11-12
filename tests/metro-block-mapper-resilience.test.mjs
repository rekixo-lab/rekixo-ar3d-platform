import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import ts from "typescript";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const compile=p=>ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function moduleWith(code,deps){const exported={};new Function("require","exports",code)(name=>{if(!(name in deps))throw Error("unexpected dependency "+name);return deps[name]},exported);return exported;}

test("METRO Block A rotation persists from server, never the shared project publicRotation zero",()=>{
 const mapper=read("app/plot-mapper.tsx"),api=read("app/api/admin/metro-blocks/advanced/route.ts");
 assert.ok(mapper.includes("METRO block view must NOT be overwritten by publicRotation=0"));
 assert.match(mapper,/normalizeQuarterTurn\(settings\.blockViewRotation\)/);
 assert.match(mapper,/setSettings\(current=>\(\{\.\.\.current,blockViewRotation:String\(next\)\}\)\)/);
 assert.match(mapper,/if\(!blockKey\)return;/);
 assert.match(mapper,/action:"rotation",rotation:next/);
 assert.match(mapper,/const blockViewCanConfirm=!blockMode/);
 assert.match(mapper,/blockRotationPendingRef\.current/);
 assert.match(mapper,/data-testid="metro-block-rotation-status"/);
 assert.match(api,/draft_view_rotation AS viewRotation/);
 assert.match(api,/blockViewRotation:String\(asset\?\.viewRotation\?\?0\)/);
 assert.match(api,/UPDATE metro_block_assets SET draft_view_rotation=/);
 assert.doesNotMatch(api,/UPDATE plots SET|UPDATE project_public_snapshots SET|UPDATE settings SET/);
 const migration=read("drizzle/0050_metro_block_draft_resilience.sql");
 assert.match(migration,/ALTER TABLE metro_block_assets/);
 assert.doesNotMatch(migration,/ALTER TABLE plots|UPDATE plots|ALTER TABLE project_public_snapshots/);
});
test("every 90 degree view roundtrip preserves normalized source polygon vertices",()=>{
 const toSource=(r,[x,y])=>r===1?[y,1-x]:r===2?[1-x,1-y]:r===3?[1-y,x]:[x,y];
 const toDisplay=(r,[x,y])=>r===1?[1-y,x]:r===2?[1-x,1-y]:r===3?[y,1-x]:[x,y];
 for(const r of [0,1,2,3])for(const vertex of [[0.011,0.91],[0.25,0.75],[0.9,0.15],[0.33,0.24]]){
   const roundtrip=toSource(r,toDisplay(r,vertex));
   assert.ok(roundtrip.every((v,i)=>Math.abs(v-vertex[i])<1e-12));
 }
 const mapper=read("app/plot-mapper.tsx");
 assert.match(mapper,/polygon: JSON\.stringify\(points\)/);
 assert.match(mapper,/return sourcePointFromDisplay\(visual\)/);
});
test("private R2 checkpoint includes current image and exact side roles, leaves draft unchanged",async()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(`CREATE TABLE metro_block_state(project_id TEXT PRIMARY KEY,draft_revision INTEGER);
  CREATE TABLE metro_block_assets(project_id TEXT,block_key TEXT,draft_object_key TEXT,draft_filename TEXT,draft_width INTEGER,draft_height INTEGER,draft_north_angle REAL,draft_view_rotation INTEGER);
  CREATE TABLE metro_block_plot_maps(project_id TEXT,block_key TEXT,plot_id TEXT,polygon TEXT,side_bindings TEXT);
  CREATE TABLE metro_block_draft_backups(id TEXT PRIMARY KEY,project_id TEXT,block_key TEXT,object_key TEXT,mapped_plots INTEGER,draft_revision INTEGER,reason TEXT,created_at TEXT);`);
  db.prepare("INSERT INTO metro_block_state VALUES ('metro',17)").run();
  db.prepare("INSERT INTO metro_block_assets VALUES ('metro','a','r2/source','masterplan.jpg',5376,3798,90,1)").run();
  db.prepare("INSERT INTO metro_block_plot_maps VALUES ('metro','a','1',?,?)").run("[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]",'{"frontEdgeIndex":0,"edgeSemantics":"sem"}');
  const stored=new Map();
  const env={
   DB:{prepare(sql){return{bind(...values){
    const stmt=()=>db.prepare(sql);
    return{first:async()=>stmt().get(...values)||null,all:async()=>({results:stmt().all(...values)}),
      run:async()=>({meta:{changes:stmt().run(...values).changes}})};
   }}}},
   BUCKET:{put:async(key,value)=>{stored.set(key,new TextEncoder().encode(String(value)))},
     head:async key=>stored.has(key)?{size:stored.get(key).byteLength}:null},
  };
  const mod=moduleWith(compile("app/metro-block-draft-backup.ts"),{
   "cloudflare:workers":{env},"@/app/metro-blocks":{METRO_BLOCK_PROJECT_ID:"metro"},
  });
  const backup=await mod.createMetroBlockCheckpoint("a","before-image-replacement",17);
  assert.equal(backup.ok,true);
  assert.equal(backup.mapped,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metro_block_draft_backups").get().n,1);
  const payload=JSON.parse(new TextDecoder().decode(stored.get(backup.objectKey)));
  assert.equal(payload.asset.draft_view_rotation,undefined);
  assert.equal(payload.asset.viewRotation,1);
  assert.equal(payload.maps[0].plotId,"1");
  assert.match(payload.maps[0].sideBindings,/frontEdgeIndex/);
  assert.equal(db.prepare("SELECT polygon FROM metro_block_plot_maps").get().polygon,"[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]");
  const reject=await mod.createMetroBlockCheckpoint("a","before-image-replacement",16);
  assert.equal(reject.ok,false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metro_block_draft_backups").get().n,1);
 }finally{db.close()}
});
test("destructive image replacement requires a verified backup, exact typed confirmation and revision",()=>{
 const api=read("app/api/admin/metro-blocks/route.ts"),ui=read("app/admin/metro-blocks/metro-block-mapper.tsx");
 assert.match(api,/createMetroBlockCheckpoint\(block,"before-image-replacement",expectedRevision\)/);
 assert.match(api,/typed!==`REPLACE BLOCK \$\{block\.toUpperCase\(\)\}`/);
 assert.match(api,/draft_revision=CASE WHEN draft_revision=\? THEN draft_revision\+1 ELSE -1 END/);
 assert.match(api,/if\(!await env\.BUCKET\.head\(key\)\)/);
 assert.match(api,/if\(body\.action==="map"\)return json/);
 assert.match(api,/This plot is already mapped/);
 assert.match(ui,/Download Block \{block\.toUpperCase\(\)\} mapping JSON/);
 assert.match(ui,/Create private R2 checkpoint/);
 assert.match(ui,/sideBindings:m\.sideBindings/);
 assert.match(ui,/disabled=\{busy\|\|Boolean\(map\.polygon\)\}/);
});

test("publish refuses incomplete/duplicated sides and supports multi-segment irregular plot sides",()=>{
 const geometry=moduleWith(compile("app/metro-block-safe-geometry.ts"),{});
 const quad=JSON.stringify([[.1,.1],[.4,.1],[.4,.4],[.1,.4]]);
 const bindings=sem=>JSON.stringify({frontEdgeIndex:0,backEdgeIndex:2,depthEdgeIndex:1,depth2EdgeIndex:3,
   edgeSemantics:JSON.stringify(sem)});
 const valid={version:1,pointCount:4,layout:"four",roles:{front:[0],depthA:[1],back:[2],depthB:[3]}};
 assert.equal(geometry.blockPublishSideCoverage(quad,bindings(valid)),true);
 assert.equal(geometry.blockPublishSideCoverage(quad,""),false);
 assert.equal(geometry.blockPublishSideCoverage(quad,bindings({...valid,roles:{front:[0],depthA:[1],back:[1],depthB:[3]}})),false);
 const irregular=JSON.stringify([[.1,.1],[.4,.1],[.4,.3],[.3,.45],[.1,.3]]);
 const three={version:1,pointCount:5,layout:"three",roles:{front:[0],depthA:[1,2],back:[3,4]}};
 assert.equal(geometry.blockPublishSideCoverage(irregular,bindings(three)),true);
 const api=read("app/api/admin/metro-blocks/route.ts");
 const ui=read("app/admin/metro-blocks/metro-block-mapper.tsx");
 assert.match(api,/invalidSides=d\.maps\.find\(m=>!blockPublishSideCoverage/);
 assert.match(ui,/mappedSideReviewCount===0/);
});
