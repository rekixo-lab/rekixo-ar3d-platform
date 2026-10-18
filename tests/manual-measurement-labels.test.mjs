import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const src = await readFile(new URL("../app/manual-measurement-labels.ts", import.meta.url), "utf8");
const runtime = src
  .replace(/: "ft" \| "m"/g, "")
  .replace(/: number \| null \| undefined/g, "")
  .replace(/: string \| null \| undefined/g, "")
  .replace(/: number \| null/g, "")
  .replace(/: string \| null/g, "")
  .replace(/export function/g, "function");
const reconcile = runInNewContext(runtime + "\nsyncManualDimensionLabel", {});

test("repair stale front/back labels even if numeric values were previously saved", () => {
  assert.equal(reconcile(29, 29, "33'-8\"", "ft", "ft"), "29 ft");
  assert.equal(reconcile(33, 33, "33'-8\"", "ft", "ft"), "33 ft");
  assert.equal(reconcile(41.8, 41.8, "41'-8\"", "ft", "ft"), "41.8 ft");
});
test("keep genuinely matching precise imported labels and alternate-side metadata", () => {
  assert.equal(reconcile(33 + 8 / 12, 33 + 8 / 12, "33'-8\"", "ft", "ft"), "33'-8\"");
  assert.equal(reconcile(null, null, "Source-only", "ft", "ft"), "Source-only");
  assert.equal(reconcile(29, 29, "29 ft", "ft", "ft"), "29 ft");
  assert.equal(reconcile(9, 9, "9 m", "m", "m"), "9 m");
});
test("manual unit changes and clearing stale numeric labels", () => {
  assert.equal(reconcile(9, 29, "29 ft", "m", "ft"), "9 m");
  assert.equal(reconcile(null, 29, "33 ft", "ft", "ft"), null);
});
