import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("auto CAD mapper is owner-only, project-native and keeps precise manual fallback", async () => {
  const [mapper, api, legacyApi, schema, website, three, clientAdmin, superAdmin] =
    await Promise.all([
      source("../app/plot-mapper.tsx"),
      source("../app/api/super-mapper/route.ts"),
      source("../app/api/mapper/route.ts"),
      source("../db/schema.ts"),
      source("../public/project/index.html"),
      source("../public/project/three-view.js"),
      source("../app/admin-dashboard.tsx"),
      source("../app/super-admin-dashboard.tsx"),
    ]);

  assert.match(mapper, /Rekixo Plot Mapper/);
  assert.match(mapper, /Front-first plot · 4 corners/);
  assert.match(mapper, /road-facing Front boundary/);
  assert.match(mapper, /Main masterplan image/);
  assert.match(mapper, /toolMode/);
  assert.match(mapper, /"pan" \| "select"/);
  assert.match(mapper, /MAX_MAPPER_ZOOM = 20/);
  assert.match(mapper, /max=\{MAX_MAPPER_ZOOM\}/);
  assert.match(mapper, /clearAllSelections/);
  assert.match(mapper, /action: "clear_all_polygons"/);
  assert.match(mapper, /verifyAllBoundariesCleared/);
  assert.match(mapper, /polygonSelfIntersects/);
  assert.match(mapper, /mappingDraftKey/);
  assert.match(mapper, /Clone prev/);
  assert.match(mapper, /Advanced CAD Assistant/);
  assert.match(mapper, /Shape independent save/);
  assert.doesNotMatch(mapper, /Rectangle · 2 taps/);
  assert.doesNotMatch(mapper, />Move image</);
  assert.match(mapper, /snapPoint/);
  assert.match(mapper, /mapper-loupe/);
  assert.match(mapper, /solveHomography/);
  assert.match(mapper, /bestCadLabel/);
  assert.match(mapper, /publishAutoMatches/);
  assert.match(mapper, /plotSheet/);
  assert.match(mapper, /sourceCad/);
  assert.match(mapper, /MAX_MAPPING_DIMENSION = 4096/);
  assert.match(mapper, /Persistent polygons are normalized 0\.\.1/);
  assert.match(mapper, /resizeWidth: width/);
  assert.doesNotMatch(mapper, /MAP_WIDTH = 1200/);
  assert.doesNotMatch(mapper, /MAP_HEIGHT = 2133/);

  assert.match(api, /requireSuperAdmin/);
  assert.match(legacyApi, /status:403/);
  assert.match(api, /parseCadGeometry/);
  assert.match(api, /parsePlotSheetText/);
  assert.match(api, /sourceCad/);
  assert.match(api, /cadGeometry/);
  assert.match(api, /mapWidth/);
  assert.match(api, /mapHeight/);
  assert.match(api, /preserveGeometry/);
  assert.match(api, /Completed Tiyansh mapper locked/);
  assert.match(api, /body\.action === "clear_all_polygons"/);
  assert.match(api, /mapper\.all_boundaries_removed/);
  assert.match(api, /UPDATE plots SET polygon='',front_edge_index=NULL,back_edge_index=NULL,depth_edge_index=NULL,depth2_edge_index=NULL,edge_semantics=NULL,updated_at=\?/);
  assert.match(mapper, /resetGeometryDerivedSideAssignments/);
  assert.match(mapper, /edgeSemantics: null/);
  assert.match(schema, /polygon:text\("polygon"\)/);

  assert.match(website, /setMapDimensions/);
  assert.match(website, /s\.mapWidth/);
  assert.match(website, /s\.mapHeight/);
  assert.match(website, /project-asset\/masterplan/);
  assert.match(website, /mapWidth:W,mapHeight:H/);
  assert.match(website, /ACTIVE_PROJECT_ID/);
  assert.match(website, /world\.style\.visibility = 'hidden'/);
  assert.match(three, /DEFAULT_IMG_W=1200,DEFAULT_IMG_H=2133/);
  assert.match(three, /this\.imgW=Math\.max/);
  assert.match(three, /this\.imgH=Math\.max/);
  assert.doesNotMatch(three, /const IMG_W=1200,IMG_H=2133/);

  assert.doesNotMatch(clientAdmin, /PlotMapper/);
  assert.match(superAdmin, /PlotMapper/);
  assert.match(superAdmin, /projectId=\{projectId\}/);
});

test("safe shop inventory addition is additive and initializes only new polygons empty", async () => {
  const api = await source("../app/api/super-mapper/route.ts");
  const mapper = await source("../app/plot-mapper.tsx");
  assert.match(api, /body\.action === "add_inventory_plots"/);
  assert.match(api, /INSERT INTO plots \(project_id,id,sqft,sqm,sqyd,dimensions,road,front,depth,back,depth2/);
  assert.match(api, /collisions = ids\.filter/);
  assert.match(api, /mapper\.inventory_plots_added/);
  assert.match(api, /created\.results\.some/);
  assert.match(mapper, /Add 5 Shops \(8 x 15 ft\)/);
  assert.match(mapper, /function createInventoryPlots/);
  assert.match(mapper, /window\.confirm\("Shop-1 se Shop-5 tak paanch inventory rows add karni hain/);
});
