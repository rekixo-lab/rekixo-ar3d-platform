import{spawnSync}from"node:child_process";
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID){console.error("Cloudflare D1 credentials unavailable. No queries run.");process.exit(2)}
function q(label,sql){const r=spawnSync("./node_modules/.bin/wrangler",["d1","execute","tiyansh-production","--remote","--json","--command",sql],{encoding:"utf8",maxBuffer:20000000,timeout:45000,env:process.env});if(r.status!==0){console.error(label+" SELECT failure "+r.stderr.slice(0,800));process.exit(1)}let data;try{data=JSON.parse(r.stdout.trim())}catch{console.error(label+" invalid D1 JSON "+r.stdout.slice(0,250));process.exit(1)}const arr=Array.isArray(data)?data:[data];if(arr.some(x=>x?.success===false)){console.error(label+" SQL error");process.exit(1)}const rows=arr.flatMap(x=>Array.isArray(x?.results)?x.results:[]);console.log("AUDIT_QUERY "+label+" "+rows.length);return rows}
const project=q("project","SELECT id,name,slug,public_status,publish_version FROM projects WHERE slug='future-invest-realty-ec6b45' AND status='active' LIMIT 1");if(project.length!==1){console.error("Project identity mismatch");process.exit(3)}
const pid=String(project[0].id),P="'"+pid.replace(/'/g,"''")+"'";
const fields="id,sqft,sqm,sqyd,front,back,depth,depth2,dimension_unit AS unit,dimensions,road,front_edge_index AS fi,back_edge_index AS bi,depth_edge_index AS di,depth2_edge_index AS d2i,front_label AS fl,back_label AS bl,depth_label AS dl,depth2_label AS d2l,side_dimensions AS sides,edge_semantics AS semantics,polygon";
const draft=q("draft","SELECT "+fields+" FROM plots WHERE project_id="+P+" AND inventory_active=1 ORDER BY CAST(id AS INTEGER)");
const pub=q("published","SELECT "+fields+" FROM published_plots WHERE project_id="+P+" ORDER BY CAST(id AS INTEGER)");
const de=q("draft_edges","SELECT plot_id AS id,role,segment_index AS si,edge_index AS ei,point_count AS pc,length,unit,road_frontage AS frontage FROM plot_edge_measurements WHERE project_id="+P);
const pe=q("published_edges","SELECT plot_id AS id,role,segment_index AS si,edge_index AS ei,point_count AS pc,length,unit,road_frontage AS frontage FROM published_plot_edge_measurements WHERE project_id="+P);
const scale=q("published_scale","SELECT key,value FROM published_settings WHERE project_id="+P+" AND key IN ('mapWidth','mapHeight','sqmToSqftFactor','publicRotation','masterplanNorthAngle')");
const snapshot=q("snapshot","SELECT publish_version FROM project_public_snapshots WHERE project_id="+P);
console.log("AUDIT_PROJECT "+JSON.stringify({id:pid,name:project[0].name,publishVersion:project[0].publish_version,snapshotVersion:snapshot[0]?.publish_version,counts:{draft:draft.length,published:pub.length,de:de.length,pe:pe.length},scale}));
function clean(x){let polygon=[],roles={};try{polygon=JSON.parse(x.polygon)}catch{}try{roles=JSON.parse(x.semantics)?.roles||{}}catch{}return{id:x.id,area:[x.sqm,x.sqft,x.sqyd],size:[x.front,x.back,x.depth,x.depth2],unit:x.unit,idx:[x.fi,x.bi,x.di,x.d2i],verts:Array.isArray(polygon)?polygon.length:0,roles,polygon,labels:[x.fl,x.bl,x.dl,x.d2l],road:x.road}}
const d=new Map(draft.map(x=>[String(x.id),clean(x)])),p=new Map(pub.map(x=>[String(x.id),clean(x)]));
const all=[...new Set([...d.keys(),...p.keys()])],drift=all.filter(id=>JSON.stringify(d.get(id))!==JSON.stringify(p.get(id)));
console.log("AUDIT_SUMMARY "+JSON.stringify({draft:d.size,published:p.size,driftCount:drift.length,drift,missingPublished:[...d.keys()].filter(id=>!p.has(id)),missingDraft:[...p.keys()].filter(id=>!d.has(id)),missingSemantics:[...p.values()].filter(x=>!Object.keys(x.roles||{}).length).map(x=>x.id),missingArea:[...p.values()].filter(x=>!(Number(x.area[0])>0)).map(x=>x.id),missingSide:[...p.values()].filter(x=>x.size.some(v=>v===null||v===undefined||v==="")).map(x=>x.id)}));
const risk=[1,2,3,5,8,14,16,23,28,34,50,55,56,60,85,93,123,127,149,152,185,194,196,198,203,205,206,214,220,221,236,240,241,242,244];
for(const id of risk){const x={id,published:p.get(String(id))||null,draft:d.get(String(id))||null,edges:pe.filter(e=>String(e.id)===String(id))};if(x.published||x.draft)console.log("AUDIT_RISK "+JSON.stringify(x))}
for(const x of [...p.values()].sort((a,b)=>Number(a.id)-Number(b.id)))console.log("AUDIT_PLOT "+JSON.stringify({id:x.id,area:x.area[0],size:x.size,unit:x.unit,verts:x.verts,idx:x.idx,roles:x.roles}));
console.log("READ_ONLY_COMPLETE");

function median(values){const a=[...values].filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(!a.length)return 0;const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2}
function pixels(x){const pts=x.polygon;if(!Array.isArray(pts)||pts.length<3)return null;const W=4096,H=2304;let ar=0;const len=[];for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];const ax=a[0]*W,ay=a[1]*H,bx=b[0]*W,by=b[1]*H;len.push(Math.hypot(bx-ax,by-ay));ar+=ax*by-bx*ay}return {len,area:Math.abs(ar)/2}}
const samples=[];
for(const plot of p.values()){const pix=pixels(plot);if(!pix||plot.verts!==4||plot.unit!=="m")continue;for(let k=0;k<4;k++){const idx=plot.idx[k],v=Number(plot.size[k]);if(Number.isInteger(idx)&&idx>=0&&idx<pix.len.length&&v>0&&pix.len[idx]>0){const rate=v/pix.len[idx];if(rate>0.02&&rate<0.4)samples.push(rate)}}}
const med=median(samples),filtered=samples.filter(x=>x>=med*.65&&x<=med*1.35),meterPerPixel=median(filtered);
console.log("AUDIT_GEOMETRY_SCALE "+JSON.stringify({sampleCount:samples.length,inliers:filtered.length,metersPerPixel:meterPerPixel,medianInitial:med}));
const flags=[];
for(const plot of p.values()){
 const pix=pixels(plot);if(!pix)continue;
 const sizes=plot.size.map(Number),meas=plot.idx.map(idx=>Number.isInteger(idx)&&idx>=0&&idx<pix.len.length?pix.len[idx]*meterPerPixel:null);
 const mismatch=sizes.map((n,j)=>n>0&&meas[j]>0?Math.round((n/meas[j]-1)*1000)/10:null);
 const geomArea=pix.area*meterPerPixel*meterPerPixel,areap=Number(plot.area[0]),areaGap=areap>0?Math.round((areap/geomArea-1)*1000)/10:null;
 const hit=mismatch.some(x=>x!==null&&Math.abs(x)>25)||(areaGap!==null&&Math.abs(areaGap)>25);
 const data={id:plot.id,unit:plot.unit,verts:plot.verts,side:plot.size,calculatedSides:meas.map(x=>x===null?null:Number(x.toFixed(2))),sideDifferencePercent:mismatch,area:areap,geometryEstimatedArea:Number(geomArea.toFixed(2)),areaDifferencePercent:areaGap};
 if(hit){flags.push(data);console.log("AUDIT_LENGTH_FLAG "+JSON.stringify(data))}
}
console.log("AUDIT_LENGTH_SUMMARY "+JSON.stringify({checked:p.size,flagged:flags.length,flaggedIds:flags.map(x=>x.id)}));


const mirrored={
  "18.3/9.1":[12,17,19,32,37,39,43,65,67,68,70,83,101,114,116,131,133,161,163,177,192],
  "18.1/7.6":[153],"24.4/10.7":[199],"13.7/6.1":[215,226]
};
const planned=[];
for(const [pair,ids] of Object.entries(mirrored)){const [long,short]=pair.split("/").map(Number);for(const id of ids)planned.push({id,old:[long,long,short,short],next:[short,short,long,long],mapping:[2,3,0,1]})}
for(const [id,f,b,d1,d2] of [[28,5.2,5.8,8.4,13.7],[146,9,10.8,8.2,14.2],[147,7.6,9.1,14.2,19.2],[148,7.6,9.1,19.2,24.3],[208,6.1,7.2,13.1,16.9]])planned.push({id,old:[f,b,d1,d2],next:[f,b,d2,d1],mapping:[0,1,3,2]});
planned.push({id:210,old:[16.5,22.1,9.1,10.7],next:[9.1,10.7,16.5,22.1],mapping:[2,3,0,1]});
function mismatchMetric(x,values){const pix=pixels(x),tot=[];if(!pix)return 1000;for(let k=0;k<4;k++){const idx=x.idx[k],val=values[k],expected=pix.len[idx]*meterPerPixel;if(!Number.isInteger(idx)||!(expected>0))return 1000;tot.push(Math.abs(val/expected-1))}return tot.reduce((a,b)=>a+b,0)/4}
let ready=0;
for(const item of planned){const x=p.get(String(item.id)),y=d.get(String(item.id));const exact=!!x&&!!y&&x.unit==="m"&&y.unit==="m"&&x.size.every((v,j)=>Number(v)===item.old[j])&&y.size.every((v,j)=>Number(v)===item.old[j])&&JSON.stringify(x.idx)===JSON.stringify(y.idx)&&JSON.stringify(x.polygon)===JSON.stringify(y.polygon);
const before=x?mismatchMetric(x,item.old):999,after=x?mismatchMetric(x,item.next):999;
const ok=exact&&before>0.10&&after<0.2&&after<before*.4;
if(ok)ready++;
console.log("AUDIT_REPAIR_DRYRUN "+JSON.stringify({id:item.id,exact,old:item.old,next:item.next,beforePercent:Number((before*100).toFixed(1)),afterPercent:Number((after*100).toFixed(1)),safe:ok}));
}
console.log("AUDIT_REPAIR_DRYRUN_SUMMARY "+JSON.stringify({planned:planned.length,ready,allReady:ready===planned.length}));

export {q,project,pid,draft,pub,d,p,planned,meterPerPixel,pixels,mismatchMetric};


/* Production data-only correction, gated OFF by default.
   Invariants: exact project/version, 243 rows, verified R2 backup, unchanged area,
   polygons, vertex order, edge-role indices, status and all other projects. */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash,randomBytes} from "node:crypto";
const mode=process.env.EXECUTE_SAFE_REPAIR==="yes";
function quote(v){return v===null||v===undefined?"NULL":typeof v==="number"&&Number.isFinite(v)?String(v):"'"+String(v).replaceAll("'","''")+"'";}
function wr(args){const r=spawnSync("./node_modules/.bin/wrangler",args,{encoding:"utf8",maxBuffer:30_000_000,timeout:60000,env:process.env});if(r.status!==0)throw Error("wrangler failed "+args.slice(0,4).join(" ")+": "+r.stderr.slice(0,600));return r.stdout.trim();}
function sourceRow(a,id){return a.find(x=>String(x.id)===String(id));}
function matches(x,vals){return x?.size.every((v,i)=>Number(v)===vals[i]);}
function immutable(x,y){return x&&y&&x.unit===y.unit&&JSON.stringify(x.idx)===JSON.stringify(y.idx)&&JSON.stringify(x.polygon)===JSON.stringify(y.polygon);}
function repairPreflight(){
 if(project.length!==1||project[0].slug!=="future-invest-realty-ec6b45"||Number(project[0].publish_version)!==2||draft.length!==243||pub.length!==243||planned.length!==31)throw Error("STOP project scope/version/count mismatch");
 const allDone=planned.every(it=>matches(d.get(String(it.id)),it.next)&&matches(p.get(String(it.id)),it.next));
 if(allDone)return "already_applied";
 for(const it of planned){
  const x=d.get(String(it.id)),y=p.get(String(it.id));
  if(!immutable(x,y)||x.unit!=="m"||!matches(x,it.old)||!matches(y,it.old))throw Error("STOP changed record #"+it.id);
  const before=mismatchMetric(y,it.old),after=mismatchMetric(y,it.next);
  if(!(before>0.1&&after<0.2&&after<before*.4))throw Error("STOP area/edge validation #"+it.id);
  const a=sourceRow(draft,it.id),b=sourceRow(pub,it.id);
  if(JSON.stringify([a.fl,a.bl,a.dl,a.d2l])!==JSON.stringify([b.fl,b.bl,b.dl,b.d2l]))throw Error("STOP labels changed #"+it.id);
 }
 return "ready";
}
const readiness=repairPreflight();
console.log("REPAIR_GATE "+JSON.stringify({status:readiness,execute:mode,candidateRows:planned.length,projectId:pid}));
if(!mode||readiness==="already_applied"){
 console.log("REPAIR_NO_WRITE "+(mode?"already applied":"dry run only"));
}else{
 const backup={schema:"future-invest-measurements-before-v1",project:project[0],timestamp:new Date().toISOString(),candidateIds:planned.map(x=>x.id),draft,published:pub};
 const local="/tmp/future-invest-measurements-original.json",verify="/tmp/future-invest-measurements-readback.json",body=JSON.stringify(backup);
 writeFileSync(local,body,{mode:0o600});
 const key="projects/"+pid+"/backups/measurements-before-20261102-"+new Date().toISOString().replace(/[-:.TZ]/g,"")+"-"+randomBytes(5).toString("hex")+".json";
 const blob="tiyansh-gallery-production/"+key;
 wr(["r2","object","put",blob,"--remote","--file",local,"--content-type","application/json"]);
 wr(["r2","object","get",blob,"--remote","--file",verify]);
 const sha=x=>createHash("sha256").update(x).digest("hex");
 if(sha(readFileSync(verify))!==sha(Buffer.from(body)))throw Error("STOP backup readback failed, no D1 writes");
 console.log("REPAIR_BACKUP_VERIFIED key="+key+" sha256="+sha(Buffer.from(body)));
 const fields=["front","back","depth","depth2","front_label","back_label","depth_label","depth2_label"];
 function nextValue(it,index){
  if(index<4)return it.next[index];
  const a=sourceRow(pub,it.id);return [a.fl,a.bl,a.dl,a.d2l][it.mapping[index-4]];
 }
 function sqlFor(table){
  const sets=fields.map((field,index)=>field+"=CASE id "+planned.map(it=>"WHEN "+quote(String(it.id))+" THEN "+quote(nextValue(it,index))).join(" ")+" ELSE "+field+" END").join(", ");
  const conditions=planned.map(it=>{
   const a=sourceRow(pub,it.id),v=it.old;
   return "(id="+quote(String(it.id))+" AND front IS "+quote(v[0])+" AND back IS "+quote(v[1])+" AND depth IS "+quote(v[2])+" AND depth2 IS "+quote(v[3])+" AND polygon IS "+quote(a.polygon)+" AND edge_semantics IS "+quote(a.semantics)+" AND front_edge_index IS "+quote(a.fi)+" AND back_edge_index IS "+quote(a.bi)+" AND depth_edge_index IS "+quote(a.di)+" AND depth2_edge_index IS "+quote(a.d2i)+")";
  }).join(" OR ");
  return "UPDATE "+table+" SET "+sets+" WHERE project_id="+quote(pid)+" AND ("+conditions+") AND EXISTS (SELECT 1 FROM projects WHERE id="+quote(pid)+" AND slug='future-invest-realty-ec6b45' AND publish_version=2 AND public_status='published')";
 }
 function update(table){
  const result=JSON.parse(wr(["d1","execute","tiyansh-production","--remote","--json","--command",sqlFor(table)]));
  const blocks=Array.isArray(result)?result:[result];
  if(blocks.some(x=>x?.success===false))throw Error("STOP "+table+" D1 rejected update");
  const count=blocks.reduce((n,x)=>n+Number(x?.meta?.changes||0),0);
  console.log("REPAIR_UPDATE "+table+" count="+count);
  if(count!==planned.length)throw Error("STOP partial update "+table+" rows="+count);
 }
 function verifyTable(table){
  const all=q("verify_"+table,"SELECT id,sqft,sqm,sqyd,front,back,depth,depth2,front_label AS fl,back_label AS bl,depth_label AS dl,depth2_label AS d2l,front_edge_index AS fi,back_edge_index AS bi,depth_edge_index AS di,depth2_edge_index AS d2i,polygon,edge_semantics AS semantics FROM "+table+" WHERE project_id="+quote(pid));
  if(all.length!==243)throw Error("STOP changed row count "+table);
  const old=table==="plots"?draft:pub;
  for(const it of planned){
   const a=sourceRow(all,it.id),b=sourceRow(old,it.id);
   if(!a||!it.next.every((v,i)=>Number(a[["front","back","depth","depth2"][i]])===v))throw Error("STOP measurement verification "+table+" #"+it.id);
   for(const field of ["sqft","sqm","sqyd","fi","bi","di","d2i","polygon","semantics"])if(a[field]!==b[field])throw Error("STOP immutable changed "+table+" #"+it.id+" "+field);
   const before=[b.fl,b.bl,b.dl,b.d2l],after=[a.fl,a.bl,a.dl,a.d2l];
   if(!after.every((v,j)=>v===before[it.mapping[j]]))throw Error("STOP label assignment "+table+" #"+it.id);
  }
  console.log("REPAIR_VERIFIED "+table+" count="+planned.length+" polygons_unchanged=true areas_unchanged=true");
 }
 update("plots");verifyTable("plots");
 update("published_plots");verifyTable("published_plots");
 const post=q("version_post","SELECT publish_version FROM projects WHERE id="+quote(pid));
 if(Number(post[0]?.publish_version)!==2)throw Error("STOP published version changed");
 console.log("REPAIR_COMPLETE "+JSON.stringify({id:pid,plots:planned.length,polygonsChanged:0,areaChanged:0,backupKey:key}));
}

const revisionSettings=q('published_data_revision',"SELECT key,value FROM published_settings WHERE project_id='"+pid+"' AND key='publicDataRevision' LIMIT 1");
const snapVerify=q('snapshot_cache_check',"SELECT publish_version FROM project_public_snapshots WHERE project_id='"+pid+"' LIMIT 1");
console.log('AUDIT_CACHE_REVISION '+JSON.stringify({projectId:pid,projectVersion:project[0].publish_version,snapshotVersion:snapVerify[0]?.publish_version,revision:revisionSettings[0]?.value??null,publishedRevisionRows:revisionSettings.length}));
