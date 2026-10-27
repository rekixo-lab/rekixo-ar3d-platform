#!/usr/bin/env python3
import sqlite3
from pathlib import Path
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE projects(id TEXT PRIMARY KEY,slug TEXT,name TEXT,status TEXT);
CREATE TABLE plots(project_id TEXT,id TEXT,inventory_active INTEGER,status TEXT,PRIMARY KEY(project_id,id));
CREATE TABLE project_custom_fields(project_id TEXT,field_key TEXT,label TEXT,field_type TEXT,choices_json TEXT,sort_order INTEGER,required INTEGER,enabled INTEGER,updated_at TEXT,PRIMARY KEY(project_id,field_key));
CREATE TABLE plot_custom_values(project_id TEXT,plot_id TEXT,field_key TEXT,field_value TEXT,revision INTEGER,updated_at TEXT,updated_by TEXT,PRIMARY KEY(project_id,plot_id,field_key));
CREATE TABLE plot_deal_states(project_id TEXT,plot_id TEXT,stage_slug TEXT);
INSERT INTO projects VALUES ('c024a562-634d-4e49-b647-43209f6e450b','metro-city-c024a5','Metro City','active'),('farm','farm-villa','Farm Villa','active'),('fake','metro-city-c024a5','Metro City','active');
INSERT INTO plots VALUES ('c024a562-634d-4e49-b647-43209f6e450b','18',1,'booked'),('c024a562-634d-4e49-b647-43209f6e450b','19',1,'available'),('c024a562-634d-4e49-b647-43209f6e450b','20',1,'available'),('farm','18',1,'booked'),('fake','18',1,'booked');
INSERT INTO plot_deal_states VALUES ('c024a562-634d-4e49-b647-43209f6e450b','18','agreement_done'),('c024a562-634d-4e49-b647-43209f6e450b','19','hold'),('c024a562-634d-4e49-b647-43209f6e450b','20','registered'),('farm','18','agreement_done'),('fake','18','agreement_done');
""")
before=list(db.execute("SELECT * FROM plots ORDER BY project_id,id"))
sql=Path("drizzle/0043_metro_agreement_done.sql").read_text()
db.executescript(sql)
db.executescript(sql)
assert list(db.execute("SELECT * FROM plots ORDER BY project_id,id"))==before
metro="c024a562-634d-4e49-b647-43209f6e450b"
fields=list(db.execute("SELECT project_id,field_key,field_type FROM project_custom_fields"))
assert fields==[(metro,"agreement_done","checkbox")],fields
flags=list(db.execute("SELECT project_id,plot_id,field_value,revision FROM plot_custom_values ORDER BY plot_id"))
assert flags==[(metro,"18","true",1),(metro,"20","true",1)],flags
assert db.execute("SELECT status FROM plots WHERE project_id=? AND id='18'",(metro,)).fetchone()[0]=="booked"
print("PASS: Metro only, safe backfill, idempotent migration, canonical plot inventory unchanged")
