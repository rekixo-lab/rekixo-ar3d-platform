import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");

test("GEETAI GROUP alone opts in to the compact mobile WhatsApp header button", () => {
  assert.match(html, /GEETAI_GROUP_MOBILE_WHATSAPP_V1/);
  assert.match(html, /const geetaiGroup=resolvedName\.replace\(\/\\s\+\/g,' '\)\.toUpperCase\(\)==='GEETAI GROUP'/);
  assert.match(html, /document\.body\.classList\.toggle\('geetai-mobile-whatsapp',geetaiGroup\)/);
  assert.match(html, /body\.geetai-mobile-whatsapp #waTop\{[\s\S]*?display:inline-flex/);
  assert.match(html, /body\.geetai-mobile-whatsapp #waTop span\{display:none\}/);
  assert.match(html, /body\.geetai-mobile-whatsapp #callTop\{order:1\}/);
  assert.match(html, /body\.geetai-mobile-whatsapp #outlineTop\{order:3\}/);

  // Default mobile WhatsApp visibility for all other projects is unchanged.
  assert.match(html, /\.header-whatsapp\{display:none\}/);
  assert.match(html, /@media\(max-width:700px\)\{/);
  assert.match(html, /id="callTop"/);
  assert.match(html, /id="waTop"/);
  assert.match(html, /id="outlineTop"/);
});

test("GEETAI WhatsApp number never changes another tenant's contact or the Call number", () => {
  assert.match(html, /if\(geetaiGroup\)WHATSAPP_PHONE='917875137172'/);
  assert.match(html, /const resolvedCall=primary\|\|secondary;/);
  assert.match(html, /CALL_PHONE=resolvedCall;/);

  const functionCode = html.match(/  function projectWhatsappDigits\(project\)\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(functionCode, "Contact enhancer must expose the tenant-scoped resolver");
  const createResolver = (live) => new Function(
    "window", "safeText", "normalizeDigits", "FALLBACK",
    functionCode + "\nreturn projectWhatsappDigits;",
  )(
    { REKIXO_PUBLIC_DATA: live },
    (value) => String(value ?? "").trim(),
    (value) => String(value || "").replace(/\D+/g, ""),
    { whatsapp: "" },
  );

  const geetai = createResolver({ settings: { projectName: "Geetai   Group" } });
  assert.equal(geetai({ whatsapp: "919999999999", phone1: "918888888888" }), "917875137172");

  const other = createResolver({ settings: { projectName: "OTHER PROJECT" } });
  assert.equal(other({ whatsapp: "+91 90000 12345", phone1: "918888888888" }), "919000012345");
  assert.equal(other({ phone1: "+91 90000 12345" }), "919000012345");

  const similar = createResolver({ settings: { projectName: "GEETAI GROUP PHASE 2" } });
  assert.equal(similar({ whatsapp: "919999999999" }), "919999999999");
});

test("both the header and delegated WhatsApp actions use the same project resolver", () => {
  assert.equal((html.match(/const waDigits = projectWhatsappDigits\(project\);/g) || []).length, 2);
  assert.match(html, /q\('#waBtn'\)\.onclick=openWhatsApp/);
  assert.match(html, /const waTop=q\('#waTop'\);if\(waTop\)waTop\.onclick=openWhatsApp/);
});

test("GEETAI mobile header has breathing room around all three actions at small widths", () => {
  assert.match(html, /GEETAI_GROUP_MOBILE_ICON_SPACING_V2/);
  assert.match(html, /body\.geetai-mobile-whatsapp \.head-actions\{\s*gap:8px;\s*padding:2px;\s*margin-right:2px/);
  assert.match(html, /body\.geetai-mobile-whatsapp \.head-actions \.icon\{[\s\S]*?padding:6px/);
  assert.match(html, /body\.geetai-mobile-whatsapp #waTop\{[\s\S]*?padding:6px/);
  assert.match(html, /@media\(max-width:360px\)\{[\s\S]*?body\.geetai-mobile-whatsapp \.head-actions\{gap:6px\}/);
});

test("GEETAI header reuses the exact WhatsApp SVG from the plot sidebar", () => {
  const header = html.slice(html.indexOf('<header class="header">'), html.indexOf('</header>'));
  const headerButton = header.match(/<button class="header-whatsapp" id="waTop"[\s\S]*?<\/button>/)?.[0];
  const sidebarButton = html.match(/<button class="action wa" id="waBtn"[\s\S]*?<\/button>/)?.[0];
  assert.ok(headerButton);
  assert.ok(sidebarButton);

  const svgPath = (source) => source.match(/<svg[^>]*><path d="([^"]+)"/)?.[1];
  assert.equal(svgPath(headerButton), svgPath(sidebarButton));
  assert.equal((headerButton.match(/<svg /g) || []).length, 1);
  assert.doesNotMatch(html, /geetai-wa-outline/);
  assert.match(html, /body\.geetai-mobile-whatsapp #waTop svg\{\s*display:block;width:20px;height:20px;flex:none;fill:currentColor/);
});

test("GEETAI Call -> WhatsApp -> Client Admin order and WhatsApp button style remain unchanged", () => {
  assert.match(html, /body\.geetai-mobile-whatsapp #callTop\{order:1\}/);
  assert.match(html, /body\.geetai-mobile-whatsapp #waTop\{\s*order:2;display:inline-flex/);
  assert.match(html, /body\.geetai-mobile-whatsapp #outlineTop\{order:3\}/);
  assert.match(html, /width:36px;height:36px;min-width:36px;padding:6px;box-sizing:border-box;/);
  assert.match(html, /border-radius:11px;border:1px solid #12b95e;/);
  assert.match(html, /background:#13c968;color:#fff;box-shadow:0 6px 14px #0004/);
  assert.match(html, /body\.geetai-mobile-whatsapp #waTop span\{display:none\}/);
});
