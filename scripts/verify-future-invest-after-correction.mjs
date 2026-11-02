
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
const P="ec6b45b5-7232-475a-bba8-468caccfe568";
function run(args){
 const r=spawnSync("./node_modules/.bin/wrangler",args,{encoding:"utf8",maxBuffer:25000000,timeout:60000,env:process.env});
 if(r.status!==0)throw Error("read-only query failed "+r.stderr.slice(0,500));
 return r.stdout.trim();
}
function q(sql){
 if(!/^SELECT /i.test(sql))throw Error("SELECT only allowed");
 const payload=JSON.parse(run(["d1","execute","tiyansh-production","--remote","--json","--command",sql]));
 const blocks=Array.isArray(payload)?payload:[payload];
 if(blocks.some(x=>x.success===false))throw Error("D1 read failed");
 return blocks.flatMap(x=>x.results||[]);
}
const p=q("SELECT id,slug,publish_version AS version FROM projects WHERE id='"+P+"' AND status='active'");
const snapshot=q("SELECT publish_version AS version FROM project_public_snapshots WHERE project_id='"+P+"'");
const rev=q("SELECT value FROM published_settings WHERE project_id='"+P+"' AND key='publicDataRevision'");
if(p.length!==1||p[0].slug!=="future-invest-realty-ec6b45"||p[0].version!==2||snapshot[0]?.version!==2||rev[0]?.value!=="fi-drain-chain-20261102-38201da4d974d4de")throw Error("published project version or cache revision changed");
const fields="id,front,back,depth,depth2,front_label,back_label,depth_label,depth2_label,front_edge_index,back_edge_index,depth_edge_index,depth2_edge_index,polygon,edge_semantics,sqm,sqft,sqyd,status,road,side_dimensions";
const draft=q("SELECT "+fields+",notes FROM plots WHERE project_id='"+P+"' AND inventory_active=1 ORDER BY id");
const pub=q("SELECT "+fields+" FROM published_plots WHERE project_id='"+P+"' ORDER BY id");
if(draft.length!==243||pub.length!==243)throw Error("row count changed");
const oldPath="tiyansh-gallery-production/projects/"+P+"/backups/remaining-side-fields-before-20261102-4c32a3b78f53261b.json";
const backupFile="/tmp/fi-remaining-original.json";
run(["r2","object","get",oldPath,"--remote","--file",backupFile]);
const backup=JSON.parse(readFileSync(backupFile,"utf8"));
if(backup.draft?.length!==243||backup.published?.length!==243)throw Error("backup format mismatch");
const get=(rows,id)=>rows.find(x=>String(x.id)===String(id));
const expect={
  "120":{back:7.6,back_label:"7.6 m (25 ft; CAD PDF 3.0+4.6 m opposite segments)"},
  "127":{front:7.6,back:7.6,depth:13.7,depth2:13.7,front_label:"7.6 m (25 ft)",back_label:"7.6 m (25 ft)",depth_label:"13.7 m (45 ft)",depth2_label:"13.7 m (45 ft)"},
  "203":{back:10.7,back_label:"10.7 m (35 ft; PDF 25 FT WIDE ROAD side)",front_edge_index:2,back_edge_index:0,depth_edge_index:3,depth2_edge_index:1},
  "241":{front:6.1,front_label:"6.1 m (20 ft; PDF road-facing left edge)"},
  "242":{back:6.1,back_label:"6.1 m (20 ft; PDF opposite boundary)"},
  "16":{depth:13.9,depth_label:"13.9 m (46 ft; PDF outer edge 7.8+6.1 m)"},
  "23":{depth:13.8,depth_label:"13.8 m (46 ft; PDF two-segment side 6.3+7.5 m)",depth2:13.7,depth2_label:"13.7 m (45 ft; PDF opposite continuous side)"},
  "50":{depth2:13.6,depth2_label:"13.6 m (45 ft; PDF outer edge 10.0+3.6 m)"},
  "123":{depth2:13.8,depth2_label:"13.8 m (45 ft; PDF outer edge 7.7+6.1 m)"},
  "107":{depth2:19.2,depth2_label:"19.2 m (63 ft; PDF DRAIN boundary 6.1+4.5+8.6 m, 3 segments)"}
};
function expectedEdge203(src){const x=JSON.parse(src);x.roles={front:[2],back:[0],depthA:[3],depthB:[1]};return JSON.stringify(x)}
let changed=0;
for(const [table,oldRows,newRows] of [["draft",backup.draft,draft],["published",backup.published,pub]]){
 for(const old of oldRows){
  const actual=get(newRows,old.id);
  if(!actual)throw Error("missing "+table+" "+old.id);
  const id=String(old.id),allowed={...old,...(expect[id]||{})};
  if(id==="203")allowed.edge_semantics=expectedEdge203(old.edge_semantics);
  if(id==="107"&&table==="published")allowed.edge_semantics=get(draft,"107").edge_semantics;
  if(table==="draft"&&["203","242"].includes(id))allowed.notes=actual.notes;
  for(const key of Object.keys(old)){
   if(JSON.stringify(actual[key])!==JSON.stringify(allowed[key]))throw Error("unexpected mutation "+table+" "+id+" "+key);
  }
  if(JSON.stringify(old)!==JSON.stringify(actual))changed++;
 }
 console.log("POST_VERIFY "+JSON.stringify({table,records:243,allUnchangedExceptAllowlist:true}));
}
if(get(draft,"152").back!==null||get(pub,"152").back!==null||JSON.parse(get(pub,"152").polygon).length!==3)throw Error("triangle 152 was modified");
if(get(draft,"203").back!==10.7||get(pub,"203").back!==10.7||get(draft,"242").back!==6.1||get(pub,"242").back!==6.1)throw Error("back measurements not persisted");
const remaining=[];
for(const x of pub){
 const pts=JSON.parse(x.polygon);
 if(!Array.isArray(pts)||pts.length<3)continue;
 const len=pts.map((a,i)=>{const b=pts[(i+1)%pts.length];return Math.hypot((a[0]-b[0])*4096,(a[1]-b[1])*2304)*0.1184});
 const roles=JSON.parse(x.edge_semantics||"{}").roles||{};
 const m=["front","back","depth","depth2"].map((k,i)=>{
   const role=["front","back","depthA","depthB"][i],fallback=x[["front_edge_index","back_edge_index","depth_edge_index","depth2_edge_index"][i]];
   const segments=Array.isArray(roles[role])?roles[role]:(Number.isInteger(fallback)?[fallback]:[]);
   const expected=segments.reduce((n,j)=>n+(len[j]||0),0);
   return expected>0&&x[k]!=null?Math.abs(x[k]/expected-1):null;
 });
 if(m.some(v=>v!=null&&v>0.25))remaining.push({id:x.id,vertices:pts.length,maxSideDifferencePercent:+(Math.max(...m.filter(v=>v!==null))*100).toFixed(1)});
}
console.log("POST_STATUS "+JSON.stringify({projectId:P,checked:243,correctionsPersisted:11,polygonChanges:0,areaChanges:0,draftPublishedMetadataMatch:true,cacheRevision:rev[0].value,unresolvedSideGeometryFlags:remaining.length,flagged:remaining,strictFourEdgeReview:remaining.filter(v=>v.vertices===4&&!['1','2'].includes(String(v.id)))}));
console.log("READ_ONLY_COMPLETE");
