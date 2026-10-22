import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const sql=readFileSync(new URL('../scripts/sql/noorpur-remove-c6-c7-published-once.sql',import.meta.url),'utf8');
const admin=readFileSync(new URL('../app/api/data/route.ts',import.meta.url),'utf8');
const booking=readFileSync(new URL('../app/client-plot-management.tsx',import.meta.url),'utf8');
const pricing=readFileSync(new URL('../app/api/client/plot-pricing/route.ts',import.meta.url),'utf8');
const id='ca24581e-0dbc-41d7-964b-435c563534cd';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE projects (id TEXT,name TEXT,status TEXT,public_status TEXT,publish_version INT,published_at TEXT,updated_at TEXT)');
  db.exec('CREATE TABLE project_public_snapshots (project_id TEXT,publish_version INT,created_at TEXT)');
  db.exec('CREATE TABLE plots (project_id TEXT,id TEXT,status TEXT,inventory_active INT,polygon TEXT)');
  db.exec('CREATE TABLE published_plots (project_id TEXT,id TEXT,status TEXT,polygon TEXT)');
  db.exec('CREATE TABLE plot_admin_details (project_id TEXT,plot_id TEXT,owner_name TEXT,booking_amount_paise INT,broker_name TEXT)');
  db.exec('CREATE TABLE plot_pricing (project_id TEXT,plot_id TEXT)');
  db.exec('CREATE TABLE plot_edge_measurements (project_id TEXT,plot_id TEXT)');
  db.exec('CREATE TABLE published_plot_edge_measurements (project_id TEXT,plot_id TEXT)');
  db.exec('CREATE TABLE geo_features (project_id TEXT,linked_plot_id TEXT)');
  db.exec('CREATE TABLE settings (project_id TEXT,key TEXT,value TEXT,updated_at TEXT)');
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(id,'NOORPUR HILLS ESTATE','active' ,'published',13,'2026-10-22','2026-10-22');
  db.prepare('INSERT INTO project_public_snapshots VALUES (?,?,?)').run(id,13,'2026-10-22');
  db.prepare('INSERT INTO settings VALUES (?,?,?,?)').run(id,'plotSheetCount','211','2026-10-22');
  for(const pid of [...Array.from({length:190},(_,i)=>String(i+1)),...Array.from({length:14},(_,i)=>'B'+(i+1)),...Array.from({length:7},(_,i)=>'C'+(i+1))]){
    const poly='[[0.1,0.1],[0.2,0.1],[0.2,0.2],[0.1,0.2]]';
    db.prepare('INSERT INTO plots VALUES (?,?,?,?,?)').run(id,pid,pid==='B1'?'sold':'available',1,poly);
    db.prepare('INSERT INTO published_plots VALUES (?,?,?,?)').run(id,pid,pid==='B1'?'sold':'available',poly);
  }
  return db;
}
test('published C6/C7 retirement is guarded, scoped and leaves 209 plots plus B1..B14 C1..C5',()=>{
  const db=fixture();
  db.exec(sql);
  for(const table of ['plots','published_plots']){
    const values=db.prepare('SELECT id FROM '+table+' WHERE project_id=?').all(id).map(x=>x.id);
    assert.equal(values.length,209);
    assert.ok(!values.includes('C6')&&!values.includes('C7'));
    for(let n=1;n<=5;n++)assert.ok(values.includes('C'+n));
    for(let n=1;n<=14;n++)assert.ok(values.includes('B'+n));
  }
  assert.equal(db.prepare('SELECT status FROM plots WHERE project_id=? AND id=?').get(id,'B1').status,'sold');
  assert.equal(db.prepare('SELECT publish_version FROM projects WHERE id=?').get(id).publish_version,14);
  assert.equal(db.prepare('SELECT publish_version FROM project_public_snapshots WHERE project_id=?').get(id).publish_version,14);
  assert.equal(db.prepare('SELECT value FROM settings WHERE project_id=? AND key=?').get(id,'plotSheetCount').value,'209');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM noorpur_before_c67_20261022_plots').get().n,211);
  assert.throws(()=>db.exec(sql),/CHECK constraint failed/);
});
test('booked C6 causes guard to reject deletion',()=>{
  const db=fixture();
  db.prepare('UPDATE plots SET status=? WHERE project_id=? AND id=?').run('booked',id,'C6');
  assert.throws(()=>db.exec(sql),/CHECK constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plots WHERE project_id=?').get(id).n,211);
});
test('client listing orders numeric first, then B1,B2,B10, then C1.. and exposes all 209',()=>{
  assert.match(admin,/SUBSTR\(\$\{plots\.id\},2\) NOT GLOB/);
  assert.match(admin,/CAST\(SUBSTR\(\$\{plots\.id\},2\) AS INTEGER\)/);
  assert.match(admin,/Math\.min\(300,/);
  assert.match(pricing,/p\.inventory_active=1/);
  assert.match(pricing,/CAST\(SUBSTR\(p\.id,2\) AS INTEGER\)/);
  assert.match(booking,/displayPlotId\(plot\.id\)/);
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE plots(id TEXT)');
  for(const p of ['C10','B11','C2','C1','B10','2','10','B2','B1','1'])db.prepare('INSERT INTO plots VALUES (?)').run(p);
  const rows=db.prepare(`SELECT id FROM plots ORDER BY CASE WHEN id GLOB '[0-9]*' AND id NOT GLOB '*[^0-9]*' THEN 0 WHEN UPPER(SUBSTR(id,1,1)) GLOB '[A-Z]' AND SUBSTR(id,2) GLOB '[0-9]*' AND SUBSTR(id,2) NOT GLOB '*[^0-9]*' THEN 1 ELSE 2 END, CASE WHEN id GLOB '[0-9]*' AND id NOT GLOB '*[^0-9]*' THEN CAST(id AS INTEGER) END, CASE WHEN SUBSTR(id,2) GLOB '[0-9]*' AND SUBSTR(id,2) NOT GLOB '*[^0-9]*' THEN SUBSTR(id,1,1) COLLATE NOCASE END, CASE WHEN SUBSTR(id,2) GLOB '[0-9]*' AND SUBSTR(id,2) NOT GLOB '*[^0-9]*' THEN CAST(SUBSTR(id,2) AS INTEGER) END,id COLLATE NOCASE`).all();
  assert.deepEqual(rows.map(x=>x.id),['1','2','10','B1','B2','B10','B11','C1','C2','C10']);
});
test('source CSV converter removes C6/C7 and preserves B/C labels, quoting',()=>{
  const dir=mkdtempSync(join(tmpdir(),'noorpur-test-'));
  try{
    const old=join(dir,'old.csv'),out=join(dir,'new.csv');
    writeFileSync(old,'Plot No,Sqft,Notes\r\nB1,100,"kept, sold"\r\nC6,200,remove\r\nC7,201,remove\r\nC5,202,keep\r\n');
    execFileSync(process.execPath,[new URL('../scripts/noorpur-filter-plot-sheet.mjs',import.meta.url).pathname,old,out]);
    const result=readFileSync(out,'utf8');
    assert.match(result,/B1,100,"kept, sold"/);
    assert.match(result,/C5,202,keep/);
    assert.doesNotMatch(result,/(^|\n)C[67],/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
