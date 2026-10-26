import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLOT_PLAYWRIGHT_MODULE).href);
const root = process.cwd();
const artifactDir = path.join(root, "artifacts", "masterplan-original-e2e");
fs.mkdirSync(artifactDir, { recursive: true });
const originalWidth = 12000, originalHeight = 6000;
const previewWidth = 1200, previewHeight = 600;
const polygon = [[.38, .35], [.62, .35], [.62, .65], [.38, .65]];
const states = new Map();
let originalPng, previewPng;

function fixture(projectId) {
  return {
    projectId, projectName: "Original Masterplan Test", slug: projectId,
    preview: false, publishVersion: 7,
    settings: {
      projectName: "Original Masterplan Test", brandName: "Rekixo", brandShort: "RKP",
      mapWidth: String(previewWidth), mapHeight: String(previewHeight),
      masterplanName: "high-resolution-original.png", publicRotation: "0", publicInitialViewMode: "plots",
    },
    plots: [{
      id: "P-1", sqft: 1000, sqm: 92.903, sqyd: 111.111,
      dimensions: "20 ft x 50 ft", road: "30 ft road", front: 20, back: 20,
      depth: 50, depth2: 50, dimensionUnit: "ft", frontEdgeIndex: 0,
      depthEdgeIndex: 1, backEdgeIndex: 2, depth2EdgeIndex: 3,
      polygon: JSON.stringify(polygon), status: "available", featured: false,
    }], gallery: [],
  };
}

function json(res, value) {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const projectId = url.searchParams.get("projectId") || "quality-desktop";
  if (url.pathname === "/api/public-data") return json(res, fixture(projectId));
  if (url.pathname === "/api/public-live") return json(res, {
    projectId, pricingEnabled: false, settings: {},
    statuses: [{ id: "P-1", status: "available" }], pricing: [],
  });
  if (url.pathname === "/api/public-gallery") return json(res, { projectId, gallery: [] });
  if (url.pathname === "/api/project-asset/masterplan") {
    const state = states.get(projectId);
    if (!state) { res.writeHead(404); return res.end(); }
    const variant = url.searchParams.get("variant");
    state.requests.push(variant);
    assert.equal(url.searchParams.get("v"), "7", "every image belongs to the published version");
    if (variant === "original") {
      state.originalRequested();
      await state.gate;
      if (url.searchParams.get("inspect") === "1") {
        return json(res, state.missing
          ? { original: false, source: "published-canonical-fallback", bytes: previewPng.length }
          : { original: true, source: "published-original", bytes: originalPng.length });
      }
      if (state.missing) { res.writeHead(404); return res.end(); }
    }
    const body = variant === "original" ? originalPng : previewPng;
    res.writeHead(200, {
      "content-type": "image/png", "content-length": String(body.length),
      "cache-control": "public,max-age=31536000,immutable",
    });
    return res.end(body);
  }
  const relative = url.pathname === "/" ? "public/project/index.html" :
    url.pathname.startsWith("/project/") ? "public" + url.pathname : null;
  const full = relative && path.join(root, relative);
  if (!full || !full.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(full)) {
    res.writeHead(404); return res.end();
  }
  const type = full.endsWith(".html") ? "text/html" : full.endsWith(".js") ? "text/javascript" : "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(full).pipe(res);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...(process.env.PLOT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLOT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function generateFixtures() {
  const page = await browser.newPage();
  const images = await page.evaluate(async ({ width, height, smallWidth, smallHeight }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f1ebd2"; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1e6b4e"; ctx.lineWidth = 2;
    for (let x = 0; x < width; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = "#132746"; ctx.font = "bold 18px Arial";
    for (let y = 50; y < height; y += 300) {
      for (let x = 30; x < width; x += 400) ctx.fillText(`ORIGINAL ${x},${y}`, x, y);
    }
    ctx.strokeStyle = "#b74b25"; ctx.lineWidth = 6;
    ctx.strokeRect(width * .38, height * .35, width * .24, height * .30);
    const original = canvas.toDataURL("image/png").split(",")[1];
    const small = document.createElement("canvas");
    small.width = smallWidth; small.height = smallHeight;
    small.getContext("2d").drawImage(canvas, 0, 0, smallWidth, smallHeight);
    const preview = small.toDataURL("image/png").split(",")[1];
    canvas.width = canvas.height = small.width = small.height = 1;
    return { original, preview };
  }, { width: originalWidth, height: originalHeight, smallWidth: previewWidth, smallHeight: previewHeight });
  originalPng = Buffer.from(images.original, "base64");
  previewPng = Buffer.from(images.preview, "base64");
  assert.equal(originalPng.readUInt32BE(16), originalWidth);
  assert.equal(originalPng.readUInt32BE(20), originalHeight);
  await page.close();
}

async function geometry(page) {
  return page.evaluate(() => {
    const image = document.querySelector(".master"), plot = document.querySelector('.plot[data-plot-id="P-1"]');
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { image: rect(image), plot: rect(plot), percent: document.querySelector("#percent").textContent,
      viewBox: document.querySelector(".hotspots").getAttribute("viewBox"), points: plot.getAttribute("points") };
  });
}

function sameGeometry(before, after, name) {
  for (const part of ["image", "plot"]) for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(before[part][key] - after[part][key]) < .5,
      `${name}: original promotion preserves ${part}.${key}`);
  }
  assert.equal(after.percent, before.percent, `${name}: zoom percentage survives promotion`);
  assert.equal(after.viewBox, before.viewBox, `${name}: logical plane survives promotion`);
  assert.equal(after.points, before.points, `${name}: plot coordinates survive promotion`);
  assert.ok(Math.abs(after.image.width / after.image.height - 2) < .0001, `${name}: large original keeps 2:1 aspect`);
}

async function assertPlotHit(page, name) {
  const point = await page.locator('.plot[data-plot-id="P-1"]').evaluate(el => {
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .25], [.5, .75]]) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      if (x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && document.elementFromPoint(x, y) === el) return { x, y };
    }
    return null;
  });
  assert.ok(point, `${name}: original-aligned plot remains hittable`);
  await page.mouse.click(point.x, point.y);
  await page.locator("#drawer.open").waitFor({ state: "visible" });
  assert.match(await page.locator("#plotTitle").textContent(), /P-1/);
  await page.locator("#closeBtn").click();
  await page.waitForFunction(() => !document.querySelector("#drawer").classList.contains("open"));
}

async function journey(target) {
  let release, requested;
  const state = {
    missing: Boolean(target.missing), requests: [],
    gate: new Promise(resolve => { release = resolve; }),
    requested: new Promise(resolve => { requested = resolve; }),
    originalRequested: () => requested(),
  };
  states.set(target.name, state);
  const context = await browser.newContext({
    viewport: target.viewport, isMobile: Boolean(target.mobile), hasTouch: Boolean(target.mobile),
    deviceScaleFactor: target.mobile ? 2 : 1, reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    window.__textureUploads = [];
    window.__nativeCrops = [];
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (args.length === 9 && args[0]?.naturalWidth === 12000 && !this.classList?.contains('master-native-tile')) {
        window.__nativeCrops.push({ sourceWidth: args[3], sourceHeight: args[4], width: args[7], height: args[8] });
      }
      return drawImage.apply(this, args);
    };
    const proto = WebGLRenderingContext.prototype, parameter = proto.getParameter, upload = proto.texImage2D;
    // Exercise native tiling even on a desktop GPU with a very large texture limit.
    proto.getParameter = function (key) { const result = parameter.call(this, key); return key === this.MAX_TEXTURE_SIZE ? Math.min(result, 4096) : result; };
    proto.texImage2D = function (...args) {
      const source = args.length === 6 ? args[5] : null;
      window.__textureUploads.push({ width: source ? source.width || source.naturalWidth : args[3], height: source ? source.height || source.naturalHeight : args[4] });
      return upload.apply(this, args);
    };
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  try {
    await page.goto(`${base}/project/index.html?projectId=${target.name}&pv=7`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const image = document.querySelector(".master");
      return image?.naturalWidth === 1200 && !document.querySelector("#viewport").classList.contains("master-loading");
    });
    await Promise.race([state.requested, new Promise((_, reject) => setTimeout(() => reject(Error("original was never requested")), 10000))]);
    // Panorama projects may open at their left edge on mobile. Use the normal
    // search action to bring this fixture's central plot into the visible map.
    await page.locator("#searchInput").fill("P-1");
    await page.locator("#searchInput").press("Enter");
    await page.locator("#drawer.open").waitFor({ state: "visible" });
    await page.locator("#closeBtn").click();
    await page.waitForFunction(() => !document.querySelector("#drawer").classList.contains("open"));
    const initial = await geometry(page);
    await page.locator("#zoomIn").click();
    await page.waitForFunction(before => document.querySelector("#percent").textContent !== before, initial.percent);
    const viewport = await page.locator("#viewport").boundingBox();
    const start = { x: viewport.x + viewport.width * .62, y: viewport.y + viewport.height * .72 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 24, start.y - 18, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector("#viewport").classList.contains("gesture-active"));
    const before = await geometry(page);
    assert.ok(Math.abs(before.image.x - initial.image.x) > 1, `${target.name}: real pan/zoom changed presentation before original arrived`);
    release();
    if (target.missing) {
      // Wait beyond all preview retry delays to prove an unavailable legacy
      // original does not start a request loop or discard the usable preview.
      await page.waitForTimeout(1300);
      assert.equal(await page.locator(".master").evaluate(el => el.naturalWidth), previewWidth);
      assert.equal(state.requests.filter(v => v === "original").length, 1, "missing original is probed only once, never downloaded");
      assert.equal(await page.locator("#masterplanQuality").count(), 0, "customer masterplan quality badge is removed");
    } else {
      await page.waitForFunction(() => {
        const master=document.querySelector(".master");
        return master?.dataset.originalSrc?.includes('variant=original') &&
          document.querySelectorAll(".master-native-tile").length > 0;
      });
      assert.equal(await page.locator(".master").evaluate(el=>el.naturalWidth),previewWidth,
        "the reliable preview remains permanently rendered behind native original tiles");
      const tileDetails=await page.locator(".master-native-tile").evaluateAll(tiles=>
        tiles.map(t=>({width:t.width,height:t.height,painted:t.width>0&&t.height>0})));
      assert.ok(tileDetails.length>0&&tileDetails.every(t=>t.painted&&t.width<=1536&&t.height<=1536),
        "original 2D tiles fit GPU budget and paint at an adaptive display resolution");
      assert.equal(await page.locator("#masterplanQuality").count(), 0, "customer original HD text and background are removed");
      assert.ok(state.requests.filter(v => v === "original").length >= 2, "original metadata is verified before downloading the image");
      const response = await context.request.get(await page.locator(".master").getAttribute("data-original-src"));
      assert.equal(response.status(), 200);
      assert.equal(createHash("sha256").update(await response.body()).digest("hex"), createHash("sha256").update(originalPng).digest("hex"), "2D native tile source is byte-identical to uploaded original fixture");
    }
    sameGeometry(before, await geometry(page), target.name);
    await assertPlotHit(page, target.name);
    await page.screenshot({ path: path.join(artifactDir, `${target.name}.png`) });
    if (target.three) {
      await page.locator("#view3d").click();
      await page.waitForFunction(() => document.querySelector("#viewport").classList.contains("mode3d"));
      await page.waitForFunction(() => {
        const loading = document.querySelector(".three-loading");
        return loading && (loading.style.opacity === "0" || loading.style.display === "none");
      }, null, { timeout: 30000 });
      await page.waitForFunction(() => window.__textureUploads.length > 1 &&
        window.__textureUploads.some(tile => tile.width === 2048 || tile.height === 2048));
      const uploads = await page.evaluate(() => window.__textureUploads);
      assert.ok(uploads.length > 1, "large 3D source is tiled instead of uploaded as one oversized texture");
      assert.ok(uploads.every(tile => tile.width > 0 && tile.height > 0 && tile.width <= 4096 && tile.height <= 4096), "native tiles obey GPU limits");
      assert.ok(uploads.some(tile => tile.width === 2048 || tile.height === 2048), "3D keeps native-sized detail tiles");
      const crops = await page.evaluate(() => window.__nativeCrops);
      assert.ok(crops.length > 0 && crops.every(crop => crop.sourceWidth === crop.width && crop.sourceHeight === crop.height), "3D native crops retain every source pixel without resizing");
      const glError = await page.locator(".three-canvas").evaluate(canvas => canvas.getContext("webgl").getError());
      assert.equal(glError, 0, "tiled masterplan leaves no WebGL error");
      await page.screenshot({ path: path.join(artifactDir, `${target.name}-3d.png`) });
    }
    assert.deepEqual(errors, [], `${target.name}: no JavaScript errors`);
    console.log(`PASS ${target.name}: ${target.missing ? "legacy fallback" : "byte-identical original"}, stable plane/zoom/pan, plot hit-test${target.three ? ", GPU-safe 3D tiles" : ""}`);
  } finally {
    release();
    await context.close();
  }
}

try {
  await generateFixtures();
  await journey({ name: "quality-desktop", viewport: { width: 1440, height: 1000 }, three: true });
  await journey({ name: "quality-mobile", viewport: { width: 390, height: 844 }, mobile: true });
  await journey({ name: "quality-legacy-fallback", viewport: { width: 390, height: 844 }, mobile: true, missing: true });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
