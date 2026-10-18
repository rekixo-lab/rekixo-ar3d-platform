import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const src = await readFile(new URL("../app/manual-measurement-labels.ts", import.meta.url), "utf8");
const runtime = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText.replace(/export\s+function/g, "function");
const reconcile = runInNewContext(runtime + "\nsyncManualDimensionLabel", { exports: {} });

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

test("decimal feet inputs are exact and must not retain near-but-wrong labels", () => {
  assert.equal(reconcile(29.1, 29.1, "29.11 ft", "ft", "ft"), "29.1 ft");
  assert.equal(reconcile(29.1, 29.1, "29.11'", "ft", "ft"), "29.1 ft");
  assert.equal(reconcile(29.1, 29.1, "29'-11\"", "ft", "ft"), "29.1 ft");
  assert.equal(reconcile(29.11, 29.11, "29.1 ft", "ft", "ft"), "29.11 ft");
  assert.equal(reconcile(33.6667, 33.6667, "33'-8\"", "ft", "ft"), "33'-8\"");
});
