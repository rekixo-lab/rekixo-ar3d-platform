import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");
const mapSource = html.slice(html.indexOf("  function setMapDimensions("), html.indexOf("  // The metadata probe is tiny."));
const upgradeSource = html.slice(html.indexOf("  function upgradeMasterplanImage("), html.indexOf("  function displaySize("));

function imageHarness() {
  const requests = [];
  let sourceOriginal = true;
  const sandbox = {
    AbortController,
    URL,
    location: { href: "https://example.test/project/index.html" },
    fetch: async () => ({ ok: true, json: async () => ({ original: sourceOriginal }) }),
    document: { getElementById: () => null },
    setMasterplanQuality() {},
    Image: class {
      constructor() { this.naturalWidth = 16000; this.naturalHeight = 8000; requests.push(this); }
    },
  };
  vm.runInNewContext(upgradeSource, sandbox);
  const unchanged = { pan: { x: 37, y: -18 }, scale: 3.25, rotation: 90, polygon: [[100, 200], [400, 200], [400, 500]] };
  let oldLoads = 0, oldErrors = 0;
  const master = { src: "preview.webp", onload: () => oldLoads++, onerror: () => oldErrors++ };
  return { sandbox, requests, master, unchanged,
    setSourceOriginal: value => { sourceOriginal = value; },
    counts: () => ({ oldLoads, oldErrors }) };
}

test("giant raster dimensions preserve aspect and normalized plot positions", () => {
  const writes = [], master = {};
  const sandbox = {
    W: 1200, H: 2133,
    document: { documentElement: { style: { setProperty: (...args) => writes.push(args) } } },
    world: { style: {} }, q: () => master, svg: { setAttribute: (...args) => writes.push(args) },
  };
  vm.runInNewContext(mapSource, sandbox);
  sandbox.setMapDimensions(16000, 8000);
  assert.equal(sandbox.W, 10000);
  assert.equal(sandbox.H, 5000);
  assert.equal(sandbox.W / sandbox.H, 2);
  assert.equal(master.width / master.height, 2);
  assert.deepEqual([0.25 * sandbox.W, 0.75 * sandbox.H], [2500, 3750]);
  sandbox.setMapDimensions(Infinity, NaN);
  assert.equal(sandbox.W, 1200);
  assert.equal(sandbox.H, 2133);
});

test("decoded original promotion preserves current viewport and selection geometry", async () => {
  const h = imageHarness(), before = JSON.stringify(h.unchanged), upgrades = [];
  h.sandbox.upgradeMasterplanImage(h.master, "original.png", 2, src => upgrades.push(src));
  assert.equal(h.master.src, "preview.webp");
  await new Promise(resolve => setImmediate(resolve)); // let the metadata probe resolve
  h.requests[0].onload();
  assert.equal(h.master.src, "original.png");
  h.master.onload();
  assert.deepEqual(upgrades, ["original.png"]);
  assert.equal(JSON.stringify(h.unchanged), before);
  assert.deepEqual(h.counts(), { oldLoads: 0, oldErrors: 0 });
  assert.doesNotMatch(upgradeSource, /setMapDimensions|rescaleNormalizedPlots|reset\(/);
});

test("failed, wrong-aspect and superseded originals keep the decoded preview", async () => {
  for (const failure of ["network", "aspect", "stale", "cancelled"]) {
    const h = imageHarness();
    const cancel = h.sandbox.upgradeMasterplanImage(h.master, "original.png", 2, () => assert.fail("must not promote"), () => failure !== "stale");
    await new Promise(resolve => setImmediate(resolve));
    if (failure === "network") h.requests[0].onerror();
    else if (failure === "cancelled") cancel();
    else {
      if (failure === "aspect") h.requests[0].naturalHeight = 10000;
      h.requests[0].onload();
    }
    assert.equal(h.master.src, "preview.webp", failure);
  }
});

test("a display failure after preloading restores the preview", async () => {
  const h = imageHarness();
  h.sandbox.upgradeMasterplanImage(h.master, "original.png", 2, () => assert.fail("must not promote"));
  await new Promise(resolve => setImmediate(resolve));
  h.requests[0].onload();
  h.master.onerror();
  assert.equal(h.master.src, "preview.webp");
  h.master.onload();
  assert.equal(h.counts().oldLoads, 0);
});

test("optimized fallback probe prevents starting an original image download", async () => {
  const h = imageHarness();
  h.setSourceOriginal(false);
  h.sandbox.upgradeMasterplanImage(h.master, "original.png", 2, () => assert.fail("fallback must not promote"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.master.src, "preview.webp");
  assert.equal(h.requests[0].src, undefined, "fallback source is never downloaded/decoded");
});

function threeHarness() {
  const requests = [], uploads = [], crops = [], deletes = [];
  const gl = {
    MAX_TEXTURE_SIZE: 1, NO_ERROR: 0, TEXTURE_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4,
    getParameter: () => 2048, getError: () => 0,
    createTexture: () => ({}), deleteTexture: t => deletes.push(t), deleteBuffer() {},
    bindTexture() {}, pixelStorei() {}, texParameteri() {},
    texImage2D: (...args) => uploads.push(args.at(-1)),
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
  };
  const sandbox = {
    window: {}, navigator: { deviceMemory: 4 }, matchMedia: () => ({ matches: true }), setTimeout: f => f(),
    Image: class { constructor() { requests.push(this); } },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (...args) => crops.push(args) }) }) },
  };
  vm.runInNewContext(three, sandbox);
  const engine = Object.create(sandbox.window.RekixoPlot3D.prototype);
  Object.assign(engine, {
    gl, imageSrc: "original.png", previewImageSrc: "", textureGeneration: 0,
    texturePlan: null, textureFailed: false, loading: { style: {} }, request() {},
  });
  return { sandbox, engine, gl, requests, uploads, crops, deletes };
}

test("giant originals are divided into native-resolution GPU-safe tiles", () => {
  const h = threeHarness();
  h.engine.texture();
  const image = h.requests[0];
  image.naturalWidth = 16000; image.naturalHeight = 8000; image.onload();
  assert.equal(h.uploads.length, 1, "a missing legacy preview gets a small full-plan base");
  assert.ok(h.uploads.every(source => source !== image), "the giant original must never enter texImage2D as a single image");
  const tiles = h.engine.texturePlan.tiles;
  assert.equal(tiles.reduce((n, t) => n + t.w * t.h, 0), 16000 * 8000);
  assert.ok(tiles.every(t => t.sw <= 2048 && t.sh <= 2048));
  assert.ok(tiles.every(t => t.sw >= t.w && t.sh >= t.h));
  assert.equal(h.engine.texturePixelBudget, 8 * 1024 * 1024);
});

test("visible original tiles upload one per frame at one source pixel per texture pixel", () => {
  const h = threeHarness();
  Object.assign(h.engine, {
    worldW: 2, worldH: 1,
    P: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
    V: [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1],
    drawPlanTexture() {},
  });
  h.engine.texture();
  const image = h.requests[0]; image.naturalWidth = 12000; image.naturalHeight = 6000; image.onload();
  const uploadsBefore = h.uploads.length, cropsBefore = h.crops.length;
  h.engine.renderTextureTiles();
  assert.equal(h.uploads.length, uploadsBefore + 1);
  const first = h.crops[cropsBefore];
  assert.equal(first[3], first[7]); assert.equal(first[4], first[8]);
  for (let i = 0; i < 10; i++) h.engine.renderTextureTiles();
  const residentPixels = h.engine.texturePlan.tiles.filter(t => t.tex).reduce((n, t) => n + t.pixels, 0);
  assert.ok(residentPixels <= h.engine.texturePixelBudget);
  assert.ok(h.uploads.length >= uploadsBefore + 2);
  assert.ok(h.uploads.every(source => source !== image));
});

test("stale image loads cannot overwrite a newer 3D source", () => {
  const h = threeHarness();
  h.engine.texture();
  h.engine.imageSrc = "new-original.png"; h.engine.texture();
  const stale = h.requests[0]; stale.naturalWidth = 1200; stale.naturalHeight = 600; stale.onload();
  assert.equal(h.uploads.length, 0);
  const fresh = h.requests[1]; fresh.naturalWidth = 1200; fresh.naturalHeight = 600; fresh.onload();
  assert.equal(h.uploads.length, 1);
});


test("a thrown native texture upload releases its allocation exactly once", () => {
  const h = threeHarness();
  h.gl.texImage2D = () => { throw new Error("GPU memory exhausted"); };
  assert.throws(() => h.engine.uploadTexture({}), /GPU memory exhausted/);
  assert.equal(h.deletes.length, 1);
});
