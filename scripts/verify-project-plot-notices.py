#!/usr/bin/env python3
"""Offline migration safety and numeric-order verification."""
import sqlite3
from pathlib import Path
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL,status TEXT NOT NULL);
CREATE TABLE plots(project_id TEXT,id TEXT,inventory_active INTEGER,status TEXT,sqft REAL,polygon TEXT,PRIMARY KEY(project_id,id));
INSERT INTO projects VALUES('c024a562-634d-4e49-b647-43209f6e450b','Metro City','metro-city-c024a5','active');
INSERT INTO projects VALUES('farm-project','Farm Villa','farm-villa','active');
INSERT INTO plots VALUES('farm-project','18',1,'available',1200,'[[0,0],[1,0],[1,1]]');
""")
metro="c024a562-634d-4e49-b647-43209f6e450b"
for pid in ["1","2","3","10","11","100","101","18","48","231","66","67","17","263","S-1","S-10","S-2","A12","A3"]:
 db.execute("INSERT INTO plots VALUES(?,?,1,'available',1200,'[[0,0],[1,0],[1,1]]')",(metro,pid))
before=list(db.execute("SELECT * FROM plots ORDER BY project_id,id"))
sql=Path("drizzle/0042_project_plot_notices.sql").read_text()
db.executescript(sql)
db.executescript(sql)
assert list(db.execute("SELECT * FROM plots ORDER BY project_id,id"))==before
assert db.execute("SELECT enabled FROM project_plot_notice_settings WHERE project_id=?",(metro,)).fetchone()==(1,)
assert db.execute("SELECT COUNT(*) FROM project_plot_notice_settings WHERE project_id='farm-project'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM project_plot_notices WHERE state='published'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM project_plot_notices WHERE project_id=? AND source='admin_reference'",(metro,)).fetchone()[0]==3
try:
 db.execute("INSERT INTO project_plot_notice_settings(project_id,enabled,updated_at) VALUES('missing',1,'now')")
 raise AssertionError("Foreign key accepted unknown project")
except sqlite3.IntegrityError: pass
sort_sql="""SELECT id FROM plots p WHERE project_id=? ORDER BY
 CASE WHEN p.id GLOB '[0-9]*' AND p.id NOT GLOB '*[^0-9]*' THEN 0
 WHEN p.id GLOB '[A-Za-z]-[0-9]*' AND SUBSTR(p.id,3) NOT GLOB '*[^0-9]*' THEN 1
 WHEN p.id GLOB '[A-Za-z][0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN 2 ELSE 3 END,
 CASE WHEN p.id GLOB '[0-9]*' AND p.id NOT GLOB '*[^0-9]*' THEN CAST(p.id AS INTEGER) END,
 CASE WHEN p.id GLOB '[A-Za-z]-[0-9]*' AND SUBSTR(p.id,3) NOT GLOB '*[^0-9]*' THEN SUBSTR(p.id,1,2) COLLATE NOCASE END,
 CASE WHEN p.id GLOB '[A-Za-z]-[0-9]*' AND SUBSTR(p.id,3) NOT GLOB '*[^0-9]*' THEN CAST(SUBSTR(p.id,3) AS INTEGER) END,
 CASE WHEN p.id GLOB '[A-Za-z][0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN SUBSTR(p.id,1,1) COLLATE NOCASE END,
 CASE WHEN p.id GLOB '[A-Za-z][0-9]*' AND SUBSTR(p.id,2) NOT GLOB '*[^0-9]*' THEN CAST(SUBSTR(p.id,2) AS INTEGER) END,
 p.id COLLATE NOCASE,p.id"""
ids=[r[0] for r in db.execute(sort_sql,(metro,))]
assert ids.index("1")<ids.index("2")<ids.index("3")<ids.index("10")<ids.index("11")<ids.index("100")
assert ids.index("S-1")<ids.index("S-2")<ids.index("S-10")
assert ids.index("A3")<ids.index("A12")
print("PASS: additive and idempotent migration, Metro only drafts, original plots untouched and natural numeric order")
