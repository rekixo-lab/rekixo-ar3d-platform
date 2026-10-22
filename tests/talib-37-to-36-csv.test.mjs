import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script=fileURLToPath(new URL('../scripts/talib-37-to-36-csv.mjs',import.meta.url));
const area=n=>n===32?14548.76:n>=33&&n<=36?2741.25:n===37?5730.53:1000+n;
const old=Array.from({length:37},(_,i)=>({
  id:String(i+1),sqft:area(i+1),status:'available',polygon:'',active:1
}));
const exec=(...a)=>execFileSync(process.execPath,[script,...a],{encoding:'utf8'});

test('37->36 conversion preserves physical-plot area and isolates former commercial 32',()=>{
  const dir=mkdtempSync(join(tmpdir(),'talib-36-'));
  try{
    const db=join(dir,'old.json'),source=join(dir,'old.csv'),out=join(dir,'new.csv'),archive=join(dir,'commercial.csv');
    writeFileSync(db,JSON.stringify([{results:old}]));
    const csv='Plot No,Sqft,Dimensions,Front Direction,Notes\r\n'+old.map(r=>[r.id,r.sqft,'"43 x 63"', 'bottom','original physical plot '+r.id].join(',')).join('\r\n')+'\r\n';
    writeFileSync(source,csv);
    assert.match(exec('inspect',db),/TALIB_REMAP_NEEDED=true/);
    assert.match(exec('convert',db,source,out,archive),/36 verified/);
    const rows=readFileSync(out,'utf8').trim().split(/\r?\n/);
    assert.equal(rows.length,37);
    assert.deepEqual(rows.slice(1).map(x=>Number(x.split(',')[0])),Array.from({length:36},(_,i)=>i+1));
    assert.match(rows[32],/^32,2741.25,.*original physical plot 33$/);
    assert.match(rows[36],/^36,5730.53,.*original physical plot 37$/);
    assert.match(rows[1],/right,original physical plot 1$/);
    assert.match(readFileSync(archive,'utf8'),/32,14548.76,.*original physical plot 32/);
    assert.equal(readFileSync(source,'utf8'),csv);
    const next=old.filter(r=>r.id!=='32').map(r=>({...r,id:String(Number(r.id)>32?Number(r.id)-1:r.id)}));
    const after=join(dir,'after.json');
    writeFileSync(after,JSON.stringify([{results:next}]));
    assert.match(exec('inspect',after),/TALIB_REMAP_NEEDED=false/);
    assert.match(exec('verify',after,out),/Verified D1 and R2/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
