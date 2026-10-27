import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLOT_PLAYWRIGHT_MODULE).href);
const root = process.cwd();
const artifactDir = path.join(root, "artifacts", "public-runtime-e2e");
fs.mkdirSync(artifactDir, { recursive: true });

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

function json(res, value, headers = {}) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value));
}

let liveStatus = "booked";

const structure = {
  projectId: "e2e-project",
  projectName: "Browser Regression Project",
  slug: "browser-regression-project",
  preview: false,
  publishVersion: 1,
  settings: {
    projectName: "Browser Regression Project",
    brandName: "Rekixo",
    brandShort: "RKP",
    location: "Test City",
    address: "Village Bivipur Bibipur, Tehsil Rajpura, District Patiala, Punjab, India - Browser Runtime Animation Verification Address",
    mapWidth: "1200",
    mapHeight: "2133",
    publicRotation: "0",
    pricingEnabled: "1",
  },
  plots: [
    {
      id: "P-1",
      sqft: 1000,
      sqm: 92.903,
      sqyd: 111.111,
      dimensions: "20 ft x 50 ft",
      road: "30 ft road",
      front: 20,
      back: 20,
      depth: 50,
      depth2: 50,
      dimensionUnit: "ft",
      frontEdgeIndex: 0,
      depthEdgeIndex: 1,
      backEdgeIndex: 2,
      depth2EdgeIndex: 3,
      edgeSemantics: JSON.stringify({
        v: 1,
        layout: "four",
        roles: { front: [0], depthA: [1], back: [2], depthB: [3] },
      }),
      polygon: JSON.stringify([
        [0.18, 0.2],
        [0.38, 0.2],
        [0.38, 0.42],
        [0.18, 0.42],
      ]),
      status: "available",
      featured: false,
    },
  ],
  gallery: [],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/public-data") {
    assert.equal(url.searchParams.get("view"), "structure");
    assert.equal(url.searchParams.get("pv"), "1");
    return json(res, structure, {
      "cache-control": "public,max-age=31536000,immutable",
      "x-rekixo-publish-version": "1",
    });
  }
  if (url.pathname === "/api/public-live") {
    return json(res, {
      projectId: "e2e-project",
      pricingEnabled: true,
      settings: { phone1: "+911234567890", whatsapp: "+911234567890" },
      statuses: [{ id: "P-1", status: liveStatus }],
      pricing: [
        {
          plotId: "P-1",
          pricingType: "fixed",
          unit: "sqyd",
          rate: null,
          fixedPrice: 2500000,
          currency: "INR",
        },
      ],
    }, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/public-plot-notices") {
    return json(res, {
      enabled: true,
      notices: [{
        id: "e2e-news", eventDate: "2026-10-12", category: "deal",
        label: "Agreement Done", plotIds: ["P-1"], publishedAt: "2026-10-12T12:00:00Z",
      }],
    }, {"cache-control":"no-store"});
  }
  if (url.pathname === "/api/public-gallery") {
    return json(res, {
      projectId: "e2e-project",
      gallery: [{ id: "g1", caption: "Site View", filename: "site.png" }],
    });
  }
  if (url.pathname === "/api/gallery/g1") {
    res.writeHead(200, {
      "content-type": "image/png",
      "cache-control": "no-store",
      "content-length": String(tinyPng.length),
    });
    return res.end(tinyPng);
  }
  if (url.pathname.startsWith("/api/project-asset/")) {
    res.writeHead(404);
    return res.end();
  }

  const relative =
    url.pathname === "/" ? "public/project/index.html" :
    url.pathname.startsWith("/project/") ? "public" + url.pathname :
    null;
  if (!relative) {
    res.writeHead(404);
    return res.end("not found");
  }
  const full = path.join(root, relative);
  if (!full.startsWith(path.join(root, "public")) || !fs.existsSync(full)) {
    res.writeHead(404);
    return res.end("not found");
  }
  const ext = path.extname(full);
  const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(full).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
try {
  for (const target of [
    { name: "desktop", viewport: { width: 1440, height: 1000 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    liveStatus = "booked";
    const context = await browser.newContext({
      viewport: target.viewport,
      isMobile: Boolean(target.isMobile),
      hasTouch: Boolean(target.hasTouch),
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(
      `${base}/project/index.html?projectId=e2e-project&pv=1&v=67`,
      { waitUntil: "networkidle" },
    );

    await page.waitForSelector('.plot[data-plot-id="P-1"]', { state: "attached" });
    await page.locator("#plotNewsBell").waitFor({state:"visible"});
    await page.locator("#plotNewsBanner.is-shown").waitFor({state:"visible"});
    const plotNoticeGeometry=await page.locator("#plotNewsBanner").evaluate(el=>{
      const box=el.getBoundingClientRect(),style=getComputedStyle(el);
      return {width:box.width,right:box.right,left:box.left,nowrap:style.whiteSpace==="nowrap",
        ellipsis:getComputedStyle(el.querySelector(".plot-news-line")).textOverflow};
    });
    assert.ok(plotNoticeGeometry.width <= target.viewport.width && plotNoticeGeometry.left >= -2 &&
       plotNoticeGeometry.right <= target.viewport.width+2,
       target.name+" notice must stay within viewport width");
    assert.equal(plotNoticeGeometry.nowrap,true,target.name+" update must be single-line");
    assert.equal(plotNoticeGeometry.ellipsis,"ellipsis",target.name+" long notice text must truncate");
    const newsVisual=await page.locator("#plotNewsBanner").evaluate(el=>{
      const title=el.querySelector(".plot-news-title"),text=el.querySelector(".plot-news-line"),spark=el.querySelector(".plot-news-spark");
      return {background:getComputedStyle(el).backgroundColor,
        title:title?.textContent?.replace(/\s+/g," ").trim(),
        titleColor:title?getComputedStyle(title).color:"",
        contentColor:text?getComputedStyle(text).color:"",
        sparkColor:spark?getComputedStyle(spark).color:"",
        singleLine:getComputedStyle(el).whiteSpace==="nowrap"};
    });
    assert.equal(newsVisual.background,"rgb(255, 235, 0)",target.name+" yellow header notice");
    assert.match(newsVisual.title||"",/New Updates In.*Plot Status/i);
    for(const color of [newsVisual.titleColor,newsVisual.contentColor,newsVisual.sparkColor])
      assert.equal(color,"rgb(185, 28, 28)",target.name+" red title, text and lightning");
    assert.equal(newsVisual.singleLine,true);
    await page.locator("#plotNewsBell").click();
    await page.locator("#plotNewsHistory").waitFor({state:"visible"});
    assert.match(await page.locator("#plotNewsContent").innerText(),/Agreement Done/);
    await page.locator("#plotNewsHistoryClose").click();


    if (target.name === "desktop") {
      await page.waitForFunction(() => {
        const lane = document.querySelector("#brandSubtitle");
        const track = document.querySelector("#brandSubtitleTrack");
        return Boolean(
          lane?.classList.contains("is-desktop-pan") &&
          track &&
          track.scrollWidth > lane.clientWidth &&
          track.getAnimations().length > 0
        );
      });
      const desktopTicker = await page.evaluate(() => {
        const lane = document.querySelector("#brandSubtitle");
        const track = document.querySelector("#brandSubtitleTrack");
        const animation = track?.getAnimations()?.[0];
        if (!lane || !track || !animation) return null;
        const timing = animation.effect?.getComputedTiming?.();
        const duration = Number(timing?.duration || 0);
        const startTransform = getComputedStyle(track).transform;
        animation.currentTime = duration * 0.56;
        const endTransform = getComputedStyle(track).transform;
        animation.currentTime = duration * 0.98;
        const returnTransform = getComputedStyle(track).transform;
        return {
          overflow: track.scrollWidth - lane.clientWidth,
          duration,
          startTransform,
          endTransform,
          returnTransform,
        };
      });
      assert.ok(desktopTicker, "desktop subtitle animation should exist");
      assert.ok(desktopTicker.overflow > 3, "desktop subtitle fixture must overflow");
      assert.ok(desktopTicker.duration >= 20000, "desktop subtitle motion should stay deliberately slow");
      assert.notEqual(
        desktopTicker.endTransform,
        desktopTicker.startTransform,
        "desktop subtitle should move toward the last text",
      );
      assert.notEqual(
        desktopTicker.endTransform,
        desktopTicker.returnTransform,
        "desktop subtitle should return toward its starting position",
      );
    } else {
      assert.equal(
        await page.locator("#brandSubtitle").evaluate((el) => el.classList.contains("is-desktop-pan")),
        false,
        "mobile must not use the desktop subtitle animation",
      );
    }

    assert.equal(
      await page.locator('.plot[data-plot-id="P-1"]').getAttribute("data-status"),
      "booked",
      target.name + " should merge compact live status into cached structure",
    );
    assert.equal(
      await page.locator("#countBooked").textContent(),
      "1",
      target.name + " booked count",
    );

    // A customer can keep the site open while an admin changes live status.
    // Exercise the immediate visibility-refresh path instead of waiting 30s.
    liveStatus = "sold";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => {
      const plot = document.querySelector('.plot[data-plot-id="P-1"]');
      return plot?.getAttribute("data-status") === "sold";
    });
    assert.equal(await page.locator("#countSold").textContent(), "1", target.name + " sold refresh");
    assert.equal(await page.locator("#countBooked").textContent(), "0", target.name + " booked refresh");

    // Probe real browser hit-testing before clicking: on some viewports the
    // polygon's bounding rectangle includes space outside the SVG polygon or
    // behind a floating control. Never force a click or bypass pointer routing.
    const plot = page.locator('.plot[data-plot-id="P-1"]');
    const hitPoint = await plot.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const svg = element.ownerSVGElement;
      if (!svg || !box.width || !box.height) return null;
      const candidates = [
        [0.5, 0.5], [0.25, 0.25], [0.75, 0.25],
        [0.25, 0.5], [0.75, 0.5], [0.5, 0.25],
        [0.25, 0.75], [0.75, 0.75], [0.5, 0.75],
      ];
      for (const [fx, fy] of candidates) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit === element || (hit instanceof Element && element.contains(hit))) {
          return { x: box.width * fx, y: box.height * fy };
        }
      }
      return null;
    });
    assert.ok(hitPoint, target.name + " polygon needs a visible hittable point");
    await plot.click({ position: hitPoint });
    await page.locator("#drawer.open").waitFor({ state: "visible" });
    const drawerBox = await page.locator("#drawer").boundingBox();
    assert.ok(drawerBox, target.name + " plot drawer should have a box");
    if (target.name === "desktop") {
      assert.ok(
        drawerBox.width >= 379 && drawerBox.width <= 431,
        "desktop plot drawer should stay compact instead of covering most of the viewport",
      );
    } else {
      assert.ok(
        Math.abs(drawerBox.width - target.viewport.width) <= 2,
        "mobile plot drawer should remain full-screen width",
      );
    }
    await page.locator("#closeBtn").click();
    await page.waitForFunction(() => !document.querySelector("#drawer")?.classList.contains("open"));

    await page.locator("#galleryBtn").click();
    await page.waitForSelector(".client-gallery article");
    assert.equal(await page.locator(".client-gallery article").count(), 1);
    assert.match(await page.locator(".client-gallery article b").textContent(), /Site View/);

    await page.screenshot({
      path: path.join(artifactDir, target.name + ".png"),
      fullPage: true,
    });

    // Verify the real Metro-only display and live Agreement Done state without changing
    // canonical filter identifiers, booked inventory, 2D/3D layout, or another tenant.
    assert.match(await page.locator('[data-status-filter="booked"] span').innerText(),/Booked/);
    let metroAgreementDone=false;
    await page.route("**/api/public-data**",async route=>{
      await route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({...structure,metroAgreementEnabled:true,
          plots:structure.plots.map(p=>({...p,agreementDone:false}))})});
    });
    await page.route("**/api/public-live**",async route=>{
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        projectId:"e2e-project",metroAgreementEnabled:true,pricingEnabled:false,
        settings:{},statuses:[{id:"P-1",status:"booked",agreementDone:metroAgreementDone}],
        pricing:[]
      })});
    });
    await page.goto(base+"/project/index.html?projectId=e2e-project&pv=1&v=metro-agreement",{
      waitUntil:"networkidle"
    });
    await page.waitForSelector('.plot[data-plot-id="P-1"]',{state:"attached"});
    await page.waitForFunction(()=>{
      const el=document.querySelector('[data-status-filter="booked"] span');
      return el?.textContent?.includes("Registered")&&document.querySelector("#countBooked")?.textContent==="1";
    });
    assert.equal(await page.locator('.plot[data-plot-id="P-1"]').getAttribute("data-status"),"booked",
      target.name+" original booked inventory must remain unchanged");
    await page.locator("#searchInput").fill("P-1");
    await page.locator("#searchForm").evaluate(form=>form.requestSubmit());
    await page.locator("#drawer.open").waitFor({state:"visible"});
    await page.locator("#metroAgreementRow").waitFor({state:"visible"});
    assert.match(await page.locator("#plotStatusValue").innerText(),/Registered/);
    assert.match(await page.locator("#metroAgreementValue").innerText(),/Agreement Pending/);
    metroAgreementDone=true;
    await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(()=>document.querySelector("#metroAgreementValue")?.textContent==="Agreement Done");
    metroAgreementDone=false;
    await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(()=>document.querySelector("#metroAgreementValue")?.textContent==="Agreement Pending");
    await page.screenshot({path:path.join(artifactDir,target.name+"-metro-agreement.png"),fullPage:true});

    assert.deepEqual(errors, [], target.name + " browser console/page errors");
    await context.close();
  }
  console.log("PASS public runtime desktop/mobile browser regression");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
