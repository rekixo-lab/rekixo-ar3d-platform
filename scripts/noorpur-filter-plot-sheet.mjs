#!/usr/bin/env node
// Retire only Noorpur C6/C7 from the existing (optional) canonical R2 source.
// Leaves all area, dimension, ordering and other columns unchanged.
import {readFileSync, writeFileSync} from 'node:fs';
function stop(message){ throw new Error('NOORPUR_C67_CSV_STOP: '+message); }
const [source,out] = process.argv.slice(2);
if(!source||!out)stop('Usage: node noorpur-filter-plot-sheet.mjs input.csv output.csv');
const raw=readFileSync(source,'utf8');
const bom=raw.charCodeAt(0)===0xfeff?'\uFEFF':'';
const text=raw.replace(/^\uFEFF/,'');
const canon=h=>String(h).toLowerCase().replace(/[^a-z0-9]/g,'');
const idFields=new Set(['id','plot','plotno','plotnumber','lot','lotno','lotnumber']);
const banned=new Set(['C6','C7']);
let removed=[];
let result='';
if(/^\s*[\[{]/.test(text)){
  const obj=JSON.parse(text);
  const rows=Array.isArray(obj)?obj:Array.isArray(obj?.plots)?obj.plots:Array.isArray(obj?.rows)?obj.rows:null;
  if(!rows)stop('Unsupported JSON source shape');
  let filtered=[];
  for(const row of rows){
    const id=Object.entries(row).find(([key])=>idFields.has(canon(key)))?.[1];
    if(id==null)stop('Missing plot ID in JSON row');
    const norm=String(id).trim().toUpperCase();
    if(banned.has(norm)){removed.push(norm);continue;}
    filtered.push(row);
  }
  const value=Array.isArray(obj)?filtered:{...obj,...(Array.isArray(obj.plots)?{plots:filtered}:{rows:filtered})};
  result=JSON.stringify(value,null,2)+'\n';
}else{
  const records=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
    }else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field);
      if(row.some(v=>v.trim()!==''))records.push(row);
      row=[];field='';
    }else field+=c;
  }
  if(quoted)stop('CSV quote unclosed');
  if(field||row.length){row.push(field);if(row.some(v=>v.trim()!==''))records.push(row);}
  const header=records.shift();
  if(!header)stop('Empty CSV');
  const col=header.findIndex(x=>idFields.has(canon(x)));
  if(col<0)stop('No ID column found');
  const remaining=[];
  for(const row of records){
    if(row.length!==header.length)stop('CSV field mismatch');
    const id=String(row[col]).trim().toUpperCase();
    if(banned.has(id)){removed.push(id);continue;}
    remaining.push(row);
  }
  const encode=arr=>arr.map(cell=>{
    const v=String(cell??'');
    return /[",\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;
  }).join(',');
  result=[header,...remaining].map(encode).join('\r\n')+'\r\n';
}
if(removed.length && (removed.length!==2||new Set(removed).size!==2))
  stop('Source contains only one of C6/C7 or duplicate rows');
writeFileSync(out,bom+(removed.length?result:text));
const changed=removed.length===2;
console.log('NOORPUR_C67_SOURCE_CSV: '+(changed?'Removed C6/C7 and preserved other rows':'Source already has no C6/C7; original preserved'));
if(process.env.GITHUB_ENV)writeFileSync(process.env.GITHUB_ENV,'NOORPUR_SOURCE_HAS_C67='+String(changed)+'\n',{flag:'a'});
