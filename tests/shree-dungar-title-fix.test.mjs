import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

const migration=readFileSync("drizzle/0045_fix_shree_dungar_residency_title.sql","utf8");

test("SHREE DUNGAR RESIDENCY correction is exact-slug, additive and idempotent",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec(`
      CREATE TABLE projects(id TEXT PRIMARY KEY,slug TEXT UNIQUE,name TEXT,publish_version INTEGER);
      CREATE TABLE settings(project_id TEXT,key TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(project_id,key));
      CREATE TABLE published_settings(project_id TEXT,key TEXT,value TEXT,PRIMARY KEY(project_id,key));
      CREATE TABLE project_public_snapshots(project_id TEXT PRIMARY KEY,publish_version INTEGER,project_name TEXT);
      CREATE TABLE plots(project_id TEXT,id TEXT,status TEXT,PRIMARY KEY(project_id,id));
      INSERT INTO projects VALUES
        ('target','hree-dungar-residency-9176ee','Hree Dungar Residency',7),
        ('other','another-hree-dungar-residency','Hree Dungar Residency',9),
        ('near','hree-dungar-residency-9176eex','Hree Dungar Residency',5);
      INSERT INTO project_public_snapshots VALUES
        ('target',7,'HREE DUNGAR RESIDENCY'),
        ('other',9,'HREE DUNGAR RESIDENCY');
      INSERT INTO plots VALUES('target','1','available'),('other','1','sold');
      INSERT INTO settings VALUES
        ('target','projectName','Hree Dungar Residency','old'),
        ('target','brandName','HREE DUNGAR RESIDENCY','old'),
        ('target','brandShort','HDR','old'),
        ('target','shareTitle','Hree Dungar Residency | Plots','old'),
        ('target','shareDescription','Explore Hree Dungar Residency with AR 3D.','old'),
        ('target','location','Existing city','old'),
        ('other','projectName','Hree Dungar Residency','old');
      INSERT INTO published_settings VALUES
        ('target','projectName','HREE DUNGAR RESIDENCY'),
        ('target','brandName','HREE DUNGAR RESIDENCY'),
        ('target','brandShort','HDR'),
        ('target','shareTitle','HREE DUNGAR RESIDENCY | Plots'),
        ('target','shareDescription','Explore SHREE DUNGAR RESIDENCY with AR 3D.'),
        ('other','projectName','Hree Dungar Residency');
    `);
    const untouchedBefore=db.prepare("SELECT * FROM plots ORDER BY project_id,id").all();
    db.exec(migration);
    const project=db.prepare("SELECT * FROM projects WHERE id='target'").get();
    assert.equal(project.name,"SHREE DUNGAR RESIDENCY");
    assert.equal(project.slug,"hree-dungar-residency-9176ee");
    assert.equal(project.publish_version,7);
    assert.deepEqual(db.prepare("SELECT * FROM plots ORDER BY project_id,id").all(),untouchedBefore);
    const settings=Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE project_id='target'").all().map(x=>[x.key,x.value]));
    const published=Object.fromEntries(db.prepare("SELECT key,value FROM published_settings WHERE project_id='target'").all().map(x=>[x.key,x.value]));
    assert.equal(settings.projectName,"SHREE DUNGAR RESIDENCY");
    assert.equal(settings.brandName,"SHREE DUNGAR RESIDENCY");
    assert.equal(settings.brandShort,"SDR");
    assert.equal(settings.shareTitle,"SHREE DUNGAR RESIDENCY | Plots");
    assert.equal(settings.shareDescription,"Explore SHREE DUNGAR RESIDENCY with AR 3D.");
    assert.equal(settings.location,"Existing city");
    assert.equal(published.projectName,"SHREE DUNGAR RESIDENCY");
    assert.equal(published.brandName,"SHREE DUNGAR RESIDENCY");
    assert.equal(published.brandShort,"SDR");
    assert.equal(published.shareTitle,"SHREE DUNGAR RESIDENCY | Plots");
    assert.equal(published.shareDescription,"Explore SHREE DUNGAR RESIDENCY with AR 3D.");
    assert.equal(db.prepare("SELECT project_name FROM project_public_snapshots WHERE project_id='target'").get().project_name,"SHREE DUNGAR RESIDENCY");
    assert.equal(db.prepare("SELECT name FROM projects WHERE id='other'").get().name,"Hree Dungar Residency");
    assert.equal(db.prepare("SELECT name FROM projects WHERE id='near'").get().name,"Hree Dungar Residency");
    assert.equal(db.prepare("SELECT value FROM settings WHERE project_id='other' AND key='projectName'").get().value,"Hree Dungar Residency");
    const after=db.prepare("SELECT project_id,key,value FROM published_settings ORDER BY project_id,key").all();
    db.exec(migration);
    assert.deepEqual(db.prepare("SELECT project_id,key,value FROM published_settings ORDER BY project_id,key").all(),after);
    assert.equal(db.prepare("SELECT value FROM settings WHERE project_id='target' AND key='projectName'").get().value,"SHREE DUNGAR RESIDENCY");
  }finally{db.close()}
});
