import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../drizzle/0048_metro_city_multi_block.sql",import.meta.url),"utf8");
function fixture(){
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects (id TEXT PRIMARY KEY,slug TEXT,public_status TEXT,status TEXT); CREATE TABLE plots (project_id TEXT NOT NULL,id TEXT NOT NULL,sqft REAL,status TEXT,polygon TEXT,inventory_active INTEGER,PRIMARY KEY(project_id,id));");
  db.prepare("INSERT INTO projects VALUES ('metro','metro-city-c024a5','published','active')").run();
  for(const [id,status] of [["1","available"],["2","booked"],["B-1","sold"],["C-1","available"]]){
    db.prepare("INSERT INTO plots VALUES (?,?,?,?,?,1)").run("metro",id,1000,status,"[[0.1,0.1],[0.2,0.1],[0.2,0.2]]");
  }
  db.exec(migration);
  return db;
}
test("migration creates four isolated block structures without rewriting live plot statuses",()=>{
 const db=fixture();
 try{
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'metro_block_%' ORDER BY name").all().map(r=>r.name);
  assert.deepEqual(tables,["metro_block_assets","metro_block_plot_maps","metro_block_published_maps","metro_block_state"]);
  assert.deepEqual(db.prepare("SELECT id,status FROM plots ORDER BY id").all().map(r=>[r.id,r.status]),[["1","available"],["2","booked"],["B-1","sold"],["C-1","available"]]);
 }finally{db.close()}
});
test("assignment is one-to-one by canonical plot ID and block draft updates never alter inventory",()=>{
 const db=fixture();
 try{
  db.prepare("INSERT INTO metro_block_state(project_id,public_enabled,version,updated_at) VALUES ('metro',0,0,'now')").run();
  db.prepare("INSERT INTO metro_block_plot_maps(project_id,plot_id,block_key,polygon,updated_at) SELECT project_id,id,CASE WHEN UPPER(id) LIKE 'B-%' OR UPPER(id) GLOB 'B[0-9]*' THEN 'b' WHEN UPPER(id) LIKE 'C-%' OR UPPER(id) GLOB 'C[0-9]*' THEN 'c' ELSE 'a' END,'','now' FROM plots WHERE project_id='metro' AND inventory_active=1").run();
  assert.deepEqual(db.prepare("SELECT block_key,COUNT(*) AS total FROM metro_block_plot_maps GROUP BY block_key ORDER BY block_key").all().map(r=>[r.block_key,r.total]),[["a",2],["b",1],["c",1]]);
  assert.throws(()=>db.prepare("INSERT INTO metro_block_plot_maps(project_id,plot_id,block_key,polygon,updated_at) VALUES ('metro','1','b','','now')").run());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plots").get().n,4);
  db.prepare("UPDATE metro_block_plot_maps SET polygon='[[0.1,0.1],[0.2,0.1],[0.2,0.2]]'").run();
  db.prepare("INSERT INTO metro_block_published_maps SELECT project_id,plot_id,block_key,polygon FROM metro_block_plot_maps").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM metro_block_published_maps").get().n,4);
  db.prepare("UPDATE metro_block_plot_maps SET polygon='' WHERE plot_id='1'").run();
  assert.notEqual(db.prepare("SELECT polygon FROM metro_block_published_maps WHERE plot_id='1'").get().polygon,"");
 }finally{db.close()}
});
test("publish revision mismatch cannot turn public flag on",()=>{
 const db=fixture();
 try{
  db.prepare("INSERT INTO metro_block_state(project_id,public_enabled,version,draft_revision,updated_at) VALUES ('metro',0,0,4,'now')").run();
  assert.throws(()=>db.prepare("UPDATE metro_block_state SET public_enabled=CASE WHEN draft_revision=? AND version=? THEN 1 ELSE -1 END,version=?,updated_at=? WHERE project_id=?").run(3,0,1,"now","metro"));
  assert.equal(db.prepare("SELECT public_enabled AS enabled,version FROM metro_block_state").get().enabled,0);
  assert.equal(db.prepare("SELECT version FROM metro_block_state").get().version,0);
 }finally{db.close()}
});
