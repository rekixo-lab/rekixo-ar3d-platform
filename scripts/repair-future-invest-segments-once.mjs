
import {spawnSync} from "node:child_process";
import {writeFileSync,readFileSync} from "node:fs";
import {createHash,randomBytes} from "node:crypto";
const P="ec6b45b5-7232-475a-bba8-468caccfe568";
const previousRevision="fi-side-repair-20261102-1bb2e9520796c60ea96f";
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)throw Error("Cloudflare credentials unavailable");
const ex=args=>{const r=spawnSync("./node_modules/.bin/wrangler",args,{encoding:"utf8",maxBuffer:25000000,timeout:60000,env:process.env});if(r.status!==0)throw Error("Cloudflare "+args.slice(0,3).join(" ")+": "+r.stderr.slice(0,500));return r.stdout.trim()};
const read=statement=>{if(!/^SELECT /i.test(statement))throw Error("read-only SELECT only");const z=JSON.parse(ex(["d1","execute","tiyansh-production","--remote","--json","--command",statement]));const rows=Array.isArray(z)?z:[z];if(rows.some(x=>x.success===false))throw Error("SQL query failed");return rows.flatMap(x=>x.results||[])};
const update=statement=>{if(!/^UPDATE /i.test(statement))throw Error("UPDATE only");const z=JSON.parse(ex(["d1","execute","tiyansh-production","--remote","--json","--command",statement]));const v=Array.isArray(z)?z:[z];if(v.some(x=>x.success===false))throw Error("D1 reject UPDATE");return v.reduce((a,b)=>a+Number(b.meta?.changes||0),0)};
const q=x=>x===null?"NULL":typeof x==="number"?String(x):"'"+String(x).replaceAll("'","''")+"'";
const proj=read("SELECT id,slug,publish_version AS ver,public_status FROM projects WHERE id="+q(P));
const snap=read("SELECT publish_version AS ver FROM project_public_snapshots WHERE project_id="+q(P));
const revision=read("SELECT value FROM published_settings WHERE project_id="+q(P)+" AND key='publicDataRevision'");
if(proj.length!==1||proj[0].slug!=="future-invest-realty-ec6b45"||proj[0].ver!==2||proj[0].public_status!=="published"||snap[0]?.ver!==2||revision[0]?.value!==previousRevision)throw Error("STOP project/version/cache revision changed");
const fields="id,front,back,depth,depth2,front_label,back_label,depth_label,depth2_label,front_edge_index,back_edge_index,depth_edge_index,depth2_edge_index,polygon,edge_semantics,sqm,sqft,sqyd,status,road,side_dimensions";
const draft=read("SELECT "+fields+",notes FROM plots WHERE project_id="+q(P)+" AND inventory_active=1 ORDER BY id");
const pub=read("SELECT "+fields+" FROM published_plots WHERE project_id="+q(P)+" ORDER BY id");
if(draft.length!==243||pub.length!==243)throw Error("STOP counts");
const get=(rows,id)=>rows.find(v=>String(v.id)===String(id));
const specs={
 "16":{field:"depth",old:7.8,value:13.9,label:"13.9 m (46 ft; PDF outer edge 7.8+6.1 m)"},
 "23":{field:"depth",old:13.7,value:13.8,label:"13.8 m (46 ft; PDF two-segment side 6.3+7.5 m)",second:{field:"depth2",old:7.5,value:13.7,label:"13.7 m (45 ft; PDF opposite continuous side)"}},
 "50":{field:"depth2",old:10,value:13.6,label:"13.6 m (45 ft; PDF outer edge 10.0+3.6 m)"},
 "123":{field:"depth2",old:7.7,value:13.8,label:"13.8 m (45 ft; PDF outer edge 7.7+6.1 m)"}
};
const labelName={front:"front_label",back:"back_label",depth:"depth_label",depth2:"depth2_label"};
const W=4096,H=2304,meterScale=0.1184;
for(const [id,s] of Object.entries(specs)){
 const a=get(draft,id),b=get(pub,id);
 if(!a||!b||a.polygon!==b.polygon||a.edge_semantics!==b.edge_semantics)throw Error("STOP changed polygon/role "+id);
 for(const orig of [a,b]){
  for(const c of [s,s.second].filter(Boolean)){
   if(orig[c.field]!==c.old)throw Error("STOP old measurement "+id+" "+c.field);
  }
 }
 const pts=JSON.parse(a.polygon),sem=JSON.parse(a.edge_semantics),roles=sem.roles;
 if(pts.length!==sem.pointCount)throw Error("STOP shape count");
 const lengths=pts.map((v,i)=>{const next=pts[(i+1)%pts.length];return Math.hypot((next[0]-v[0])*W,(next[1]-v[1])*H)*meterScale});
 const roleKey={front:"front",back:"back",depth:"depthA",depth2:"depthB"};
 for(const c of [s,s.second].filter(Boolean)){
  const seg=roles[roleKey[c.field]];
  const expected=seg.reduce((n,i)=>n+lengths[i],0);
  const percent=+(Math.abs(c.value/expected-1)*100).toFixed(1);
  if(!(expected>0)||percent>12)throw Error("STOP PDF/geometry mismatch "+id+" "+c.field+" "+percent);
  console.log("SEGMENT_PROOF "+JSON.stringify({id,field:c.field,old:c.old,expectedFromPDF:c.value,geometryLength:+expected.toFixed(2),residualPercent:percent,mappedSegments:seg}));
 }
}
console.log("SECOND_REPAIR_GATE "+JSON.stringify({project:P,verifiedIds:Object.keys(specs),draftRows:draft.length,publishedRows:pub.length,enabled:process.env.CONFIRMED_SEGMENT_REPAIR==="yes"}));
if(process.env.CONFIRMED_SEGMENT_REPAIR!=="yes"){console.log("SEGMENT_DRYRUN_COMPLETE");process.exit(0)}
const before={project:proj[0],snapshot:snap[0],publicRevision:revision[0].value,draft,published:pub};
const body=JSON.stringify(before),local="/tmp/fi-segments-before.json",readback="/tmp/fi-segments-check.json";
writeFileSync(local,body,{mode:0o600});
const key="projects/"+P+"/backups/segment-sums-before-20261102-"+randomBytes(8).toString("hex")+".json";
ex(["r2","object","put","tiyansh-gallery-production/"+key,"--remote","--file",local,"--content-type","application/json"]);
ex(["r2","object","get","tiyansh-gallery-production/"+key,"--remote","--file",readback]);
const sha=x=>createHash("sha256").update(x).digest("hex");
if(sha(readFileSync(readback))!==sha(Buffer.from(body)))throw Error("STOP backup invalid");
console.log("SEGMENT_BACKUP_VERIFIED "+JSON.stringify({key,hash:sha(Buffer.from(body))}));
const gate=" AND EXISTS(SELECT 1 FROM projects WHERE id="+q(P)+" AND slug='future-invest-realty-ec6b45' AND publish_version=2 AND public_status='published')";
for(const [id,s] of Object.entries(specs)){
 const list=[s,s.second].filter(Boolean);
 const changes=Object.fromEntries(list.flatMap(c=>[[c.field,c.value],[labelName[c.field],c.label]]));
 for(const [table,source] of [["plots",draft],["published_plots",pub]]){
  const old=get(source,id);
  const assignments=Object.entries(changes).map(([f,v])=>f+"="+q(v)).join(",");
  const cond=list.map(c=>" AND "+c.field+" IS "+q(c.old)).join("");
  const where=" WHERE project_id="+q(P)+" AND id="+q(id)+" AND polygon="+q(old.polygon)+" AND edge_semantics="+q(old.edge_semantics)+cond+gate;
  const n=update("UPDATE "+table+" SET "+assignments+where);
  if(n!==1)throw Error("STOP changed rows "+table+" "+id+" "+n);
  console.log("SEGMENT_UPDATED "+table+" "+id);
 }
}
for(const [table,oldRows] of [["plots",draft],["published_plots",pub]]){
 const now=read("SELECT "+fields+(table==="plots"?",notes":"")+" FROM "+table+" WHERE project_id="+q(P)+" "+(table==="plots"?"AND inventory_active=1 ":"")+"ORDER BY id");
 if(now.length!==oldRows.length)throw Error("STOP rowcount after "+table);
 for(const old of oldRows){
  const id=String(old.id),s=specs[id],allowed={...old};
  if(s)for(const c of [s,s.second].filter(Boolean)){allowed[c.field]=c.value;allowed[labelName[c.field]]=c.label}
  const after=get(now,id);
  for(const field of Object.keys(old))if(JSON.stringify(after?.[field])!==JSON.stringify(allowed[field]))throw Error("STOP immutable mismatch "+table+" plot "+id+" field "+field);
 }
 console.log("SEGMENT_VERIFIED "+JSON.stringify({table,rows:now.length,polygonsUnchanged:true,areasUnchanged:true,changedPlots:4}));
}
const newRevision="fi-segment-repair-20261102-"+randomBytes(10).toString("hex");
const n=update("UPDATE published_settings SET value="+q(newRevision)+" WHERE project_id="+q(P)+" AND key='publicDataRevision' AND value="+q(previousRevision)+gate);
if(n!==1||read("SELECT value FROM published_settings WHERE project_id="+q(P)+" AND key='publicDataRevision'")[0]?.value!==newRevision)throw Error("STOP revision mismatch");
console.log("SEGMENT_REPAIR_COMPLETE "+JSON.stringify({id:P,rows:4,polygonsChanged:0,areasChanged:0,backupKey:key,cacheRevision:newRevision}));
