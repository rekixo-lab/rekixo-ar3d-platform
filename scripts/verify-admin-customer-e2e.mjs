import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLOT_PLAYWRIGHT_MODULE).href);
const stage = process.env.E2E_STAGE || "admin";
const base = process.env.E2E_BASE_URL || "http://localhost:4173";
const projectId = "e2e-phase11";
const projectSlug = "phase-11-e2e";
const artifactDir = path.join(process.cwd(), "artifacts", "full-admin-e2e");
fs.mkdirSync(artifactDir, { recursive: true });
const auth = fs.existsSync("/tmp/rekixo-phase11-auth.json")
  ? JSON.parse(fs.readFileSync("/tmp/rekixo-phase11-auth.json", "utf8"))
  : null;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

function watchPage(page, errors) {
  page.on("pageerror", (error) => errors.push(String(error)));
}

async function chooseProject(page) {
  const mapperButton = page.getByRole("button", { name: "Plot Mapper" });
  // A freshly-created mobile context can paint SSR before React hydration attaches
  // the tab handler. Retry the real nav click until the mapper workspace is mounted.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await mapperButton.click();
    try {
      await page.locator(".super-project-search").waitFor({ state: "visible", timeout: 3000 });
      break;
    } catch {
      if (attempt === 2) throw new Error("Plot Mapper workspace did not hydrate");
      await page.waitForTimeout(350);
    }
  }
  // Pin the fixture through the real server-side project search so this journey
  // stays deterministic even when migrations seed more than the first 50 projects.
  await page.locator(".super-project-search").fill(projectSlug);
  await page.waitForFunction(
    (id) => [...document.querySelectorAll("#workspace-project option")].some((o) => o.value === id),
    projectId,
  );
  await page.locator("#workspace-project").selectOption(projectId);
  await page.waitForSelector(".mapper-v4-canvas");
  await page.locator('img[alt="Project masterplan"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="Project masterplan"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
}

async function adjacentBoundaryJourney(page, context, firstPlot) {
  const originalPolygon = JSON.parse(firstPlot.polygon);
  const [[left, edgeY], [right]] = originalPolygon;
  const svg = page.locator(".mapper-image-wrap svg").first();
  const handles = page.locator(".mapper-point-handle");
  const snap = page.getByRole("button", { name: "Snap to saved boundaries", exact: true });
  await page.locator(".mapper-v4-current select").selectOption("P-2");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "4-corner plot" }).click();
  assert.equal(await snap.getAttribute("aria-pressed"), "false", "snapping starts OFF");

  async function imageBox() {
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    assert.ok(box && box.width > 40 && box.height > 40, "adjacent mapper SVG visible");
    return box;
  }

  async function expectCorner(expected, message) {
    await page.waitForFunction(() => document.querySelectorAll(".mapper-point-handle").length === 1);
    const point = await handles.first().evaluate((handle) => [
      parseFloat(handle.style.left) / 100,
      parseFloat(handle.style.top) / 100,
    ]);
    const box = await svg.boundingBox();
    assert.ok(box, "mapper bounds available for corner assertion");
    assert.ok(Math.abs(point[0] - expected[0]) * box.width < 0.1, `${message}: exact X`);
    assert.ok(Math.abs(point[1] - expected[1]) * box.height < 0.1, `${message}: exact Y`);
  }

  async function clickNearEdge() {
    const box = await imageBox();
    const point = [(left + right) / 2, edgeY - 4 / box.height];
    await page.mouse.click(box.x + point[0] * box.width, box.y + point[1] * box.height);
    return point;
  }

  async function dragNearEdge() {
    const handle = await handles.first().boundingBox();
    assert.ok(handle, "corner drag handle visible");
    const box = await svg.boundingBox();
    assert.ok(box, "mapper bounds available for drag");
    const point = [left + (right - left) * 0.65, edgeY - 4 / box.height];
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + point[0] * box.width, box.y + point[1] * box.height, { steps: 4 });
    await page.mouse.up();
    return point;
  }

  async function clearDraft() {
    await page.locator(".mapper-v4-toolbar .mapper-focus-actions").getByRole("button", { name: "Clear", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mapper-point-handle").length === 0);
  }

  const freeClick = await clickNearEdge();
  await expectCorner(freeClick, "Snap OFF click stays four pixels above saved boundary");
  const freeDrag = await dragNearEdge();
  await expectCorner(freeDrag, "Snap OFF drag stays four pixels above saved boundary");
  await page.screenshot({ path: path.join(artifactDir, "admin-adjacent-snap-off.png"), fullPage: true });
  await clearDraft();

  await snap.click();
  assert.equal(await snap.getAttribute("aria-pressed"), "true");
  const snappedClick = await clickNearEdge();
  await expectCorner([snappedClick[0], edgeY], "Snap ON click aligns to saved boundary");
  const snappedDrag = await dragNearEdge();
  await expectCorner([snappedDrag[0], edgeY], "Snap ON drag aligns to saved boundary");
  await page.screenshot({ path: path.join(artifactDir, "admin-adjacent-snap-on.png"), fullPage: true });
  await clearDraft();
  await snap.click();
  assert.equal(await snap.getAttribute("aria-pressed"), "false");

  // Save a real adjacent plot with a narrow deliberate gap, then verify the
  // source coordinates through the API before the existing publish journey.
  const box = await imageBox();
  const lowerY = edgeY - 4 / box.height;
  const upperY = Math.max(0.04, edgeY - 0.12);
  const adjacent = [[left, lowerY], [right, lowerY], [right, upperY], [left, upperY]];
  for (let index = 0; index < adjacent.length; index += 1) {
    const [x, y] = adjacent[index];
    // Dispatch through the SVG's real pointer handlers in this persistence
    // subcase. Earlier free/snap journeys exercise physical mouse input; here
    // we isolate state/save logic from overlapping existing-plot hit targets.
    await svg.evaluate((element, xy) => {
      const rect = element.getBoundingClientRect();
      const clientX = rect.left + xy[0] * rect.width;
      const clientY = rect.top + xy[1] * rect.height;
      const args = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX, clientY };
      element.dispatchEvent(new PointerEvent("pointerdown", args));
      element.dispatchEvent(new PointerEvent("pointerup", args));
    }, [x, y]);
    await page.waitForFunction(
      (count) => document.querySelectorAll(".mapper-point-handle").length === count,
      index + 1,
    );
  }
  await page.waitForFunction(() => {
    const button = document.querySelector("button.mapper-focus-confirm");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.locator("button.mapper-focus-confirm").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".mapper-review-list article")].some(
      (row) => row.textContent?.includes("P-2") && row.classList.contains("mapped"),
    ),
  );
  const verify = await context.request.get(
    `${base}/api/super-mapper?projectId=${encodeURIComponent(projectId)}&verify=${Date.now()}`,
  );
  assert.equal(verify.ok(), true);
  const state = await verify.json();
  assert.equal(state.plots.find((plot) => plot.id === "P-1")?.polygon, firstPlot.polygon, "adjacent mapping leaves existing boundary unchanged");
  const saved = JSON.parse(state.plots.find((plot) => plot.id === "P-2")?.polygon || "[]");
  assert.equal(saved.length, 4, "adjacent plot persisted");
  for (let index = 0; index < adjacent.length; index += 1) {
    assert.ok(Math.abs(saved[index][0] - adjacent[index][0]) * box.width < 0.1, `saved adjacent corner ${index + 1} X`);
    assert.ok(Math.abs(saved[index][1] - adjacent[index][1]) * box.height < 0.1, `saved adjacent corner ${index + 1} Y keeps deliberate gap`);
  }

  const zoom = page.getByRole("slider", { name: "Zoom level" });
  assert.equal(await zoom.getAttribute("max"), "50", "mapper allows 5000% zoom");
  await zoom.focus();
  await zoom.press("End");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Zoom level"]')?.getAttribute("aria-valuetext") === "5000%");
  assert.equal(await page.getByRole("button", { name: "Zoom in", exact: true }).isDisabled(), true);
  await zoom.press("Home");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Zoom level"]')?.getAttribute("aria-valuetext") === "100%");
  console.log("PASS adjacent plot click/drag OFF precision → ON alignment → persisted gap → 5000% zoom");
}

async function adminJourney(browser) {
  assert.ok(auth?.email && auth?.password, "ephemeral E2E credentials missing");
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watchPage(page, errors);

  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await page.locator("#login-id").fill(auth.email);
  await page.locator("#login-password").fill(auth.password);
  await page.getByRole("button", { name: "Sign In as Super Admin" }).click();
  await page.waitForURL(/\/admin\/?$/);
  await page.waitForSelector(".super-shell");

  const upload = await context.request.post(`${base}/api/super-mapper`, {
    headers: { origin: base },
    multipart: {
      projectId,
      kind: "masterplan",
      mapWidth: "1200",
      mapHeight: "1200",
      originalWidth: "1200",
      originalHeight: "1200",
      file: { name: "phase11-masterplan.png", mimeType: "image/png", buffer: tinyPng },
    },
  });
  assert.equal(upload.ok(), true, `masterplan upload ${upload.status()}: ${await upload.text()}`);

  await chooseProject(page);
  await page.screenshot({ path: path.join(artifactDir, "admin-desktop-before-map.png"), fullPage: true });

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.waitForSelector(".mapper-v4-canvas.select-mode");
  await page.getByRole("button", { name: "4-corner plot" }).click();
  await page.waitForSelector(".mapper-v4-canvas.select-mode");
  const svg = page.locator(".mapper-image-wrap svg").first();
  const box = await svg.boundingBox();
  assert.ok(box && box.width > 40 && box.height > 40, "mapper SVG visible");
  const corners = [[.22,.22],[.46,.22],[.46,.48],[.22,.48]];
  for (let index = 0; index < corners.length; index += 1) {
    const [x, y] = corners[index];
    await svg.click({ position: { x: box.width * x, y: box.height * y } });
    await page.waitForFunction(
      (minimum) => document.querySelectorAll(".mapper-point-handle").length >= minimum,
      index + 1,
    );
  }
  await page.waitForFunction(() => document.querySelectorAll(".mapper-point-handle").length === 4);
  await page.waitForFunction(() => {
    const button = document.querySelector("button.mapper-focus-confirm");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.screenshot({ path: path.join(artifactDir, "admin-desktop-sides-ready.png"), fullPage: true });

  await page.getByRole("button", { name: "Toggle mapping focus/fullscreen" }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.screenshot({ path: path.join(artifactDir, "admin-desktop-focus.png") });
  await page.getByRole("button", { name: "Toggle mapping focus/fullscreen" }).click();
  await page.waitForFunction(() => !document.fullscreenElement);

  await page.locator("button.mapper-focus-confirm").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".mapper-review-list article")].some(
      (row) => row.textContent?.includes("P-1") && row.classList.contains("mapped"),
    ),
  );

  const verify = await context.request.get(
    `${base}/api/super-mapper?projectId=${encodeURIComponent(projectId)}&verify=${Date.now()}`,
  );
  assert.equal(verify.ok(), true);
  const state = await verify.json();
  const saved = state.plots?.find((plot) => plot.id === "P-1");
  assert.ok(saved, "P-1 persisted");
  assert.equal(JSON.parse(saved.polygon || "[]").length, 4);
  assert.deepEqual(
    [saved.frontEdgeIndex, saved.depthEdgeIndex, saved.backEdgeIndex, saved.depth2EdgeIndex],
    [0, 1, 2, 3],
  );
  assert.match(String(saved.edgeSemantics || ""), /"front":\[0\]/);

  await adjacentBoundaryJourney(page, context, saved);

  const previewPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "Authenticated preview" }).first().click();
  const preview = await previewPromise;
  watchPage(preview, errors);
  await preview.waitForLoadState("domcontentloaded");
  await preview.frameLocator("iframe").locator('.plot[data-plot-id="P-1"]').waitFor();
  await preview.screenshot({ path: path.join(artifactDir, "admin-authenticated-preview.png"), fullPage: true });
  await preview.close();

  const publish = page.getByRole("button", { name: "Publish Website" });
  await publish.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Publish Website"));
    return b instanceof HTMLButtonElement && !b.disabled;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await publish.click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".rekixo-publish-stats span")].some(
      (x) => x.textContent?.includes("Status") && x.textContent?.includes("published"),
    ),
  );

  const publishState = await context.request.get(
    `${base}/api/admin/publish?projectId=${encodeURIComponent(projectId)}`,
  );
  const published = await publishState.json();
  assert.equal(published.publicStatus, "published");
  assert.equal(Number(published.publishVersion), 1);
  assert.equal(published.ready, true);
  await page.screenshot({ path: path.join(artifactDir, "admin-desktop-published.png"), fullPage: true });

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await context.storageState(),
  });
  const mobilePage = await mobile.newPage();
  watchPage(mobilePage, errors);
  await mobilePage.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForSelector(".super-shell");
  await chooseProject(mobilePage);
  await mobilePage.screenshot({ path: path.join(artifactDir, "admin-mobile-mapper.png"), fullPage: true });
  await mobile.close();

  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS login → project → mapper → sides → confirm → preview → publish");
}

async function customerJourney(browser) {
  for (const target of [
    { name: "desktop", viewport: { width: 1440, height: 1000 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    const errors = [];
    const context = await browser.newContext({
      viewport: target.viewport,
      isMobile: Boolean(target.isMobile),
      hasTouch: Boolean(target.hasTouch),
    });
    const page = await context.newPage();
    watchPage(page, errors);
    const response = await page.goto(`${base}/projects/${projectSlug}`, { waitUntil: "domcontentloaded" });
    assert.ok(response?.ok(), `${target.name} customer route`);

    const frame = page.frameLocator("iframe");
    const plot = frame.locator('.plot[data-plot-id="P-1"]');
    await plot.waitFor({ state: "attached" });
    assert.equal(await plot.getAttribute("data-status"), "available");
    assert.equal(await frame.locator("#countTotal").textContent(), "2");
    await frame.locator('.plot[data-plot-id="P-2"]').waitFor({ state: "attached" });
    await plot.click();
    await frame.locator("#drawer.open").waitFor({ state: "visible" });
    assert.equal(await frame.locator("#drawer").getAttribute("aria-hidden"), "false");

    await page.screenshot({
      path: path.join(artifactDir, `customer-${target.name}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS published customer desktop/mobile route");
}

const browser = await chromium.launch();
try {
  if (stage === "admin") await adminJourney(browser);
  else if (stage === "customer") await customerJourney(browser);
  else throw new Error(`Unknown E2E_STAGE: ${stage}`);
} finally {
  await browser.close();
}
