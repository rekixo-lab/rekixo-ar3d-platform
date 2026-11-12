import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {DatabaseSync} from "node:sqlite";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
function helper(){
  const code=ts.transpileModule(read("app/metro-block-assignment.ts"),{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exported={};
  new Function("exports",code)(exported);
  return exported;
}
test("recognized Block A/B/C plot labels and unusual IDs are distinguished safely",()=>{
  const {suggestedMetroBlock,previewMetroAssignments}=helper();
  for(const id of ["1","009","A-1","A10","a 12"])assert.equal(suggestedMetroBlock(id),"a");
  for(const id of ["B-1","b17","B 19","B_23"])assert.equal(suggestedMetroBlock(id),"b");
  for(const id of ["C-1","c277","C 31"])assert.equal(suggestedMetroBlock(id),"c");
  for(const id of ["B-19/B-20","Commercial Shop","Plot-12","A 1 + A 2"]){
    assert.equal(suggestedMetroBlock(id),null);
  }
  const preview=previewMetroAssignments([{id:"1"},{id:"B-2"},{id:"C-3"},{id:"B-19/B-20"}]);
  assert.deepEqual(preview,{total:4,autoAssigned:3,counts:{a:1,b:1,c:1},unknown:["B-19/B-20"]});
});
test("initialization cannot guess, omit, duplicate, or overwrite unknown IDs",()=>{
  const {completeMetroAssignments}=helper();
  const plots=[{id:"1"},{id:"B-2"},{id:"C-3"},{id:"B-19/B-20"},{id:"Commercial 4"}];
  for(const overrides of [
    [],
    [{plotId:"B-19/B-20",block:"b"}],
    [{plotId:"B-19/B-20",block:"b"},{plotId:"B-19/B-20",block:"b"}],
    [{plotId:"B-19/B-20",block:"b"},{plotId:"Commercial 4",block:"z"}],
    [{plotId:"B-19/B-20",block:"b"},{plotId:"Commercial 4",block:"c"},{plotId:"1",block:"c"}],
  ])assert.equal(completeMetroAssignments(plots,overrides).ok,false);
  const result=completeMetroAssignments(plots,[
    {plotId:"B-19/B-20",block:"b"},
    {plotId:"Commercial 4",block:"a"},
  ]);
  assert.equal(result.ok,true);
  assert.deepEqual(result.assignments.map(x=>[x.plotId,x.block]),[
    ["1","a"],["B-2","b"],["C-3","c"],["B-19/B-20","b"],["Commercial 4","a"]
  ]);
  assert.deepEqual(result.counts,{a:2,b:2,c:1});
});
test("702 active inventory assignments are complete, bound, unique and do not touch canonical inventory",()=>{
  const {completeMetroAssignments}=helper();
  const db=new DatabaseSync(":memory:");
  try{
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE plots(project_id TEXT,id TEXT,status TEXT,polygon TEXT,PRIMARY KEY(project_id,id));");
    db.prepare("INSERT INTO projects VALUES ('metro')").run();
    const plots=[];
    for(let i=1;i<=702;i++){
      const id=i<=267?String(i):i<=426?"B-"+(i-267):i===427?"Commercial-Gate":"C-"+(i-427);
      plots.push({id});
      db.prepare("INSERT INTO plots VALUES ('metro',?,?,?)").run(id,i%2?"available":"booked","legacy");
    }
    db.exec(read("drizzle/0048_metro_city_multi_block.sql"));
    db.exec(read("drizzle/0049_metro_block_draft_side_bindings.sql"));
    const result=completeMetroAssignments(plots,[{plotId:"Commercial-Gate",block:"b"}]);
    assert.equal(result.ok,true);
    db.exec("BEGIN TRANSACTION");
    db.prepare("INSERT INTO metro_block_plot_maps(project_id,plot_id,block_key,polygon,side_bindings,updated_at) SELECT ?,json_extract(item.value,'$.plotId'),json_extract(item.value,'$.block'),'','',? FROM json_each(?) AS item")
      .run("metro","now",JSON.stringify(result.assignments));
    db.exec("COMMIT");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM metro_block_plot_maps").get().n,702);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plots WHERE polygon='legacy'").get().n,702);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plots WHERE status IN ('available','booked')").get().n,702);
    assert.equal(db.prepare("SELECT COUNT(DISTINCT plot_id) AS n FROM metro_block_plot_maps").get().n,702);
  }finally{db.close()}
});
test("UI prevents initialization until unusual plot IDs are explicitly reviewed",()=>{
 const page=read("app/admin/metro-blocks/metro-block-mapper.tsx");
 const api=read("app/api/admin/metro-blocks/route.ts");
 assert.match(page,/assignmentPreview\.unknown/);
 assert.match(page,/disabled=\{busy\|\|unresolved\.length>0\}/);
 assert.match(page,/Choose block/);
 assert.match(page,/Not initialized/);
 assert.match(api,/completeMetroAssignments\(d\.plots,body\.assignments\|\|\[\]\)/);
 assert.match(api,/await env\.DB\.batch\(statements\)/);
 assert.match(api,/INSERT INTO metro_block_plot_maps/);
 const advanced=read("app/api/admin/metro-blocks/advanced/route.ts");
 const editor=read("app/plot-mapper.tsx");
 assert.ok(editor.includes("plots.find(p=>p.id===plotId)?.id"));
 assert.ok(advanced.includes("id.length>80"));
 assert.ok(advanced.includes("combined labels are allowed"));
 assert.ok(api.includes("FROM json_each(?) AS item"));
 assert.ok(api.includes("THEN draft_revision+1 ELSE -1 END"));
 assert.doesNotMatch(api,/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:plots|published_plots|property_sales|plot_admin_details)\b/i);
});
