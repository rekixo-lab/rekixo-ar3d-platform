import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  projectSlug,projectName,allPdfIds,soldPdfIds,expectedTotal,expectedSold,
  validatePdfReference
} from "./dungar-pdf-sold-source.mjs";

function readWrangler(path){
  const parsed=JSON.parse(readFileSync(path,"utf8"));
  const batches=Array.isArray(parsed)?parsed:[parsed];
  if(batches.some(x=>x.success===false))throw Error("D1 query failed");
  const rows=batches.flatMap(x=>Array.isArray(x.results)?x.results:[]);
  if(!rows.length)throw Error("Production plot read returned no rows");
  return rows;
}
function compareIds(rows){
  const {dbAll,dbSold}=validatePdfReference();
  const all=dbAll,sold=dbSold;
  const actual=new Set(rows.map(x=>String(x.plotId)));
  const missing=[...all].filter(x=>!actual.has(x));
  const extra=[...actual].filter(x=>!all.has(x));
  if(missing.length||extra.length){
    console.error("PDF vs active production plot IDs mismatch",JSON.stringify({expected:expectedTotal,actual:rows.length,missing,extra}));
    throw Error("Stop: PDF rows cannot be mapped 1:1 to production plot IDs");
  }
  assert.equal(rows.length,expectedTotal,"Project plot count does not equal PDF's 257 rows");
  assert.equal(actual.size,expectedTotal,"Duplicated plot IDs");
  assert.equal([...actual].filter(x=>sold.has(x)).length,expectedSold);
  for(const x of rows){
    assert.equal(x.slug,projectSlug,"Incorrect project slug");
    assert.equal(x.projectName,projectName,"Incorrect project name");
    assert.equal(x.publicStatus,"published","Project no longer published");
    assert.equal(Number(x.publishVersion),Number(x.snapshotVersion),"Published project snapshot stale");
    assert.equal(Number(x.inventoryActive),1,"Inactive plot returned");
    assert.ok(["available","booked","sold"].includes(x.status),"Unrecognized canonical status");
    if(sold.has(x.plotId)&&x.status==="booked")
      throw Error("Stop: PDF SOLD plot currently Booked: "+x.plotId);
  }
  return sold;
}
function preflight(path){
  const rows=readWrangler(path),sold=compareIds(rows);
  const counts={available:0,booked:0,sold:0},changes=[];
  for(const row of rows){
    counts[row.status]++;
    if(sold.has(row.plotId)&&row.status!=="sold")changes.push(row.plotId);
  }
  console.log("Read-only PDF/production preflight PASSED",JSON.stringify({
    slug:projectSlug,PDFRows:expectedTotal,PDFSold:expectedSold,
    currently:counts,willChangeToSold:changes.length,unchanged:expectedTotal-changes.length,
    combinedIds:["B-19,B-20","B-23,B-24"]
  }));
}
function verify(beforeFile,afterFile){
  const before=readWrangler(beforeFile),after=readWrangler(afterFile);
  const sold=compareIds(before);
  compareIds(after);
  const previous=new Map(before.map(row=>[row.plotId,row]));
  let changed=0;
  for(const next of after){
    const old=previous.get(next.plotId);
    if(!old)throw Error("Unexpected plot after mutation");
    for(const key of Object.keys(old).filter(k=>k!=="status"&&k!=="updatedAt")){
      if(JSON.stringify(next[key])!==JSON.stringify(old[key]))
        throw Error("Non-status field unexpectedly changed: "+next.plotId+"."+key);
    }
    if(sold.has(next.plotId)){
      assert.equal(next.status,"sold","PDF SOLD plot not updated: "+next.plotId);
      if(old.status!=="sold")changed++;
    }else{
      assert.equal(next.status,old.status,"Non-PDF-SOLD status was changed: "+next.plotId);
      assert.equal(next.updatedAt,old.updatedAt,"Non-PDF-SOLD timestamp was changed: "+next.plotId);
    }
  }
  console.log("Verified exactly "+expectedSold+" PDF SOLD plots; "+
    changed+" newly sold; "+(expectedTotal-expectedSold)+" PDF-unmarked plot statuses preserved.");
}
const [mode,...args]=process.argv.slice(2);
if(mode==="preflight"&&args.length===1)preflight(args[0]);
else if(mode==="verify"&&args.length===2)verify(args[0],args[1]);
else throw Error("Usage: node scripts/verify-dungar-pdf-sold.mjs preflight before.json | verify before.json after.json");
