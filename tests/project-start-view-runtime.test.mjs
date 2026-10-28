import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const snapshot = await readFile(new URL("../app/public-publish-snapshot.ts", import.meta.url), "utf8");
const publicAPI = await readFile(new URL("../app/api/public-data/route.ts", import.meta.url), "utf8");
const begin = html.indexOf("  function normalizeInitialViewMode(");
const end = html.indexOf("  function toast(", begin);
assert.ok(begin >= 0 && end > begin, "public start-view implementation not found");
const runtime = html.slice(begin, end);

function harness(options = {}) {
  const canvas = { W: 1600, H: 800, viewportWidth: 1200, viewportHeight: 700, publicRotation: 0,
    publicInitialViewMode: "legacy", publicInitialFocusX: 0.5, publicInitialFocusY: 0.5,
    plots: [], scale: 1, fit: 1, pan: { x: 0, y: 0 }, ...options };
  const normalized = structuredClone(canvas.plots);
  const env = {
    ...canvas,
    displaySize() { return env.publicRotation % 2 ? { w: env.H, h: env.W } : { w: env.W, h: env.H }; },
    calcFit() { const size = env.displaySize(); env.fit = Math.min(env.viewportWidth / size.w, env.viewportHeight / size.h); },
    rotateOffset(dx, dy, rotation) {
      return rotation === 1 ? { x: -dy, y: dx } : rotation === 2
        ? { x: -dx, y: -dy } : rotation === 3 ? { x: dy, y: -dx } : { x: dx, y: dy };
    },
    isMobilePanorama() { return false; },
    // The extracted start-view helpers intentionally run without DOM.
    // Tablet-specific behavior has a separate numerical regression suite.
    isTabletPlotPresentation() { return false; },
    presentationUserAdjusted: false,
    limits() {
      const size = env.displaySize();
      return { x: Math.max(0, (size.w * env.scale - env.viewportWidth) / 2),
        y: Math.max(0, (size.h * env.scale - env.viewportHeight) / 2) };
    },
    render() {
      const limits = env.limits();
      env.pan.x = Math.min(limits.x, Math.max(-limits.x, env.pan.x));
      env.pan.y = Math.min(limits.y, Math.max(-limits.y, env.pan.y));
    },
  };
  vm.runInNewContext(runtime, env);
  return { env, normalized };
}

test("published custom focus is parsed from mode setting, not from the settings object", () => {
  assert.match(html, /publicInitialViewMode=normalizeInitialViewMode\(s\.publicInitialViewMode\)/);
  const { env } = harness();
  vm.runInNewContext(
    "publicInitialViewMode=normalizeInitialViewMode(s.publicInitialViewMode);",
    Object.assign(env, { s: { publicInitialViewMode: "custom" } }),
  );
  assert.equal(env.publicInitialViewMode, "custom");
  assert.equal(env.normalizeInitialViewMode("plots"), "plots");
  assert.equal(env.normalizeInitialViewMode(undefined), "legacy");
  assert.equal(env.normalizeInitialViewMode({ publicInitialViewMode: "custom" }), "legacy",
    "former buggy object argument silently disabled the feature");
});

test("custom focus on a desktop contain-fit map starts zoomed enough to be visible", () => {
  const { env, normalized } = harness({ publicInitialViewMode: "custom", publicInitialFocusX: .507, publicInitialFocusY: .703 });
  env.reset();
  assert.ok(env.scale > env.fit, "configured focus must not be clamped away at contain-fit");
  assert.ok(Math.abs(env.pan.y) > 10, "focus should move opening map");
  const screenY = (.703 - .5) * env.H * env.scale + env.pan.y;
  assert.ok(Math.abs(screenY) < 2, "selected focus appears at screen center");
  assert.deepEqual(env.plots, normalized, "no polygon/data mutations");
});

test("mapped plot bounds center survives start reset, manual mode leaves old default", () => {
  const polygons = [{ points: [[200, 120], [400, 120], [400, 300]] },
    { points: [[800, 400], [1000, 400], [1000, 600]] }];
  const { env } = harness({ publicInitialViewMode: "plots", plots: polygons });
  const before = JSON.stringify(env.plots);
  const center = env.mappedPlotsCenterFocus();
  assert.equal(center.x, .375);
  assert.equal(center.y, .45);
  env.reset();
  const scale = env.scale, firstPan = { ...env.pan };
  env.pan = { x: 0, y: 0 };
  env.reset();
  assert.equal(env.scale, scale);
  assert.equal(env.pan.x, firstPan.x, "RST restores same horizontal start pan");
  assert.equal(env.pan.y, firstPan.y, "RST restores same vertical start pan");
  assert.equal(JSON.stringify(env.plots), before);
  env.publicInitialViewMode = "legacy";
  env.reset();
  assert.equal(env.scale, env.fit, "existing auto opening zoom must stay unchanged");
  assert.equal(env.pan.x, 0);
  assert.equal(env.pan.y, 0);
});

test("mobile cover-fit and rotation are bounded and preserve saved plot geometry", () => {
  const { env } = harness({ viewportWidth: 360, viewportHeight: 720, publicRotation: 1,
    publicInitialViewMode: "custom", publicInitialFocusX: .507, publicInitialFocusY: .703 });
  const before = JSON.stringify(env.plots);
  env.reset();
  const lim = env.limits();
  assert.ok(env.scale >= env.fit);
  assert.ok(env.scale <= env.fit * 4.5 + 0.000001);
  assert.ok(Math.abs(env.pan.x) <= lim.x + .001);
  assert.ok(Math.abs(env.pan.y) <= lim.y + .001);
  assert.equal(JSON.stringify(env.plots), before);
});

test("start view stays in project published settings and is not a live draft leak", () => {
  for (const key of ["publicInitialViewMode", "publicInitialFocusX", "publicInitialFocusY"]) {
    assert.ok(snapshot.includes('"' + key + '"'));
    assert.ok(publicAPI.includes('"' + key + '"'));
  }
  assert.match(publicAPI, /SELECT key,value FROM published_settings WHERE project_id=\?/);
});
