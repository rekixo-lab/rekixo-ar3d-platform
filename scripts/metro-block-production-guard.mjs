#!/usr/bin/env node
/**
 * METRO CITY production preflight; never print plot/customer rows.
 * Usage: node scripts/metro-block-production-guard.mjs preflight before.json
 *        node scripts/metro-block-production-guard.mjs fingerprint rows.json
 *        node scripts/metro-block-production-guard.mjs postflight after.json
 */
import fs from "node:fs";
import crypto from "node:crypto";

const [mode,file] = process.argv.slice(2);
if (!["preflight","fingerprint","postflight"].includes(mode)||!file) {
  console.error("Usage: metro-block-production-guard.mjs preflight|fingerprint|postflight <file>");
  process.exit(2);
}
const value=JSON.parse(fs.readFileSync(file,"utf8"));
const rows=[];
function visit(v){
  if(Array.isArray(v)){for(const x of v)visit(x);return;}
  if(!v||typeof v!=="object")return;
  if(Array.isArray(v.results))rows.push(...v.results);
  for(const [k,x] of Object.entries(v))if(k!=="results" && typeof x==="object")visit(x);
}
visit(value);
function fail(message){console.error("STOP: METRO CITY "+message);process.exit(1)}
if(mode==="fingerprint"){
  if(!rows.length)fail("fingerprint returned no rows");
  const sorted=rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  process.stdout.write(crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex")+"\n");
  process.exit(0);
}
if(mode==="preflight"){
  const row=rows.find(r=>r.id==="c024a562-634d-4e49-b647-43209f6e450b");
  if(!row)fail("project ID not present on live D1");
  if(row.slug!=="metro-city-c024a5"||row.name!=="Metro City"||row.status!=="active"||row.publicStatus!=="published")fail("tenant identity or published state changed");
  if(Number(row.publishVersion)!==Number(row.snapshotVersion))fail("snapshot version stale/missing");
  const active=Number(row.activePlots),pub=Number(row.publishedPlots),available=Number(row.available),booked=Number(row.booked),sold=Number(row.sold);
  if(active!==702)fail("active inventory count is not the expected 702; check manually before proceeding");
  if(pub!==702)fail("published plot count is not 702; stop to investigate");
  if(![available,booked,sold].every(Number.isFinite)||available+booked+sold!==active)fail("canonical statuses do not reconcile");
  console.log("METRO CITY protected preflight passed: 702 active and 702 published plots; counts reconcile; published snapshot current.");
  process.exit(0);
}
if(mode==="postflight"){
  const row=rows.find(r=>r.id==="c024a562-634d-4e49-b647-43209f6e450b");
  if(!row||Number(row.activePlots)!==702||Number(row.publishedPlots)!==702)fail("postmigration plot count changed");
  // No state row is the expected pre-initialization condition (-1 from COALESCE).
  // A row with explicit 0 is also safe. Reject any enabled value or published mapping.
  if(![-1,0].includes(Number(row.blockEnabled))||Number(row.blockPublishedMaps)!==0)fail("block feature unexpectedly active");
  if(Number(row.tableCount)!==4)fail("expected four new block tables");
  if(Number(row.publishVersion)!==Number(row.snapshotVersion))fail("published snapshot changed");
  console.log("METRO CITY postmigration verified: block feature disabled, canonical and public inventory untouched.");
}
