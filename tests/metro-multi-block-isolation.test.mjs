import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("METRO block migration is additive, disabled by default and keyed by original plot IDs",()=>{
 const m=read("drizzle/0048_metro_city_multi_block.sql");
 for(const t of ["metro_block_state","metro_block_assets","metro_block_plot_maps","metro_block_published_maps"])assert.match(m,new RegExp("CREATE TABLE IF NOT EXISTS "+t));
 assert.match(m,/public_enabled INTEGER NOT NULL DEFAULT 0/);
 assert.match(m,/PRIMARY KEY \(project_id,plot_id\)/);
 assert.doesNotMatch(m,/(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\s+(?:plots|projects|published_plots|property_sales|plot_admin_details)/i);
});
test("block API isolates draft uploads/polygon editing from canonical plot inventory and requires confirmation",()=>{
 const source=read("app/api/admin/metro-blocks/route.ts");
 assert.match(source,/requireSuperAdmin/);
 assert.match(source,/sameOrigin\(request\)/);
 assert.match(source,/metro-blocks\/draft/);
 assert.match(source,/metro-blocks\/published/);
 assert.match(source,/PUBLISH METRO BLOCKS/);
 assert.match(source,/RESTORE METRO LEGACY/);
 assert.match(source,/INSERT INTO metro_block_published_maps/);
 assert.match(source,/FROM plots WHERE project_id=\? AND inventory_active=1/);
 assert.doesNotMatch(source,/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:plots|published_plots|property_sales|plot_admin_details)\b/i);
});
test("customer root remains existing until Metro-only block publish; client admin unchanged",()=>{
 const root=read("app/projects/[slug]/page.tsx");
 const admin=read("app/projects/[slug]/admin/page.tsx");
 assert.match(root,/project\.id === METRO_BLOCK_PROJECT_ID && await metroBlockState\(project\.id\)/);
 assert.match(root,/MetroBlockSelector/);
 assert.match(root,/__rekixo\/project/);
 assert.doesNotMatch(admin,/metro.block|MetroBlock/i);
});
test("only published block image geometry and version can reach the customer viewer",()=>{
 const data=read("app/api/public-data/route.ts");
 const image=read("app/api/project-asset/[kind]/route.ts");
 const js=read("public/project/index.html");
 const blocks=read("app/metro-blocks.ts");
 assert.match(data,/publishedMetroBlockMap/);
 assert.match(data,/blockGeometryByPlot\.has\(plot\.id\)/);
 assert.match(data,/publicPlot\.polygon=blockGeometryByPlot/);
 assert.match(data,/publicPlot\.frontEdgeIndex=null/);
 assert.match(image,/metroBlockImageResponse/);
 assert.match(image,/mode !== "public"/);
 assert.match(js,/canonicalForward\.set\('block'/);
 assert.match(js,/params\.set\('block'/);
 assert.match(blocks,/published_version AS version/);
 assert.match(blocks,/requestedVersion && requestedVersion !== String\(published\.state\.version\)/);
});
test("shared Metro sale and four-state status flows are retained",()=>{
 const data=read("app/api/public-data/route.ts");
 const live=read("app/api/public-live/route.ts");
 const metro=read("app/metro-agreement.ts");
 assert.match(data,/status: liveStatusByPlot\.get\(plot\.id\) \|\| publicPlot\.status/);
 assert.match(data,/metroAgreementByPlot\.get\(plot\.id\)/);
 assert.match(live,/metroAgreementValues/);
 assert.match(metro,/c024a562-634d-4e49-b647-43209f6e450b/);
});
