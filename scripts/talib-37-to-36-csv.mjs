#!/usr/bin/env node
/**
 * Talib Nazami Alam Ploting — source CSV converter for the approved landscape plan.
 * Reads the LIVE current D1 inventory and archived original R2 CSV in CI.
 * Never manufactures dimensions or area. No direct public snapshot writes.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PROJECT = 'e94cec2c-e3f7-4a13-aa75-5ec4167baaf2';
const idAliases = new Set(['id','plot','plotno','plotnumber','lot','lotno','lotnumber']);
const areaAliases = new Set(['sqft','squarefeet','squarefoot','areaft','areasqft']);
const clean = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
const requireValid = (ok, why) => { if(!ok) throw new Error('TALIB_REMAP_STOP: '+why); };
const input = name => readFileSync(name,'utf8');

function d1Rows(file){
  const result = JSON.parse(input(file));
  requireValid(Array.isArray(result), 'Invalid D1 --json response');
  return result.flatMap(v=>Array.isArray(v?.results)?v.results:[]);
}

function parseCSV(raw){
  const records = []; let row=[],field='',quoted=false;
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(c==='"'){
      if(quoted&&raw[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
    }else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\r'||c==='\n')&&!quoted){
      if(c==='\r'&&raw[i+1]==='\n')i++;
      row.push(field); if(row.some(x=>x.trim()!==''))records.push(row);
      row=[];field='';
    }else field+=c;
  }
  requireValid(!quoted,'Unclosed CSV quote');
  if(field||row.length){row.push(field);if(row.some(x=>x.trim()!==''))records.push(row);}
  requireValid(records.length>1,'Empty original plotSheet CSV');
  return records;
}
const encodeCSV = rows => rows.map(row=>row.map(value=>{
  const s=String(value??'');
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}).join(',')).join('\r\n')+'\r\n';
const oldToNew=n=>n<=31?n:n===32?null:n-1;
const rotateCCW=v=>{
  const val=String(v).trim().toLowerCase();
  return {top:'left',right:'top',bottom:'right',left:'bottom'}[val]||v;
};
function assertIdSet(ids,count){
  requireValid(ids.length===count,'Expected exactly '+count+' plot rows');
  requireValid(new Set(ids).size===count,'Duplicate plot ID');
  requireValid(ids.every((v,i)=>v===i+1),'Expected plot IDs 1..'+count);
}
function inspect(path){
  const rows=d1Rows(path);
  const ids=rows.map(r=>Number(r.id)).sort((a,b)=>a-b);
  if(ids.length===36){
    assertIdSet(ids,36);
    console.log('TALIB_REMAP_NEEDED=false (already 36 rows)');
    if(process.env.GITHUB_ENV)writeFileSync(process.env.GITHUB_ENV,'TALIB_REMAP_NEEDED=false\n',{flag:'a'});
  }else{
    assertIdSet(ids,37);
    requireValid(rows.every(r=>Number(r.active)===1),'Expected all old plots active');
    requireValid(rows.filter(r=>Number(r.id)>=32).every(r=>String(r.status)==='available' && !String(r.polygon||'').trim()),'Plots 32-37 changed after audit');
    console.log('TALIB_REMAP_NEEDED=true (37-row draft confirmed)');
    if(process.env.GITHUB_ENV)writeFileSync(process.env.GITHUB_ENV,'TALIB_REMAP_NEEDED=true\n',{flag:'a'});
  }
}
function convert(sourcePath,r2Path,outPath,archivePath){
  const db = d1Rows(sourcePath);
  const ids = db.map(r=>Number(r.id)).sort((a,b)=>a-b);
  assertIdSet(ids,37);
  const raw=input(r2Path);
  const withBom=raw.charCodeAt(0)===0xFEFF;
  const records=parseCSV(raw.replace(/^\uFEFF/,''));
  const headers=records.shift();
  const idPos=headers.findIndex(h=>idAliases.has(clean(h)));
  const areaPos=headers.findIndex(h=>areaAliases.has(clean(h)));
  const directionPos=headers.findIndex(h=>clean(h)==='frontdirection');
  requireValid(idPos>=0&&areaPos>=0,'CSV needs Plot ID and Sqft columns');
  const sourceMap=new Map(db.map(r=>[Number(r.id),r]));
  const original=new Map();
  for(const row of records){
    requireValid(row.length===headers.length,'CSV column count mismatch');
    const id=Number(String(row[idPos]).trim());
    requireValid(Number.isInteger(id)&&id>=1&&id<=37&&!original.has(id),'Invalid/duplicate CSV ID');
    const area=Number(String(row[areaPos]).replaceAll(',','').trim());
    const expected=Number(sourceMap.get(id)?.sqft);
    requireValid(Number.isFinite(area)&&Number.isFinite(expected),'Missing authoritative area '+id);
    requireValid(Math.abs(area-expected)<=Math.max(0.1,expected*.005),'CSV/D1 sqft differs for plot '+id);
    original.set(id,row);
  }
  assertIdSet([...original.keys()].sort((a,b)=>a-b),37);
  const rows=[headers],archive=[headers];
  for(let oldId=1;oldId<=37;oldId++){
    const row=[...original.get(oldId)];
    if(oldId===32){archive.push(row);continue;}
    row[idPos]=String(oldToNew(oldId));
    if(directionPos>=0)row[directionPos]=rotateCCW(row[directionPos]);
    rows.push(row);
  }
  assertIdSet(rows.slice(1).map(r=>Number(r[idPos])),36);
  const bom=withBom?'\uFEFF':'';
  writeFileSync(outPath,bom+encodeCSV(rows));
  writeFileSync(archivePath,bom+encodeCSV(archive));
  console.log('Prepared exactly 36 verified Talib plot rows; former 32 archived independently.');
}
function verify(sourcePath,r2Path){
  const db=d1Rows(sourcePath);
  assertIdSet(db.map(r=>Number(r.id)).sort((a,b)=>a-b),36);
  const csv=parseCSV(input(r2Path).replace(/^\uFEFF/,''));
  requireValid(csv.length===37,'CSV must contain header and 36 rows');
  const idPos=csv[0].findIndex(h=>idAliases.has(clean(h)));
  requireValid(idPos>=0,'CSV plot ID column missing');
  assertIdSet(csv.slice(1).map(row=>Number(row[idPos])),36);
  const byId=new Map(db.map(r=>[Number(r.id),r]));
  requireValid(Math.abs(Number(byId.get(32)?.sqft)-2741.25)<.1,'New 32 should contain former 33 area');
  requireValid(Math.abs(Number(byId.get(36)?.sqft)-5730.53)<.1,'New 36 should contain former 37 area');
  console.log('Verified D1 and R2: 36 numbered plots, no old 37.');
}
const [op,...args]=process.argv.slice(2);
if(op==='inspect')inspect(...args);
else if(op==='convert')convert(...args);
else if(op==='verify')verify(...args);
else throw Error('Usage: talib-37-to-36-csv.mjs inspect db.json | convert db.json old.csv new.csv commercial.csv | verify db.json new.csv');
