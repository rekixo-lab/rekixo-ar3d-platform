import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {DatabaseSync} from "node:sqlite";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
function geometry(){
  const s=ts.transpileModule(read("app/metro-block-safe-geometry.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function("exports",s)(exports);return exports;
}
test("advanced mapper is reachable only by fixed Metro project, block, Super Admin and same-origin checks",()=>{
  const api=read("app/api/admin/metro-blocks/advanced/route.ts");
  assert.match(api,/requireSuperAdmin\(\)/);
  assert.match(api,/sameOrigin\(request\)/);
  assert.match(api,/body\.projectId!==PROJECT/);
  assert.match(api,/metroBlockKey\(body\.block\)/);
  assert.match(api,/m\.block_key=\?/);
  assert.match(api,/p\.inventory_active=1/);
  assert.match(api,/AND polygon=\?/);
  assert.doesNotMatch(api,/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:plots|published_plots|project_public_snapshots|property_sales|plot_admin_details)\b/i);
  assert.match(api,/metro_block_plot_maps SET polygon=/);
  assert.match(api,/side_bindings=/);
});
test("legacy mapper's save route remains canonical only when blockMode is absent",()=>{
  const s=read("app/plot-mapper.tsx");
  assert.match(s,/blockMode\?"\/api\/admin\/metro-blocks\/advanced":"\/api\/super-mapper"/);
  assert.match(s,/if\(blockMode\)return notify\("Block Mode: Bulk sides disabled/);
  assert.match(s,/if\(blockMode\)return notify\("Block Mode में Clear All/);
  assert.match(s,/\{!controlsWorkspace && !blockMode && \(/);
  assert.match(s,/disabled=\{blockMode\}/);
  assert.match(s,/mappingDraftKey\(projectId, verified\.plot\.id\)/);
  assert.match(s,/rekixo:mapper-rotation:\$\{projectId\}/);
  assert.match(s,/const blockEditorUrl = blockKey/);
  assert.match(s,/if\(blockMode&&existing\)/);
  assert.match(s,/onDraftChanged\?\.\(\)/);
});
test("block-only source image probe never reads canonical masterplan",()=>{
 const image=read("app/api/admin/metro-blocks/image/route.ts");
 assert.match(image,/requireSuperAdmin/);
 assert.match(image,/draft_object_key AS objectKey/);
 assert.match(image,/searchParams\.get\("inspect"\)==="1"/);
 assert.doesNotMatch(image,/projects\/\$\{.*\}\/mapper\/masterplan/);
});
test("polygon validator rejects crossing, degeneracy, out of bounds and malformed side edges",()=>{
 const {safeBlockPolygon,encodeBlockSides,readBlockSides}=geometry();
 const quad=[[.1,.1],[.4,.1],[.4,.4],[.1,.4]];
 assert.deepEqual(JSON.parse(safeBlockPolygon(quad)),quad);
 assert.equal(safeBlockPolygon([[.1,.1],[.4,.4],[.1,.4],[.4,.1]]),null);
 assert.equal(safeBlockPolygon([[.1,.1],[.1,.1],[.4,.4]]),null);
 assert.equal(safeBlockPolygon([[.1,.1],[1.1,.1],[.4,.4]]),null);
 assert.equal(encodeBlockSides({frontEdgeIndex:6,edgeSemantics:""},4),null);
 const data=encodeBlockSides({frontEdgeIndex:0,backEdgeIndex:2,depthEdgeIndex:1,depth2EdgeIndex:3,edgeSemantics:""},4);
 assert.equal(readBlockSides(data).frontEdgeIndex,0);
});
test("published block geometry keeps per-block side bindings; other projects retain original source paths",()=>{
 const api=read("app/api/public-data/route.ts"),blocks=read("app/metro-blocks.ts");
 const schema=read("drizzle/0049_metro_block_draft_side_bindings.sql");
 const publish=read("app/api/admin/metro-blocks/route.ts");
 assert.match(api,/blockSidesByPlot/);
 assert.match(api,/readBlockSides\(m\.sideBindings\)/);
 assert.match(blocks,/side_bindings AS sideBindings/);
 assert.match(publish,/polygon,side_bindings\) SELECT project_id,plot_id,block_key,polygon,side_bindings/);
 assert.doesNotMatch(schema,/(?:ALTER TABLE|UPDATE|DELETE FROM)\s+plots\b/i);
 const db=new DatabaseSync(":memory:");
 try{
   db.exec("CREATE TABLE metro_block_plot_maps(project_id TEXT,plot_id TEXT,block_key TEXT,polygon TEXT,PRIMARY KEY(project_id,plot_id));CREATE TABLE metro_block_published_maps(project_id TEXT,plot_id TEXT,block_key TEXT,polygon TEXT,PRIMARY KEY(project_id,plot_id));");
   db.exec(schema);
   db.prepare("INSERT INTO metro_block_plot_maps VALUES (?,?,?,?,?)").run("metro","A-1","a","[[0,0],[.5,0],[0,.5]]",'{"frontEdgeIndex":0}');
   db.prepare("INSERT INTO metro_block_published_maps(project_id,plot_id,block_key,polygon,side_bindings) SELECT project_id,plot_id,block_key,polygon,side_bindings FROM metro_block_plot_maps").run();
   assert.equal(db.prepare("SELECT side_bindings AS sideBindings FROM metro_block_published_maps").get().sideBindings,'{"frontEdgeIndex":0}');
 }finally{db.close()}
});
