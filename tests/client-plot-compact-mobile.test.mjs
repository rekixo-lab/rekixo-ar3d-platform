import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [tsx, css, dashboard] = await Promise.all([
  readFile(new URL("../app/client-plot-management.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/client-plot-management.css", import.meta.url), "utf8"),
  readFile(new URL("../app/admin-dashboard.tsx", import.meta.url), "utf8"),
]);

test("compact layout is restricted to phone-size Client Admin; desktop details remain intact", () => {
  assert.match(css, /REKIXO_CLIENT_BOOKING_COMPACT_MOBILE_V1/);
  const compact = css.split("REKIXO_CLIENT_BOOKING_COMPACT_MOBILE_V1")[1];
  assert.match(compact, /@media \(max-width: 600px\)/);
  assert.doesNotMatch(compact, /@media \(min-width/);
  for (const selector of [
    ".client-booking-summary",
    ".client-booking-status",
    ".client-booking-mobile-meta",
    ".client-booking-edit",
    ".client-booking-editor",
    ".client-booking-fields input",
    ".client-booking-form-footer button",
  ]) {
    assert.ok(compact.includes(".admin-shell.role-client-admin " + selector),
      "phone-only selector missing: " + selector);
  }
  assert.match(css, /\.client-booking-column-head, \.client-booking-summary \{ display: grid/);
  assert.match(css, /\.client-booking-column-head \{ padding:/);
  assert.match(css, /\.client-booking-mobile-meta, \.client-booking-edit-mobile \{ display: none; \}/);
});

test("compact summary preserves full private booking detail fields and control handlers", () => {
  assert.match(tsx, /className="client-booking-mobile-meta"/);
  assert.match(tsx, /className="client-booking-mobile-owner"/);
  assert.match(tsx, /className="client-booking-mobile-amount"/);
  assert.match(tsx, /className="client-booking-edit-desktop"/);
  assert.match(tsx, /className="client-booking-edit-mobile" aria-hidden="true"/);
  assert.match(tsx, /aria-expanded=\{open\}/);
  assert.match(tsx, /onClick=\{\(\) => openEditor\(plot\)\}/);
  assert.match(tsx, /onChange=\{\(event\) => onStatusChange\(plot, event\.target\.value\)\}/);
  assert.match(tsx, /onSubmit=\{saveDetails\}/);
  assert.match(tsx, /expectedRevision: editor\.baseline\.revision/);
  assert.match(tsx, /response\.status === 409/);
  assert.match(tsx, /Unsaved booking details discard/);
  assert.match(tsx, /className="client-booking-pinned"/);
  assert.match(dashboard, /const PLOT_PAGE_SIZE=250;/);
});

test("mobile editor retains accessible phone-sized inputs and tap controls", () => {
  const compact = css.split("REKIXO_CLIENT_BOOKING_COMPACT_MOBILE_V1")[1];
  assert.match(compact, /\.client-booking-fields input \{[\s\S]*?min-height: 44px;[\s\S]*?font-size: 16px;/);
  assert.match(compact, /\.client-booking-form-footer button \{[\s\S]*?min-height: 44px;/);
  assert.match(compact, /\.client-booking-edit,[\s\S]*?min-height: 44px;/);
  assert.match(tsx, /className="client-booking-fields"/);
  assert.match(tsx, /className="client-booking-cancel"/);
  assert.match(tsx, /className="client-booking-save"/);
  assert.match(tsx, /aria-label=\{open \? `Close booking editor for /);
});
