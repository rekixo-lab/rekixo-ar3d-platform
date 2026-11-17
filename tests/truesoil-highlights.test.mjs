import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");

test("Truesoil-only Geo target is an exact URL, never the other projects' map URL", () => {
  assert.ok(page.includes("const TRUESOIL_PROJECT_SLUG='truesoil-farms-1c2440';"));
  assert.ok(page.includes("const TRUESOIL_GEO_URL='https://ar3dstudio.in/3Dprojects/truesoil-farms-3d-8a7cf13c/geo';"));
  assert.ok(page.includes("String(data.slug||'').trim()===TRUESOIL_PROJECT_SLUG"));
  assert.ok(page.includes("MAP_URL=truesoilEnabled?TRUESOIL_GEO_URL:(s.mapUrl||'');"));
  assert.ok(page.includes("window.open(MAP_URL,'_blank','noopener,noreferrer')"));
});

test("Highlights control is default hidden and only activated by verified tenant data", () => {
  assert.match(page, /id="truesoilHighlightsBtn"[^>]+hidden>/);
  assert.match(page, /id="truesoilHighlightsModal"[^>]+hidden>/);
  assert.ok(page.includes("q('#truesoilHighlightsBtn').hidden=!truesoilEnabled"));
  assert.ok(page.includes(".truesoil-highlights-btn[hidden],.truesoil-highlights-modal[hidden]{display:none!important}"));
  assert.ok(page.includes("truesoilHighlightsModal.hidden=false"));
  assert.ok(page.includes("truesoilHighlightsModal.hidden=true"));
  assert.ok(page.includes("truesoilHighlightsClose.focus()"));
  assert.ok(page.includes("truesoilHighlightsPreviousFocus?.focus?.()"));
  assert.ok(page.includes("if(e.key==='Escape')"));
  assert.ok(page.includes("if(e.target===truesoilHighlightsModal)closeTruesoilHighlights()"));
});

test("All four requested developer-provided marketing highlights appear", () => {
  for (const claim of [
    "270° Aravalli View", "90 Minutes", "From Delhi NCR",
    "Pure Living", "Breathe Pure · Drink Pure · Grow Pure",
    "Delhi–Mumbai Expressway"
  ]) assert.ok(page.includes(claim), "Missing: " + claim);
  assert.equal((page.match(/class="truesoil-highlight-card"/g)||[]).length,4);
});

test("Existing amenities, gallery, location, plot and status bindings remain intact", () => {
  assert.match(page, /id="amenitiesBtn"[\s\S]*id="galleryBtn"[\s\S]*id="locationBtn"[\s\S]*id="truesoilHighlightsBtn"/);
  assert.ok(page.includes("q('#amenitiesBtn').onclick=openAmenities"));
  assert.ok(page.includes("q('#galleryBtn').onclick=openGallery"));
  assert.ok(page.includes("const fallback=isMangalRajPark()"));
  assert.ok(page.includes("category=amenity"));
  assert.ok(page.includes("function addPlotPolygon(p)"));
  assert.ok(page.includes("function set3D(on)"));
});
