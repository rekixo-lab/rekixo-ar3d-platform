import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

const read=path=>readFileSync(path,"utf8");
const migration=read("drizzle/0047_fix_dungar_customer_title_cache.sql");
const revision="shree-dungar-title-corrected-20261111-v2";

test("Dungar revision update targets only the correctly published SHREE project",()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec(`
      CREATE TABLE projects(id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT,public_status TEXT,publish_version INTEGER);
      CREATE TABLE project_public_snapshots(project_id TEXT,publish_version INTEGER,project_name TEXT);
      CREATE TABLE published_settings(project_id TEXT,key TEXT,value TEXT,PRIMARY KEY(project_id,key));
      CREATE TABLE plots(project_id TEXT,id TEXT,status TEXT,polygon TEXT,PRIMARY KEY(project_id,id));
      INSERT INTO projects VALUES
        ('target','hree-dungar-residency-9176ee','SHREE DUNGAR RESIDENCY','active','published',13),
        ('other','hree-dungar-residency-9176ee-copy','SHREE DUNGAR RESIDENCY','active','published',5),
        ('invalid','other-project','SHREE DUNGAR RESIDENCY','active','published',4);
      INSERT INTO project_public_snapshots VALUES
        ('target',13,'SHREE DUNGAR RESIDENCY'),
        ('other',5,'SHREE DUNGAR RESIDENCY'),
        ('invalid',4,'SHREE DUNGAR RESIDENCY');
      INSERT INTO published_settings VALUES
        ('target','projectName','SHREE DUNGAR RESIDENCY'),
        ('target','shareTitle','SHREE DUNGAR RESIDENCY'),
        ('target','brandName','SHREE DUNGAR RESIDENCY'),
        ('other','projectName','SHREE DUNGAR RESIDENCY');
      INSERT INTO plots VALUES('target','2','sold','polygon-original'),('other','2','available','polygon-other');
    `);
    const before=db.prepare("SELECT * FROM plots ORDER BY project_id").all();
    db.exec(migration);
    const rows=db.prepare("SELECT project_id,key,value FROM published_settings WHERE key='publicDataRevision'").all();
    assert.deepEqual(rows,[{project_id:"target",key:"publicDataRevision",value:revision}]);
    const after=db.prepare("SELECT * FROM plots ORDER BY project_id").all();
    assert.deepEqual(after,before,"plot geometry or statuses must not change");
    assert.equal(db.prepare("SELECT publish_version FROM projects WHERE id='target'").get().publish_version,13);
    assert.equal(db.prepare("SELECT publish_version FROM project_public_snapshots WHERE project_id='target'").get().publish_version,13);
    db.exec(migration);
    assert.deepEqual(db.prepare("SELECT project_id,key,value FROM published_settings WHERE key='publicDataRevision'").all(),rows);
  }finally{db.close()}
});

test("revision is not written if a snapshot is out of sync or published name is wrong",()=>{
  for(const update of [
    "UPDATE project_public_snapshots SET publish_version=12 WHERE project_id='target'",
    "UPDATE project_public_snapshots SET project_name='HREE DUNGAR RESIDENCY' WHERE project_id='target'"
  ]){
    const db=new DatabaseSync(":memory:");
    try{
      db.exec(`
        CREATE TABLE projects(id TEXT,slug TEXT,name TEXT,status TEXT,public_status TEXT,publish_version INTEGER);
        CREATE TABLE project_public_snapshots(project_id TEXT,publish_version INTEGER,project_name TEXT);
        CREATE TABLE published_settings(project_id TEXT,key TEXT,value TEXT,PRIMARY KEY(project_id,key));
        INSERT INTO projects VALUES('target','hree-dungar-residency-9176ee','SHREE DUNGAR RESIDENCY','active','published',13);
        INSERT INTO project_public_snapshots VALUES('target',13,'SHREE DUNGAR RESIDENCY');
        INSERT INTO published_settings VALUES('target','projectName','SHREE DUNGAR RESIDENCY');
      `);
      db.exec(update);
      db.exec(migration);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM published_settings WHERE key='publicDataRevision'").get().n,0);
    }finally{db.close()}
  }
});

test("dynamic customer iframe URL changes with published revision",()=>{
  const page=read("app/projects/[slug]/page.tsx");
  assert.match(page,/key='publicDataRevision'/);
  assert.match(page,/dataRevision=\$\{encodeURIComponent\(published\.dataRevision\)\}/);
  assert.match(page,/dynamic = "force-dynamic"/);
});

test("project wrapper and updated title payload cannot remain pinned to old immutable cache",()=>{
  const worker=read("worker/index.ts");
  const data=read("app/api/public-data/route.ts");
  const html=read("public/project/index.html");
  assert.match(worker,/isPublicProjectEntry\(externalUrl\.pathname\)/);
  assert.match(worker,/secured\.headers\.set\("cache-control", "no-store"\)/);
  assert.match(data,/"publicDataRevision"/);
  assert.match(data,/!publicSettings\.publicDataRevision/);
  assert.match(html,/REKIXO_PROJECT_SLUG==='hree-dungar-residency-9176ee'\?'no-store':'default'/);
  assert.match(html,/structuralParams\.set\('dataRevision',REKIXO_PARAMS\.get\('dataRevision'\)\)/);
  assert.match(html,/brand\.textContent=PROJECT_NAME\.toUpperCase\(\)/);
});
