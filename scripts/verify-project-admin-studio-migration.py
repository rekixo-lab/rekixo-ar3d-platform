#!/usr/bin/env python3
"""Offline migration safety test; no production D1 access."""
import json
import sqlite3
from pathlib import Path

db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE plots(project_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL,
 sqft REAL NOT NULL, polygon TEXT NOT NULL, PRIMARY KEY(project_id,id));
INSERT INTO projects VALUES('c024a562-634d-4e49-b647-43209f6e450b','Metro City','metro-city-c024a5','active');
INSERT INTO projects VALUES('another-project','Farm Villa','farm-villa','active');
INSERT INTO plots VALUES('c024a562-634d-4e49-b647-43209f6e450b','101','booked',2700,'[[0,0],[1,0],[1,1]]');
INSERT INTO plots VALUES('c024a562-634d-4e49-b647-43209f6e450b','102','sold',2500,'[[0,0],[1,0],[1,1]]');
INSERT INTO plots VALUES('another-project','1','available',1200,'[[0,0],[1,0],[1,1]]');
""")
before=db.execute("SELECT * FROM plots ORDER BY project_id,id").fetchall()
sql=Path("drizzle/0041_project_admin_studio.sql").read_text()
db.executescript(sql)
db.executescript(sql)  # deployed migrations must be re-run safely
assert db.execute("SELECT * FROM plots ORDER BY project_id,id").fetchall()==before
assert db.execute("SELECT COUNT(*) FROM project_admin_features WHERE enabled=1").fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM project_admin_features WHERE project_id='another-project'").fetchone()[0]==0
assert db.execute("SELECT COUNT(*) FROM project_deal_stages WHERE project_id='c024a562-634d-4e49-b647-43209f6e450b'").fetchone()[0]==4
for table in ["plot_deal_states","plot_deal_events","plot_custom_values","project_custom_fields"]:
    assert db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0]==0
# Ensure composite tenant FK actually rejects a state linking to another project's plot.
try:
    db.execute("""INSERT INTO plot_deal_states(project_id,plot_id,stage_slug,revision,updated_at,updated_by)
                  VALUES ('another-project','101',NULL,1,'now','fixture')""")
    raise AssertionError("Cross-tenant foreign key unexpectedly accepted")
except sqlite3.IntegrityError:
    pass
print("PASS Admin Studio migration idempotency, original data parity, Metro-only seed and composite tenant FKs")
