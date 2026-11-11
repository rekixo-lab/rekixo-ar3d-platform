// Read-only verification of the one-time production title correction.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const path=process.argv[2];
if(!path)throw Error("Usage: node verify-shree-dungar-title.mjs <wrangler-d1-json>");
const json=JSON.parse(readFileSync(path,"utf8"));
const batches=Array.isArray(json)?json:[json];
const rows=batches.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
assert.equal(rows.length,1,"Expected exactly one D1 project at the original share URL slug");
const row=rows[0];
const correct="SHREE DUNGAR RESIDENCY";
assert.equal(row.slug,"hree-dungar-residency-9176ee");
assert.equal(row.name,correct,"Super Admin project title is not corrected");
assert.equal(row.snapshotName,correct,"Published customer title is not corrected");
assert.equal(row.draftName,correct,"Client Admin projectName is not corrected");
assert.equal(row.publishedName,correct,"Published projectName is not corrected");
assert.equal(Number(row.publishVersion),Number(row.snapshotVersion),"Published snapshot version changed or became stale");
for(const key of ["draftShareTitle","publishedShareTitle","draftShareDescription","publishedShareDescription","draftBrandName","publishedBrandName"]){
  const value=row[key];
  if(value!==null&&value!==undefined)
    assert.doesNotMatch(String(value),/(^|[^a-z])hree dungar residency/i,`Old title remains in ${key}`);
}
console.log("Verified: SHREE DUNGAR RESIDENCY live + published titles; original slug and publish version preserved.");
