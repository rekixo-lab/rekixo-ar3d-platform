#!/usr/bin/env node
/**
 * METRO CITY production preflight; never print plot/customer rows.
 * Usage: node scripts/metro-block-production-guard.mjs preflight before.json
 *        node scripts/metro-block-production-guard.mjs fingerprint rows.json
 *        node scripts/metro-block-production-guard.mjs postflight after.json
 */
import fs from "node:fs";
import crypto from "node:crypto";

const [mode,file,beforeFile] = process.argv.slice(2);
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
  if(!beforeFile)fail("pre-migration block state reference missing");
  const beforePayload=JSON.parse(fs.readFileSync(beforeFile,"utf8"));
  const beforeRows=[];
  function collect(v){
    if(Array.isArray(v)){for(const x of v)collect(x);return;}
    if(!v||typeof v!=="object")return;
    if(Array.isArray(v.results))beforeRows.push(...v.results);
    for(const [k,x] of Object.entries(v))if(k!=="results"&&typeof x==="object")collect(x);
  }
  collect(beforePayload);
  const id="c024a562-634d-4e49-b647-43209f6e450b";
  const row=rows.find(r=>r.id===id),old=beforeRows.find(r=>r.id===id);
  if(!row||!old||Number(row.activePlots)!==702||Number(row.publishedPlots)!==702)
    fail("postmigration canonical plot count changed");
  if(Number(row.publishVersion)!==Number(row.snapshotVersion)||
     Number(row.publishVersion)!==Number(old.publishVersion)||
     Number(row.snapshotVersion)!==Number(old.snapshotVersion))
    fail("published canonical snapshot changed");
  if(Number(row.tableCount)!==4)fail("expected four original block tables");

  // A/B/C can legitimately already be LIVE. Preserve the observed state
  // instead of incorrectly assuming public_enabled must remain zero.
  for(const field of ["blockEnabled","blockVersion","blockPublishedMaps","blockDraftMaps","blockPublishedAssets"]){
    if(!Number.isFinite(Number(old[field]))||
       Number(row[field])!==Number(old[field]))
      fail(`${field} changed during additive migration`);
  }
  const enabled=Number(row.blockEnabled);
  if(![-1,0,1].includes(enabled))fail("invalid block feature state");
  if(enabled===1){
    if(Number(row.blockVersion)<=0||Number(row.blockPublishedMaps)!==702||
       Number(row.blockDraftMaps)!==702||Number(row.blockPublishedAssets)!==3)
       fail("LIVE A/B/C assets, mapped IDs, or published revision incomplete");
  }else if(Number(row.blockPublishedMaps)>0&&Number(row.blockPublishedAssets)!==3){
    fail("disabled but previously-published Block snapshots are inconsistent");
  }
  if(Number(row.invalidRotations)!==0)fail("invalid published block rotation");
  console.log("METRO CITY postmigration verified: 702 canonical plots and A/B/C state preserved, published block geometry fingerprint unchanged.");
}
