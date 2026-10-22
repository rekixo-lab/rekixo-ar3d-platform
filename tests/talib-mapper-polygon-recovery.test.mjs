import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const sql=readFileSync(new URL('../scripts/sql/restore-talib-published-polygons-to-draft-once.sql',import.meta.url),'utf8');
const pid='e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE projects (id TEXT,name TEXT,slug TEXT,status TEXT,public_status TEXT,publish_version INT)");
  db.exec("CREATE TABLE project_public_snapshots (project_id TEXT,publish_version INT)");
  db.exec("CREATE TABLE settings (project_id TEXT,key TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(project_id,key))");
  db.exec("CREATE TABLE published_settings (project_id TEXT,key TEXT,value TEXT)");
  db.exec("CREATE TABLE plots (project_id TEXT,id TEXT,sqft REAL,polygon TEXT,inventory_active INT,front_edge_index INT,back_edge_index INT,depth_edge_index INT,depth2_edge_index INT,edge_semantics TEXT,updated_at TEXT,PRIMARY KEY(project_id,id))");
  db.exec("CREATE TABLE published_plots (project_id TEXT,id TEXT,polygon TEXT,front_edge_index INT,back_edge_index INT,depth_edge_index INT,depth2_edge_index INT,edge_semantics TEXT,PRIMARY KEY(project_id,id))");
  db.exec("CREATE TABLE plot_edge_measurements (project_id TEXT,plot_id TEXT,role TEXT,segment_index INT,edge_index INT,point_count INT,updated_at TEXT)");
  db.exec("CREATE TABLE published_plot_edge_measurements (project_id TEXT,plot_id TEXT,role TEXT,segment_index INT,edge_index INT,point_count INT)");
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?)').run(pid,'TALIB NAZAMI ALAM  PLOTING','talib-nazami-alam-ploting-e94cec','active','published',2);
  db.prepare('INSERT INTO project_public_snapshots VALUES (?,?)').run(pid,2);
  for (const [key,value] of Object.entries({masterplanName:'1_2 - Photo.jpg.mapping.webp',mapWidth:'4096',mapHeight:'2304',publicRotation:'1'})){
    db.prepare('INSERT INTO settings VALUES (?,?,?,?)').run(pid,key,value,'2026-10-22');
  }
  for (const [key,value] of Object.entries({mapWidth:'4096',mapHeight:'2304',publicRotation:'1'})){
    db.prepare('INSERT INTO published_settings VALUES (?,?,?)').run(pid,key,value);
  }
  for(let n=1;n<=37;n++){
    const poly=JSON.stringify([[n/200,.1],[n/200+.03,.1],[n/200+.03,.16],[n/200,.16]]);
    db.prepare('INSERT INTO published_plots VALUES (?,?,?,?,?,?,?,?)').run(pid,String(n),poly,0,2,1,3,'{"version":1}');
    db.prepare('INSERT INTO published_plot_edge_measurements VALUES (?,?,?,?,?,?)').run(pid,String(n),'front',0,0,4);
    if(n<=36){
      const area=n===32?2741.25:n===36?5730.53:2000+n;
      db.prepare('INSERT INTO plots VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(pid,String(n),area,'',1,null,null,null,null,null,'2026-10-22');
      db.prepare('INSERT INTO plot_edge_measurements VALUES (?,?,?,?,?,?,?)').run(pid,String(n),'front',0,null,null,'2026-10-22');
    }
  }
  return db;
}
test('recovers 36 draft polygons from 37 published; remaps 33→32 and 37→36 without touching live',()=>{
  const db=fixture();
  const before=db.prepare('SELECT id,sqft,polygon FROM plots WHERE project_id=? AND id=?').get(pid,'32');
  const published32=db.prepare('SELECT polygon FROM published_plots WHERE project_id=? AND id=?').get(pid,'32').polygon;
  db.exec(sql);
  const data=db.prepare('SELECT id,sqft,polygon,front_edge_index,back_edge_index FROM plots WHERE project_id=? ORDER BY CAST(id AS INTEGER)').all(pid);
  assert.equal(data.length,36);
  assert.equal(data.filter(r=>r.polygon).length,36);
  assert.equal(data[31].sqft,before.sqft);
  assert.notEqual(data[31].polygon,published32);
  assert.equal(data[31].polygon,db.prepare('SELECT polygon FROM published_plots WHERE id=? AND project_id=?').get('33',pid).polygon);
  assert.equal(data[35].polygon,db.prepare('SELECT polygon FROM published_plots WHERE id=? AND project_id=?').get('37',pid).polygon);
  assert.equal(data[31].front_edge_index,0);
  assert.equal(data[31].back_edge_index,2);
  assert.equal(db.prepare('SELECT edge_index FROM plot_edge_measurements WHERE project_id=? AND plot_id=?').get(pid,'32').edge_index,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM published_plots WHERE project_id=?').get(pid).n,37);
  assert.equal(db.prepare('SELECT value FROM settings WHERE project_id=? AND key=?').get(pid,'mapperPolygonRecoverySource').value,'published-v2-37-to-36-editor-only-20261022');
  assert.throws(()=>db.exec(sql),/CHECK constraint failed/);
  db.close();
});
test('refuses to overwrite even one existing manually remapped polygon',()=>{
  const db=fixture();
  db.prepare('UPDATE plots SET polygon=? WHERE project_id=? AND id=?').run('[[0,0],[0.1,0],[0.1,0.1]]',pid,'7');
  assert.throws(()=>db.exec(sql),/CHECK constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plots WHERE project_id=? AND polygon<>?').get(pid,'').n,1);
  db.close();
});
