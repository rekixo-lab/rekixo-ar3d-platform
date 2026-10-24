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

async function clientDetailsJourney(browser) {
  assert.ok(auth?.clientEmail && auth?.otherClientEmail && auth?.password, "Client E2E credentials missing");
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watchPage(page, errors);
  page.on("dialog", (dialog) => dialog.accept());
  const endpoint = `${base}/api/client/plot-details`;
  const ownerName = "अमित शर्मा <private owner>";
  const brokerName = "राज वर्मा — निजी ब्रोकर";
  const row = page.getByRole("article", { name: "Plot P-1", exact: true });
  const form = page.getByRole("form", { name: "Booking details for Plot P-1", exact: true });

  async function list(request = context.request, override = "") {
    const response = await request.get(`${base}/api/data?section=plots&limit=100${override}`);
    assert.equal(response.ok(), true, `private plot list: ${response.status()}`);
    assert.match(response.headers()["cache-control"] || "", /no-store/, "private list must not cache");
    return response.json();
  }
  async function savedPlot() {
    const data = await list();
    const plot = data.plots.find((item) => item.id === "P-1");
    assert.ok(plot, "fixture plot returned");
    return plot;
  }
  async function patch(changes, expectedRevision, plotId = "P-1", extra = {}, origin = base) {
    return context.request.patch(endpoint, {
      headers: { origin },
      data: { plotId, expectedRevision, changes, ...extra },
    });
  }
  async function edit() {
    await row.getByRole("button", { name: /(?:Add|Edit) details for Plot P-1/ }).click();
    await form.waitFor({ state: "visible" });
  }
  async function saveFromForm() {
    const pending = page.waitForResponse((response) =>
      response.url() === endpoint && response.request().method() === "PATCH",
    );
    await form.getByRole("button", { name: "Save details", exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200, await response.text());
    await form.waitFor({ state: "hidden" });
    return response.json();
  }
  function coreOnly(plot) {
    const { adminDetails, ...core } = plot;
    void adminDetails;
    return core;
  }

  const anonymous = await browser.newContext();
  const denied = await anonymous.request.patch(endpoint, {
    headers: { origin: base },
    data: { plotId: "P-1", expectedRevision: 0, changes: { ownerName } },
  });
  assert.equal(denied.status(), 401, "anonymous private write denied");
  await anonymous.close();

  await page.goto(`${base}/projects/${projectSlug}/admin-login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("#login-id").fill(auth.clientEmail);
  await page.locator("#login-password").fill(auth.password);
  await page.getByRole("button", { name: "Sign In to Dashboard" }).click();
  await page.waitForURL(new RegExp(`/projects/${projectSlug}/admin/?$`));
  await page.locator(".role-client-admin").waitFor();
  await page.getByRole("button", { name: "Plots", exact: true }).click();
  await row.waitFor({ state: "visible" });
  const baseline = await savedPlot();
  const clientExport = await context.request.get(`${base}/api/admin/project-assets?projectId=${projectId}`);
  assert.equal(clientExport.status(), 403, "project backups remain Super Admin-only");
  assert.deepEqual(baseline.adminDetails, {
    ownerName: null, bookingAmountPaise: null, brokerName: null, revision: 0, updatedAt: null,
  }, "existing inventory works before any private-details backfill");

  await edit();
  await form.getByLabel("Plot owner", { exact: true }).fill(ownerName);
  await form.getByLabel("Booking amount", { exact: true }).fill("123456.78");
  await form.getByLabel("Broker", { exact: true }).fill(brokerName);
  const initial = await saveFromForm();
  assert.equal(initial.details.bookingAmountPaise, 12345678, "decimal rupees preserve paise exactly");
  assert.equal(initial.details.ownerName, ownerName, "Unicode owner saved");
  assert.equal(initial.details.brokerName, brokerName, "Unicode broker saved");
  await row.locator(".client-booking-owner dd").getByText(ownerName, { exact: true }).waitFor();
  assert.equal(await row.locator("private").count(), 0, "owner content remains text, not HTML");
  await page.screenshot({ path: path.join(artifactDir, "client-details-desktop.png"), fullPage: true });

  // Reload must wait for HTML and actual plot readiness, not global network idle:
  // the client dashboard now legitimately loads optional private Sales access.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Plots", exact: true }).click();
  await row.locator(".client-booking-owner dd").getByText(ownerName, { exact: true }).waitFor();
  await row.locator(".client-booking-broker dd").getByText(brokerName, { exact: true }).waitFor();
  await edit();
  assert.equal(await form.getByLabel("Booking amount", { exact: true }).inputValue(), "123456.78");
  await form.getByLabel("Booking amount", { exact: true }).fill("0");
  const zero = await saveFromForm();
  assert.equal(zero.details.bookingAmountPaise, 0, "zero booking differs from blank");
  await edit();
  assert.equal(await form.getByLabel("Booking amount", { exact: true }).inputValue(), "0");
  await form.getByLabel("Booking amount", { exact: true }).fill("");
  const blank = await saveFromForm();
  assert.equal(blank.details.bookingAmountPaise, null, "blank clears the booking amount");
  assert.deepEqual(coreOnly(await savedPlot()), coreOnly(baseline), "private saves leave geometry, status, area and plot timestamp untouched");

  const invalidCases = [
    { changes: { status: "sold" }, extra: {}, label: "unknown detail field" },
    { changes: { ownerName }, extra: { projectId: "e2e-details-other" }, label: "body project override" },
    { changes: { bookingAmount: 10.25 }, extra: {}, label: "floating point API amount" },
    { changes: { bookingAmount: "1.234" }, extra: {}, label: "fractional paise" },
    { changes: { bookingAmount: "-1" }, extra: {}, label: "negative amount" },
  ];
  for (const item of invalidCases) {
    const response = await patch(item.changes, blank.details.revision, "P-1", item.extra);
    assert.equal(response.status(), 400, item.label);
  }
  assert.equal((await patch({ ownerName }, blank.details.revision, "P-1", {}, "https://outside.example")).status(), 403, "cross-origin private write denied");
  assert.equal((await patch({ ownerName }, 0, "OTHER-ONLY")).status(), 404, "other-project-only plot is inaccessible");
  assert.deepEqual((await savedPlot()).adminDetails, blank.details, "rejected requests preserve existing details");

  const scoped = await list(context.request, "&projectId=e2e-details-other");
  assert.equal(scoped.plots.some((plot) => plot.id === "OTHER-ONLY"), false, "query project override cannot read another client inventory");
  assert.equal(scoped.plots.find((plot) => plot.id === "P-1")?.sqft, baseline.sqft, "duplicate plot ID stays scoped to current project");

  await edit();
  const pendingOwner = "मेरी सुरक्षित ड्राफ्ट जानकारी";
  await form.getByLabel("Plot owner", { exact: true }).fill(pendingOwner);
  const concurrent = await patch({ brokerName: "दूसरे एडमिन का अपडेट" }, blank.details.revision);
  assert.equal(concurrent.status(), 200);
  const current = await concurrent.json();
  const conflictPromise = page.waitForResponse((response) => response.url() === endpoint && response.status() === 409);
  await form.getByRole("button", { name: "Save details", exact: true }).click();
  await conflictPromise;
  assert.equal(await form.getByLabel("Plot owner", { exact: true }).inputValue(), pendingOwner, "revision conflict preserves typed draft");
  assert.deepEqual((await savedPlot()).adminDetails, current.details, "stale save cannot overwrite another admin");
  await form.getByRole("button", { name: "Reload saved details", exact: true }).click();
  await page.waitForFunction((expected) => {
    const input = document.querySelector('form[aria-label="Booking details for Plot P-1"] input');
    return input instanceof HTMLInputElement && input.value === expected;
  }, ownerName);
  await form.getByRole("button", { name: "Cancel", exact: true }).click();

  await edit();
  await form.getByLabel("Plot owner", { exact: true }).fill(pendingOwner);
  const search = page.getByPlaceholder("Plot number search", { exact: true });
  await search.fill("P-2");
  await page.locator(".client-booking-pinned").waitFor({ state: "visible" });
  assert.equal(await form.getByLabel("Plot owner", { exact: true }).inputValue(), pendingOwner, "filtering inventory preserves the open draft");
  await search.fill("");
  await row.waitFor({ state: "visible" });
  await page.route("**/api/client/plot-details", (route) => route.abort("failed"));
  await form.getByRole("button", { name: "Save details", exact: true }).click();
  await form.getByRole("button", { name: "Save details", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const form = document.querySelector('form[aria-label="Booking details for Plot P-1"]');
    return Boolean(form?.querySelector('[role="alert"]'));
  });
  assert.equal(await form.getByLabel("Plot owner", { exact: true }).inputValue(), pendingOwner, "network failure preserves draft");
  await page.unroute("**/api/client/plot-details");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual((await savedPlot()).adminDetails, current.details, "failed network save has no database effect");

  await edit();
  await form.getByLabel("Booking amount", { exact: true }).fill("50000.50");
  const finalSave = await saveFromForm();
  for (const status of ["booked", "sold", "available"]) {
    const update = page.waitForResponse((response) => response.url() === `${base}/api/data` && response.request().method() === "POST");
    await row.getByLabel("P-1 status", { exact: true }).selectOption(status);
    assert.equal((await update).status(), 200);
    assert.deepEqual((await savedPlot()).adminDetails, finalSave.details, `status ${status} preserves private details`);
  }

  // Public reads use a fresh anonymous session and both the combined and split
  // runtime endpoints. Inspect raw JSON as well as keys to catch serialization leaks.
  const publicContext = await browser.newContext();
  for (const suffix of [
    `/api/public-data?projectSlug=${projectSlug}`,
    `/api/public-data?projectSlug=${projectSlug}&view=structure&pv=1`,
    `/api/public-live?projectSlug=${projectSlug}`,
  ]) {
    const response = await publicContext.request.get(`${base}${suffix}`);
    assert.equal(response.status(), 200, `public privacy endpoint ${suffix}`);
    const body = await response.text();
    for (const secret of [ownerName, brokerName, "दूसरे एडमिन का अपडेट", "ownerName", "owner_name", "brokerName", "broker_name", "bookingAmount", "booking_amount", "adminDetails"]) {
      assert.equal(body.includes(secret), false, `public response excludes ${secret}`);
    }
  }
  await publicContext.close();

  const otherContext = await browser.newContext();
  const otherLogin = await otherContext.request.post(`${base}/api/admin/login`, {
    headers: { origin: base },
    data: { loginId: auth.otherClientEmail, password: auth.password, projectSlug: "details-other-e2e" },
  });
  assert.equal(otherLogin.status(), 200, "other fixture client authenticates");
  const otherRows = await list(otherContext.request);
  assert.equal(otherRows.plots.find((plot) => plot.id === "P-1")?.adminDetails?.revision, 0, "same plot ID in another project stays untouched");
  await otherContext.close();

  for (const width of [390, 320]) {
    const mobile = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      storageState: await context.storageState(),
    });
    const mobilePage = await mobile.newPage();
    watchPage(mobilePage, errors);
    // The dashboard performs background permission/meta reads; await visible plot rows instead of networkidle.
    await mobilePage.goto(`${base}/projects/${projectSlug}/admin`, { waitUntil: "domcontentloaded" });
    await mobilePage.getByRole("button", { name: "Plots", exact: true }).click();
    const mobileRow = mobilePage.getByRole("article", { name: "Plot P-1", exact: true });
    await mobileRow.locator(".client-booking-mobile-owner").getByText(ownerName, { exact: true }).waitFor();
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}px page has no horizontal overflow`);
    const cardBox = await mobileRow.boundingBox();
    assert.ok(cardBox && cardBox.height < 165, `${width}px saved details fit within a compact two-row card`);
    const compact = await mobileRow.evaluate((card) => {
      const meta = card.querySelector(".client-booking-mobile-meta");
      const desktop = card.querySelector(".client-booking-owner");
      const action = card.querySelector(".client-booking-edit");
      const area = card.querySelector(".client-booking-area");
      const status = card.querySelector(".client-booking-status");
      return {
        metaVisible: meta && getComputedStyle(meta).display !== "none",
        desktopHidden: desktop && getComputedStyle(desktop).display === "none",
        actionHeight: action?.getBoundingClientRect().height,
        actionWidth: action?.getBoundingClientRect().width,
        areaOverflow: area && area.scrollWidth > area.clientWidth,
        statusHeight: status?.getBoundingClientRect().height,
      };
    });
    assert.equal(Boolean(compact.metaVisible && compact.desktopHidden), true, "phone shows only compact detail summary");
    assert.ok(compact.actionHeight >= 44 && compact.actionWidth < 130, "mobile Edit remains easy to tap without wasting width");
    assert.ok(compact.statusHeight >= 44, "mobile status dropdown stays touch accessible");
    const emptyRow = mobilePage.getByRole("article", { name: "Plot P-2", exact: true });
    const emptyAction = await emptyRow.getByRole("button", { name: "Add details for Plot P-2" }).boundingBox();
    assert.ok(emptyAction && emptyAction.height >= 44 && emptyAction.width < 130, "Available plot uses compact Add action");
    await mobileRow.getByRole("button", { name: "Edit details for Plot P-1" }).click();
    const mobileForm = mobilePage.getByRole("form", { name: "Booking details for Plot P-1", exact: true });
    await mobileForm.getByLabel("Booking amount", { exact: true }).waitFor();
    assert.equal(await mobileForm.getByLabel("Booking amount", { exact: true }).getAttribute("inputmode"), "decimal", "mobile amount keyboard supports paise");
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}px editing form has no overflow`);
    await mobilePage.screenshot({ path: path.join(artifactDir, `client-details-mobile-${width}-edit.png`), fullPage: true });
    if (width === 390) {
      // A semantically identical amount still lets the real mobile Save button
      // exercise scrolling past the fixed bottom navigation without changing data.
      await mobileForm.getByLabel("Booking amount", { exact: true }).fill("50000.5");
      const mobileSave = mobilePage.waitForResponse((response) => response.url() === endpoint && response.request().method() === "PATCH");
      await mobileForm.getByRole("button", { name: "Save details", exact: true }).click();
      assert.equal((await mobileSave).status(), 200, "mobile Save remains reachable above bottom navigation");
      await mobileForm.waitFor({ state: "hidden" });
    } else {
      await mobileForm.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await mobilePage.screenshot({ path: path.join(artifactDir, `client-details-mobile-${width}.png`), fullPage: true });
    await mobile.close();
  }
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS Client Admin details: Unicode + exact paise → reload → zero/blank → security/isolation → stale/network draft retention → status preservation → public privacy → compact 390/320px mobile");
}

async function detailsBackupJourney(browser) {
  const context = await browser.newContext();
  const login = await context.request.post(`${base}/api/admin/login`, {
    headers: { origin: base }, data: { loginId: auth.email, password: auth.password },
  });
  assert.equal(login.status(), 200, "Super Admin authenticates for private backup");
  const manifestResponse = await context.request.get(`${base}/api/admin/project-assets?projectId=${projectId}`);
  assert.equal(manifestResponse.status(), 200, "project backup manifest generated");
  const manifest = await manifestResponse.json();
  assert.equal(manifest.counts.plotAdminDetails, 1, "backup counts private details");
  const jsonPath = "01-project-data/private-plot-details.json";
  const csvPath = "01-project-data/private-plot-details.csv";
  for (const filename of [jsonPath, csvPath]) {
    assert.ok(manifest.files.some((file) => file.path === filename), `backup manifest includes ${filename}`);
  }
  const zipResponse = await context.request.get(`${base}/api/admin/project-assets/download?projectId=${projectId}`);
  assert.equal(zipResponse.status(), 200, "streamed backup ZIP generated");
  assert.match(zipResponse.headers()["cache-control"] || "", /no-store/, "private backups must never be cached");
  const zip = await zipResponse.body();
  // Use ZIP's central directory for the streaming STORE format. Local headers
  // intentionally use data descriptors, so their initial lengths may be zero.
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "backup ZIP has a central directory");
  const entries = new Map();
  let cursor = zip.readUInt32LE(end + 16);
  const entryCount = zip.readUInt16LE(end + 10);
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, "central directory entry signature");
    assert.equal(zip.readUInt16LE(cursor + 10), 0, "backup uses lossless STORE entries");
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const contentStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    entries.set(name, zip.subarray(contentStart, contentStart + size));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.ok(entries.has(jsonPath) && entries.has(csvPath), "private files actually exist inside ZIP");
  const rows = JSON.parse(entries.get(jsonPath).toString("utf8"));
  assert.equal(rows.length, 1);
  const listResponse = await context.request.get(`${base}/api/data?section=plots&projectId=${projectId}`);
  const plots = (await listResponse.json()).plots;
  const saved = plots.find((plot) => plot.id === "P-1").adminDetails;
  assert.equal(rows[0].projectId, projectId);
  assert.equal(rows[0].plotId, "P-1");
  for (const field of ["ownerName", "bookingAmountPaise", "brokerName", "revision", "updatedAt"]) {
    assert.equal(rows[0][field], saved[field], `backup preserves ${field}`);
  }
  assert.equal(rows[0].bookingAmountPaise, 5000050, "backup preserves the exact decimal booking amount");
  assert.ok(entries.get(csvPath).toString("utf8").includes("5000050"), "CSV backup preserves integer paise");
  const raw = zip.toString("utf8");
  assert.equal(raw.includes(auth.password), false, "backup excludes login password");
  assert.equal(/"(?:passwordHash|password_hash)"\s*:/.test(raw), false, "backup excludes password hash fields");
  await context.close();
  console.log("PASS Super Admin backup: private JSON/CSV in real streamed ZIP retain exact saved details and exclude credentials");
}

const browser = await chromium.launch(process.env.PLOT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLOT_CHROMIUM_EXECUTABLE_PATH }
  : {});
try {
  if (stage === "admin") await adminJourney(browser);
  else if (stage === "client-details") await clientDetailsJourney(browser);
  else if (stage === "details-backup") await detailsBackupJourney(browser);
  else if (stage === "customer") await customerJourney(browser);
  else throw new Error(`Unknown E2E_STAGE: ${stage}`);
} finally {
  await browser.close();
}
