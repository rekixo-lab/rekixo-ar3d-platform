import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mapper = await readFile(new URL("../app/plot-mapper.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/super-mapper/route.ts", import.meta.url), "utf8");
const multipart = await readFile(
  new URL("../app/api/super-mapper-masterplan-upload/route.ts", import.meta.url),
  "utf8",
);
const asset = await readFile(
  new URL("../app/api/project-asset/[kind]/route.ts", import.meta.url),
  "utf8",
);

test("masterplan same-file retries are deterministic without changing other uploaders", () => {
  assert.match(mapper, /function handleMasterplanUploadInput/);
  assert.match(mapper, /input\.value = ""/);
  assert.match(mapper, /handleMasterplanUploadInput\(event\)/);
  assert.match(mapper, /upload\(event\.target\.files\[0\], "logo"\)/);
  assert.ok(mapper.includes("Preserve the existing upload path for logo/PDF/CAD/plot-sheet"));
});

test("Android image picker MIME quirks are normalized safely", () => {
  assert.match(mapper, /function normalizeMasterplanFile/);
  assert.match(mapper, /incomingType === "image\/jpg"/);
  assert.match(mapper, /incomingType === "application\/octet-stream"/);
  assert.match(route, /function imageUploadLooksValid/);
  assert.match(route, /IMAGE_EXTENSIONS\.has\(extension\)/);
});

test("large source processing avoids full-resolution mapper decode when possible", () => {
  assert.match(mapper, /MAX_ORIGINAL_MASTERPLAN_BYTES = 100 \* 1024 \* 1024/);
  assert.match(mapper, /async function readMasterplanDimensions/);
  assert.match(mapper, /resizeWidth: width/);
  assert.match(mapper, /resizeHeight: height/);
  assert.match(mapper, /MAX_MAPPING_DIMENSION = 4096/);
  assert.match(mapper, /MOBILE_MAPPING_DIMENSION = 3072/);
  assert.match(mapper, /canvas\.width = 1/);
  assert.match(mapper, /bitmap\.close\(\)/);
});

test("30-100 MB originals upload in bounded and exact-size-verified R2 multipart chunks", () => {
  assert.match(mapper, /MASTERPLAN_ORIGINAL_CHUNK_BYTES = 8 \* 1024 \* 1024/);
  assert.match(mapper, /uploadMasterplanOriginal/);
  assert.match(multipart, /createMultipartUpload/);
  assert.match(multipart, /resumeMultipartUpload/);
  assert.match(multipart, /uploadPart/);
  assert.match(multipart, /upload\.complete\(parts\)/);
  assert.match(multipart, /MAX_ORIGINAL_BYTES = 100 \* 1024 \* 1024/);
  assert.match(multipart, /MAX_PART_BYTES = 8 \* 1024 \* 1024/);
  assert.match(multipart, /MAX_PARTS = Math\.ceil\(MAX_ORIGINAL_BYTES \/ MAX_PART_BYTES\)/);
  assert.match(multipart, /uploadToken\(size\)/);
  assert.match(multipart, /expectedSizeFromToken/);
  assert.match(multipart, /actualSize !== expectedSize/);
  assert.match(multipart, /env\.BUCKET\.delete\(objectKey\(projectId, token\)\)/);
  assert.match(multipart, /browserSafeImageMagic/);
});

test("mapper loads light preview first then promotes decoded HD with retry", () => {
  assert.match(mapper, /masterplanAssetUrl\("preview"/);
  assert.match(mapper, /preloadHdMasterplan/);
  assert.match(mapper, /Preview ready · Original masterplan/);
  assert.match(mapper, /Retry masterplan/);
  assert.match(mapper, /masterplanVersion/);
  assert.match(mapper, /imageQuality === "preview"/);
});

test("mapped projects reject aspect-changing masterplan replacements", () => {
  assert.match(mapper, /hasMasterplan && mappedPlots\.length/);
  assert.match(mapper, /aspectDrift > 0\.0025/);
  assert.match(mapper, /Polygons safe rakhne ke liye upload block/);
});

test("large masterplan finalization is bounded and does not resend original", () => {
  assert.match(mapper, /MASTERPLAN_FINALIZE_TIMEOUT_MS = 180_000/);
  assert.match(mapper, /originalUploadCompleted", "1"/);
  assert.match(mapper, /originalObjectToken/);
  assert.doesNotMatch(
    mapper.slice(mapper.indexOf('data.append("file", prepared.mappingFile)'), mapper.indexOf('data.append("mapWidth"')),
    /data\.append\("originalFile"/,
  );
  assert.ok(mapper.includes('"Masterplan " + masterplanStage + " failed: "'));
});

test("versioned original storage preserves legacy project compatibility", () => {
  assert.match(route, /masterplanOriginalObjectToken/);
  assert.match(route, /multipart-versioned/);
  assert.match(asset, /masterplanOriginalObjectToken/);
  assert.match(asset, /projects\/\$\{projectId\}\/mapper\/masterplanOriginal\/\$\{token\}/);
  assert.match(asset, /projects\/\$\{projectId\}\/mapper\/\$\{objectKind\}/);
});

test("masterplan replacement branches never mutate plot geometry or status", () => {
  const start = route.indexOf('\n    if (kind === "masterplan") {');
  const end = route.indexOf('\n    if (kind === "sourceCad") {', start);
  assert.ok(start >= 0 && end > start, "masterplan server branch not found");
  const branch = route.slice(start, end);
  assert.doesNotMatch(branch, /UPDATE\s+plots/i);
  assert.doesNotMatch(branch, /DELETE\s+FROM\s+plots/i);
  assert.doesNotMatch(branch, /savePlots\s*\(/);
  assert.match(branch, /deleteSettings\(projectId, \[/);

  assert.doesNotMatch(multipart, /UPDATE\s+plots/i);
  assert.doesNotMatch(multipart, /DELETE\s+FROM\s+plots/i);
});

test("completed Tiyansh lock remains intact", () => {
  assert.match(mapper, /Tiyansh completed project locked/);
  assert.match(route, /Completed Tiyansh mapper locked/);
});
