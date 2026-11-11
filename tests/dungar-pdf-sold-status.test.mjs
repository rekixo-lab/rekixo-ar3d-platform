import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {
  allPdfIds,soldPdfIds,allProductionIds,soldProductionIds,pdfPageSoldCounts,
  villaSoldIds,projectSlug,projectName,validatePdfReference
} from "../scripts/dungar-pdf-sold-source.mjs";

const migration=readFileSync("drizzle/0046_dungar_residency_pdf_sold_only.sql","utf8");
const expectedSoldSet=new Set(soldProductionIds);

function fixtures({missing=false,bookedTarget=false,wrongName=false}={}){
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT,public_status TEXT,publish_version INTEGER);
    CREATE TABLE project_public_snapshots(project_id TEXT,publish_version INTEGER);
    CREATE TABLE plots(project_id TEXT,id TEXT,inventory_active INTEGER,status TEXT,updated_at TEXT,sqyd REAL,polygon TEXT,
      PRIMARY KEY(project_id,id));
    INSERT INTO projects VALUES('p1','hree-dungar-residency-9176ee','SHREE DUNGAR RESIDENCY','active','published',13);
    INSERT INTO projects VALUES('p2','another-project','SHREE DUNGAR RESIDENCY','active','published',3);
    INSERT INTO project_public_snapshots VALUES('p1',13),('p2',3);
    INSERT INTO plots VALUES('p2','2',1,'available','old',911.11,'other-polygon');
  `);
  if(wrongName)db.exec("UPDATE projects SET name='ANOTHER NAME' WHERE id='p1'");
  const stmt=db.prepare("INSERT INTO plots VALUES(?,?,?,?,?,?,?)");
  for(const id of allProductionIds){
    if(missing&&id==="C-87")continue;
    const status=bookedTarget&&id==="2"?"booked":id==="C-2"?"booked":"available";
    stmt.run("p1",id,1,status,"old",266.67,"unchanged-polygon");
  }
  return db;
}

test("PDF classification: 257 unique plotted rows, 163 SOLD including both VILA SOLD",()=>{
  const {all,sold,dbAll,dbSold}=validatePdfReference();
  assert.equal(all.size,257);
  assert.equal(sold.size,163);
  assert.equal(dbAll.size,257);
  assert.equal(dbSold.size,163);
  assert.equal(allPdfIds.length,257);
  assert.equal(soldPdfIds.length,163);
  assert.deepEqual(pdfPageSoldCounts,[39,43,37,31,12,1]);
  assert.deepEqual(villaSoldIds,["125","126"]);
  for(const id of ["119","120","121","122","123","127","128","129","130","131","B-7","B-8","B-25","B-27","C-2","C-87"])
    assert.equal(expectedSoldSet.has(id),false,"PDF-unmarked plot must never be sold: "+id);
  assert.ok(expectedSoldSet.has("B-19,B-20"));
  assert.ok(expectedSoldSet.has("B-23,B-24"));
  assert.ok(expectedSoldSet.has("2"));
  assert.equal(projectSlug,"hree-dungar-residency-9176ee");
  assert.equal(projectName,"SHREE DUNGAR RESIDENCY");
});

test("migration only changes the exact 163 source-confirmed active plot statuses",()=>{
  const db=fixtures();
  try{
    const before=db.prepare("SELECT * FROM plots ORDER BY project_id,id").all();
    db.exec(migration);
    const after=db.prepare("SELECT * FROM plots ORDER BY project_id,id").all();
    assert.equal(after.filter(x=>x.project_id==="p1"&&x.status==="sold").length,163);
    assert.equal(after.filter(x=>x.project_id==="p1"&&x.status==="booked").length,1);
    assert.equal(after.filter(x=>x.project_id==="p1"&&x.status==="available").length,93);
    for(let i=0;i<before.length;i++){
      const previous=before[i],next=after[i];
      for(const key of Object.keys(previous).filter(k=>k!=="status"&&k!=="updated_at"))
        assert.deepEqual(next[key],previous[key],previous.id+" "+key+" unexpectedly changed");
      if(previous.project_id==="p1"&&expectedSoldSet.has(previous.id)){
        assert.equal(next.status,"sold");
        assert.notEqual(next.updated_at,"old");
      }else{
        assert.equal(next.status,previous.status);
        assert.equal(next.updated_at,previous.updated_at);
      }
    }
    assert.equal(db.prepare("SELECT publish_version FROM projects WHERE id='p1'").get().publish_version,13);
    assert.equal(db.prepare("SELECT publish_version FROM project_public_snapshots WHERE project_id='p1'").get().publish_version,13);
    const once=db.prepare("SELECT id,status,updated_at FROM plots WHERE project_id='p1' ORDER BY id").all();
    db.exec(migration);
    assert.deepEqual(db.prepare("SELECT id,status,updated_at FROM plots WHERE project_id='p1' ORDER BY id").all(),once);
  }finally{db.close()}
});

test("fail closed: missing plot, wrong tenant name, or booked target prevents partial update",()=>{
  for(const options of [{missing:true},{wrongName:true},{bookedTarget:true}]){
    const db=fixtures(options);
    try{
      db.exec(migration);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plots WHERE project_id='p1' AND status='sold'").get().n,0,
        "unsafe inventory should remain unchanged "+JSON.stringify(options));
    }finally{db.close()}
  }
});
