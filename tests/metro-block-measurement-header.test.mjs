import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("METRO Block A/B/C current plot, legacy sizes, save feedback and zoom toolbar share one sticky stacking context",()=>{
 const ui=read("app/plot-mapper.tsx");
 const css=read("app/globals.css");
 const header=ui.indexOf('className={blockMode ? "metro-block-sticky-header" : "mapper-default-header-group"}');
 const selector=ui.indexOf('className="mapper-v4-current"',header);
 const measurements=ui.indexOf('data-testid="metro-block-legacy-measurements"',header);
 const feedback=ui.indexOf('data-testid="metro-block-save-feedback"',header);
 const rotation=ui.indexOf('data-testid="metro-block-rotation-status"',header);
 const toolbar=ui.indexOf('className="mapper-zoombar mapper-v4-toolbar"',header);
 const close=ui.indexOf("End METRO sticky header group",header);
 assert.ok(header>0&&selector>header&&measurements>selector&&feedback>measurements&&rotation>feedback&&toolbar>rotation&&close>toolbar);
 assert.match(css,/\.mapper-v4-canvas \.metro-block-sticky-header \{[\s\S]*?position: sticky;[\s\S]*?z-index: 20;/);
 assert.match(css,/\.metro-block-sticky-header > \.mapper-v4-toolbar \{[\s\S]*?position: static !important;/);
 assert.match(css,/\.metro-block-sticky-header > \[data-testid="metro-block-legacy-measurements"\] \{[\s\S]*?max-height:/);
 assert.match(css,/\.mapper-default-header-group \{ display: contents; \}/);
 assert.match(css,/\.metro-block-sticky-header > \.mapper-v4-toolbar \{[\s\S]*?overflow-x: auto;/);
});
test("the size display remains read-only from canonical plot records and never writes statuses, dimensions or polygon vertices",()=>{
 const api=read("app/api/admin/metro-blocks/advanced/route.ts");
 const ui=read("app/plot-mapper.tsx");
 assert.match(ui,/Original data \(read-only\)/);
 assert.match(ui,/blockReferenceSide\(role\)/);
 assert.match(ui,/blockReferenceArea\(currentPlot\?\.sqft/);
 assert.match(api,/JOIN plots p ON p\.project_id=m\.project_id AND p\.id=m\.plot_id/);
 assert.match(api,/UPDATE metro_block_plot_maps SET polygon=\?,side_bindings=\?/);
 assert.doesNotMatch(api,/UPDATE plots|UPDATE published_plots|UPDATE project_public_snapshots/i);
});
