import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("METRO published rotation is independent, snapshots current draft and keeps canonical polygons untouched",()=>{
 const sql=read("drizzle/0051_metro_published_view_rotation.sql");
 const api=read("app/api/admin/metro-blocks/route.ts");
 const blocks=read("app/metro-blocks.ts");
 const publicData=read("app/api/public-data/route.ts");
 assert.match(sql,/ALTER TABLE metro_block_assets/);
 assert.doesNotMatch(sql,/(?:ALTER TABLE|UPDATE|DELETE FROM)\s+(?:plots|published_plots|projects|project_public_snapshots)\b/i);
 assert.match(api,/draft_view_rotation AS viewRotation/);
 assert.match(api,/published_view_rotation=\?/);
 assert.match(api,/c\.asset\.viewRotation,version/);
 assert.match(blocks,/published_view_rotation AS viewRotation/);
 assert.match(publicData,/safePublicSettings\.publicRotation=String\(blockPlan\.asset\.viewRotation\)/);
 assert.match(publicData,/!blockPlan &&/);
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(`
  CREATE TABLE metro_block_state(project_id TEXT PRIMARY KEY,public_enabled INTEGER NOT NULL,version INTEGER NOT NULL);
  CREATE TABLE metro_block_assets(project_id TEXT,block_key TEXT,published_version INTEGER,published_object_key TEXT,draft_view_rotation INTEGER);
  INSERT INTO metro_block_state VALUES ('c024a562-634d-4e49-b647-43209f6e450b',1,7);
  INSERT INTO metro_block_assets VALUES ('c024a562-634d-4e49-b647-43209f6e450b','a',7,'r2/a',1);
  INSERT INTO metro_block_assets VALUES ('c024a562-634d-4e49-b647-43209f6e450b','b',7,'r2/b',2);
  INSERT INTO metro_block_assets VALUES ('c024a562-634d-4e49-b647-43209f6e450b','c',7,'r2/c',3);
  INSERT INTO metro_block_assets VALUES ('other','a',7,'r2/unrelated',2);
  `);
  db.exec(sql);
  const rows=db.prepare("SELECT block_key AS k,published_view_rotation AS r FROM metro_block_assets WHERE project_id=? ORDER BY block_key")
    .all("c024a562-634d-4e49-b647-43209f6e450b");
  assert.deepEqual(rows.map(v=>[v.k,v.r]),[["a",1],["b",2],["c",3]]);
  assert.equal(db.prepare("SELECT published_view_rotation AS r FROM metro_block_assets WHERE project_id='other'").get().r,0);
  db.exec("UPDATE metro_block_assets SET draft_view_rotation=0 WHERE block_key='b' AND project_id='c024a562-634d-4e49-b647-43209f6e450b'");
  assert.equal(db.prepare("SELECT published_view_rotation AS r FROM metro_block_assets WHERE block_key='b'").get().r,2,"Editing draft after publish must not rotate live block");
 }finally{db.close()}
});

test("customer image and clickable plot SVG share one rotated world, compass follows angle",()=>{
 const ui=read("public/project/index.html");
 const source=ui.indexOf('class="world" id="world"');
 const image=ui.indexOf('class="master"',source);
 const svg=ui.indexOf('class="hotspots"',source);
 assert.ok(source>=0&&image>source&&svg>image);
 assert.match(ui,/world\.style\.transform = `translate3d\([\s\S]*?rotate\(\$\{publicRotation\*90\}deg\)`/);
 assert.match(ui,/setCompassRoseAngle\(publicNorthSourceAngle\+publicRotation\*90\)/);
 assert.ok(ui.includes("u=rotateOffset(dx,dy,(4-publicRotation)%4)"));
});

test("All Blocks is located beside compass inside map viewport; never covers 3D, and other tenants do not see it",()=>{
 const outer=read("app/projects/[slug]/block/[block]/page.tsx"),ui=read("public/project/index.html");
 assert.doesNotMatch(outer,/position:"fixed",zIndex:5,top:165/);
 const map=ui.indexOf('<main class="map" id="viewport">');
 const compass=ui.indexOf('class="map-badge compass"',map);
 const all=ui.indexOf('id="metroAllBlocksLink"',compass);
 const three=ui.indexOf('id="view3d"',all);
 assert.ok(map>=0&&compass>map&&all>compass&&three>all);
 assert.match(ui,/metroAllBlocksLink\.hidden=!\(REKIXO_PROJECT_SLUG==='metro-city-c024a5'&&REKIXO_FORWARD\.has\('block'\)\)/);
 assert.match(ui,/\.metro-all-blocks-link\{[\s\S]*?left:104px;/);
 assert.match(ui,/@media\(max-width:700px\)\{\s*\.metro-all-blocks-link\{/);
 assert.match(ui,/\.metro-all-blocks-link\[hidden\]\{display:none!important\}/);
});

test("main block selector renders existing published project logo, live call and client admin icon, without unwanted copy",()=>{
 const selector=read("app/metro-block-selector.tsx");
 assert.match(selector,/published_settings WHERE project_id=\? AND key IN \('logoName','logoVersion'/);
 assert.match(selector,/settings WHERE project_id=\? AND key IN \('phone1','phone2','customerCallEnabled'\)/);
 assert.match(selector,/project-asset\/logo\?projectSlug=/);
 assert.match(selector,/alt="Metro City project logo"/);
 assert.match(selector,/aria-label="Call Metro City"/);
 assert.match(selector,/href=\{\`tel:\+\$\{callNumber\}\`\}/);
 assert.match(selector,/aria-label="Open Metro City admin panel"/);
 assert.match(selector,/admin-login/);
 assert.doesNotMatch(selector,/Residential plots across 3 blocks/i);
 assert.doesNotMatch(selector,/Single METRO CITY project/i);
 assert.doesNotMatch(selector,/Three interactive block layouts/i);
 assert.doesNotMatch(selector,/Shared inventory and admin/i);
});

test("main canonical link has WhatsApp image meta from Share Builder, else published block image",()=>{
 const meta=read("app/project-share-metadata.ts");
 const page=read("app/projects/[slug]/page.tsx");
 assert.match(page,/generatePublishedProjectMetadata\(slug\)/);
 assert.match(meta,/shareImagePath \|\| metroFallbackImagePath \|\| logoPath/);
 assert.match(meta,/publishedMetroBlock\(project\.id, "a"\)/);
 assert.match(meta,/public=1/);
 assert.match(meta,/hasShareImage: Boolean\(settings\.shareImage \|\| metroFallbackImagePath\)/);
 assert.match(meta,/openGraph: \{/);
 assert.match(meta,/images,/);
 assert.match(meta,/canonicalShareUrl/);
});
