// Read-only Cloudflare D1 verification for the customer-site title cache revision.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const path=process.argv[2];
if(!path)throw Error("Usage: node verify-shree-dungar-cache-revision.mjs <d1-json>");
const doc=JSON.parse(readFileSync(path,"utf8"));
const batches=Array.isArray(doc)?doc:[doc];
assert.ok(batches.every(x=>x.success!==false),"D1 query failed");
const rows=batches.flatMap(x=>Array.isArray(x.results)?x.results:[]);
assert.equal(rows.length,1,"Only one SHREE Dungar project row should match");
const row=rows[0],name="SHREE DUNGAR RESIDENCY";
assert.equal(row.slug,"hree-dungar-residency-9176ee");
assert.equal(row.name,name);
assert.equal(row.snapshotName,name);
assert.equal(row.publishedName,name);
assert.equal(row.publishedShareTitle?.trim()?.startsWith(name),true,"Published share title should be corrected");
assert.equal(Number(row.version),Number(row.snapshotVersion),"Publish version mismatch");
assert.equal(row.dataRevision,"shree-dungar-title-corrected-20261111-v2");
console.log("SHREE Dungar production title + cache revision verified; publish version unchanged:",row.version);
