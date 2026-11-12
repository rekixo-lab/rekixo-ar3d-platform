import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import ts from "typescript";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
function transpile(path){
  return ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}
function loadModule(code,dependencies){
  const exports={};
  new Function("require","exports",code)((name)=>{
    if(!(name in dependencies))throw Error("Missing mock: "+name);
    return dependencies[name];
  },exports);
  return exports;
}
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT);
    CREATE TABLE settings(project_id TEXT,key TEXT,value TEXT,PRIMARY KEY(project_id,key));
    CREATE TABLE plots(
      project_id TEXT,id TEXT,inventory_active INTEGER,sqft REAL,sqm REAL,sqyd REAL,
      dimensions TEXT,road TEXT,front REAL,back REAL,depth REAL,depth2 REAL,
      dimension_unit TEXT,front_label TEXT,back_label TEXT,depth_label TEXT,depth2_label TEXT,
      side_dimensions TEXT,status TEXT,notes TEXT,featured INTEGER,polygon TEXT,
      PRIMARY KEY(project_id,id)
    );
    CREATE TABLE metro_block_plot_maps(
      project_id TEXT,plot_id TEXT,block_key TEXT,polygon TEXT NOT NULL DEFAULT '',
      side_bindings TEXT NOT NULL DEFAULT '',updated_at TEXT,
      PRIMARY KEY(project_id,plot_id)
    );
    CREATE TABLE metro_block_assets(project_id TEXT,block_key TEXT,draft_object_key TEXT,
      draft_width INTEGER,draft_height INTEGER,draft_filename TEXT,draft_north_angle REAL,
      draft_view_rotation INTEGER NOT NULL DEFAULT 0 CHECK(draft_view_rotation IN(0,1,2,3)),updated_at TEXT,
      PRIMARY KEY(project_id,block_key));
    CREATE TABLE metro_block_state(project_id TEXT PRIMARY KEY,public_enabled INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,draft_revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT);
  `);
  const project="c024a562-634d-4e49-b647-43209f6e450b";
  db.prepare("INSERT INTO projects VALUES (?,?,?,?)").run(project,"metro-city-c024a5","Metro City","active");
  db.prepare("INSERT INTO settings VALUES (?,?,?)").run(project,"sqmToSqftFactor","10.7639");
  db.prepare("INSERT INTO plots(project_id,id,inventory_active,sqft,sqm,sqyd,dimensions,road,front,back,depth,depth2,dimension_unit,front_label,back_label,depth_label,depth2_label,side_dimensions,status,notes,featured,polygon) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(project,"1",2400,223,266,"40 x 60","West Road",40,40,60,60,"ft","40 ft","40 ft","60 ft","60 ft","", "booked","existing sale",0,"[[0,0],[1,0],[1,1],[0,1]]");
  db.prepare("INSERT INTO metro_block_plot_maps VALUES (?,?,?,'','','now')").run(project,"1","a");
  db.prepare("INSERT INTO metro_block_assets(project_id,block_key,draft_object_key,draft_width,draft_height,draft_filename,draft_north_angle) VALUES (?,?,?,?,?,?,?)")
    .run(project,"a","draft/object",5376,3798,"Block A.jpg",90);
  db.prepare("INSERT INTO metro_block_state VALUES (?,0,0,2,'now')").run(project);
  const env={DB:{prepare(sql){return{bind(...values){
    const execute=()=>db.prepare(sql);
    return{
      first:async()=>execute().get(...values)||null,
      all:async()=>({results:execute().all(...values)}),
      run:async()=>({meta:{changes:execute().run(...values).changes}}),
    };
  }}}}};
  const geo=loadModule(transpile("app/metro-block-safe-geometry.ts"),{});
  const routes=loadModule(transpile("app/api/admin/metro-blocks/advanced/route.ts"),{
    "cloudflare:workers":{env},
    "@/modules/auth":{requireSuperAdmin:async()=>({userId:"test"}),sameOrigin:()=>true},
    "@/modules/audit":{writeAudit:async()=>{}},
    "@/app/metro-blocks":{METRO_BLOCK_PROJECT_ID:project,metroBlockKey:key=>key==="a"?key:null},
    "@/app/metro-block-safe-geometry":geo,
  });
  const url=`https://admin.rekixo.com/api/admin/metro-blocks/advanced?projectId=${project}&block=a`;
  const request=(body)=>new Request(url,{method:"POST",headers:{"content-type":"application/json",origin:"https://admin.rekixo.com"},body:JSON.stringify(body)});
  return {db,project,routes,url,request};
}
test("METRO Block A Plot 1 confirms four corners with Front/Back/Depth roles and survives server reload",async()=>{
 const {db,project,routes,url,request}=fixture();
 try{
  const readBefore=await (await routes.GET(new Request(url))).json();
  assert.equal(readBefore.plots.length,1);
  assert.equal(readBefore.plots[0].polygon,"");
  assert.equal(readBefore.settings.blockViewRotation,"0");
  const rotate=await routes.POST(request({projectId:project,block:"a",action:"rotation",rotation:1}));
  assert.equal(rotate.status,200,await rotate.text());
  const reloadedView=await (await routes.GET(new Request(url))).json();
  assert.equal(reloadedView.settings.blockViewRotation,"1");
  assert.equal(reloadedView.plots[0].polygon,"");
  assert.equal(db.prepare("SELECT draft_revision AS revision FROM metro_block_state").get().revision,2,"rotation must not mutate mapping revision");
  const polygon=JSON.stringify([[0.12,0.2],[0.12,0.34],[0.3,0.34],[0.3,0.2]]);
  const semantics=JSON.stringify({version:1,pointCount:4,layout:"four",roles:{front:[0],depthA:[1],back:[2],depthB:[3]}});
  const input={projectId:project,block:"a",action:"save",
    expectedPolygon:"",expectedBindings:"",
    plot:{id:"1",polygon,frontEdgeIndex:0,backEdgeIndex:2,depthEdgeIndex:1,depth2EdgeIndex:3,edgeSemantics:semantics}
  };
  const controlId={...input,plot:{...input.plot,id:"1"+String.fromCharCode(1)}};
  const rejected=await routes.POST(request(controlId));
  assert.equal(rejected.status,400,"Actual control characters must still be rejected");
  const response=await routes.POST(request(input));
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.ok,true);
  assert.equal(result.plot.polygon,polygon);
  assert.equal(result.plot.frontEdgeIndex,0);
  assert.equal(result.plot.backEdgeIndex,2);
  assert.equal(result.plot.depthEdgeIndex,1);
  assert.equal(result.plot.depth2EdgeIndex,3);
  const readAfter=await (await routes.GET(new Request(url))).json();
  assert.deepEqual(readAfter.plots[0],result.plot);
  assert.equal(db.prepare("SELECT status FROM plots WHERE id='1'").get().status,"booked");
  assert.equal(db.prepare("SELECT polygon FROM plots WHERE id='1'").get().polygon,"[[0,0],[1,0],[1,1],[0,1]]");
  assert.equal(db.prepare("SELECT public_enabled FROM metro_block_state").get().public_enabled,0);
  const stale=await routes.POST(request(input));
  assert.equal(stale.status,409);
  const savedPolygon=result.plot.polygon,savedBindings=result.plot.blockSideRevision;
  const clear=await routes.POST(request({projectId:project,block:"a",action:"clear",
     plot:{id:"1"},expectedPolygon:savedPolygon,expectedBindings:savedBindings}));
  assert.equal(clear.status,200,await clear.text());
  assert.equal(db.prepare("SELECT polygon FROM metro_block_plot_maps").get().polygon,"");
 }finally{db.close()}
});
test("block mode shows save errors and success inline at the zoomed map, but no changes to generic mapper save",()=>{
 const s=read("app/plot-mapper.tsx");
 assert.match(s,/data-testid="metro-block-save-feedback"/);
 assert.match(s,/blockSaveFeedback\.kind === "error" \? "alert" : "status"/);
 assert.match(s,/Plot \$\{id\} NOT SAVED/);
 assert.match(s,/SERVER VERIFIED/);
 assert.match(s,/if\(blockMode\)/);
 assert.match(s,/blockMode\?"\/api\/admin\/metro-blocks\/advanced":"\/api\/super-mapper"/);
});
