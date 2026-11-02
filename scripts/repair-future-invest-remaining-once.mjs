
import {spawnSync} from "node:child_process";
import {writeFileSync,readFileSync} from "node:fs";
import {createHash,randomBytes} from "node:crypto";
const P="ec6b45b5-7232-475a-bba8-468caccfe568";
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)throw Error("NO D1 credentials");
const exec=(argv)=>{
 const r=spawnSync("./node_modules/.bin/wrangler",argv,{encoding:"utf8",maxBuffer:25000000,timeout:60000,env:process.env});
 if(r.status!==0)throw Error("wrangler "+argv.slice(0,4).join(" ")+" failed "+r.stderr.slice(0,500));
 return r.stdout.trim();
};
const enc=v=>v===null||v===undefined?"NULL":typeof v==="number"?String(v):"'"+String(v).replaceAll("'","''")+"'";
function sql(query){const raw=JSON.parse(exec(["d1","execute","tiyansh-production","--remote","--json","--command",query]));const a=Array.isArray(raw)?raw:[raw];if(a.some(x=>x.success===false))throw Error("D1 query failed");return {rows:a.flatMap(x=>x.results||[]),changed:a.reduce((n,x)=>n+Number(x.meta?.changes||0),0)}}
const project=sql("SELECT id,slug,publish_version AS version,public_status AS state FROM projects WHERE id="+enc(P)).rows;
const snapshot=sql("SELECT publish_version AS version FROM project_public_snapshots WHERE project_id="+enc(P)).rows;
if(project.length!==1||project[0].slug!=="future-invest-realty-ec6b45"||project[0].version!==2||project[0].state!=="published"||snapshot.length!==1||snapshot[0].version!==2)throw Error("STOP project/version failed");
const fields="id,front,back,depth,depth2,front_label,back_label,depth_label,depth2_label,front_edge_index,back_edge_index,depth_edge_index,depth2_edge_index,polygon,edge_semantics,sqm,sqft,sqyd,status,road,side_dimensions";
const draft=sql("SELECT "+fields+",notes FROM plots WHERE project_id="+enc(P)+" AND inventory_active=1 ORDER BY id").rows;
const pub=sql("SELECT "+fields+" FROM published_plots WHERE project_id="+enc(P)+" ORDER BY id").rows;
if(draft.length!==243||pub.length!==243)throw Error("STOP row count unexpected");
const oldRev=sql("SELECT value FROM published_settings WHERE project_id="+enc(P)+" AND key='publicDataRevision'").rows;
if(oldRev.length!==1||!String(oldRev[0].value).startsWith("fi-measurements-20261102-"))throw Error("STOP published revision changed");
const get=(records,id)=>records.find(x=>String(x.id)===String(id));
const fixed={
 "120":{back:7.6,back_label:"7.6 m (25 ft; CAD PDF 3.0+4.6 m opposite segments)"},
 "127":{front:7.6,back:7.6,depth:13.7,depth2:13.7,front_label:"7.6 m (25 ft)",back_label:"7.6 m (25 ft)",depth_label:"13.7 m (45 ft)",depth2_label:"13.7 m (45 ft)"},
 "203":{back:10.7,back_label:"10.7 m (35 ft; PDF 25 FT WIDE ROAD side)",front_edge_index:2,back_edge_index:0,depth_edge_index:3,depth2_edge_index:1},
 "241":{front:6.1,front_label:"6.1 m (20 ft; PDF road-facing left edge)"},
 "242":{back:6.1,back_label:"6.1 m (20 ft; PDF opposite boundary)"}
};
const expected={
 "120":{back:4.6}, "127":{front:13.7,back:13.7,depth:7.6,depth2:3},
 "203":{back:null,front_edge_index:0,back_edge_index:2,depth_edge_index:1,depth2_edge_index:3},
 "241":{front:3.6},"242":{back:null}
};
const roles203=(raw)=>{
 const s=JSON.parse(raw);
 if(s.pointCount!==4||JSON.stringify(s.roles)!==JSON.stringify({front:[0],back:[2],depthA:[1],depthB:[3]}))throw Error("STOP plot203 roles unexpectedly changed");
 s.roles={front:[2],back:[0],depthA:[3],depthB:[1]};
 return JSON.stringify(s);
};
const proj107draft=get(draft,107),proj107pub=get(pub,107);
if(!proj107draft||!proj107pub||JSON.stringify(proj107draft.polygon)!==JSON.stringify(proj107pub.polygon))throw Error("STOP 107 polygon changed");
const roles107d=JSON.parse(proj107draft.edge_semantics),roles107p=JSON.parse(proj107pub.edge_semantics);
if(JSON.stringify(roles107d.roles)!==JSON.stringify({front:[0],back:[4],depthA:[5],depthB:[1,2,3]})||JSON.stringify(roles107p.roles)!==JSON.stringify({front:[0],back:[4],depthA:[5],depthB:[1]}))throw Error("STOP 107 expected publish drift absent");
for(const id of Object.keys(fixed)){
 const a=get(draft,id),b=get(pub,id);
 if(!a||!b||a.polygon!==b.polygon||a.edge_semantics!==b.edge_semantics)throw Error("STOP polygon/role mismatch plot "+id);
 for(const [field,v] of Object.entries(expected[id]))if(a[field]!==v||b[field]!==v)throw Error("STOP stale original "+id+" "+field+" "+JSON.stringify([a[field],b[field]]));
 if(id==="203") {fixed[id].edge_semantics=roles203(a.edge_semantics)}
}
const chosen=new Set([...Object.keys(fixed),"107"]);
const scale=0.1184,W=4096,H=2304;
for(const id of Object.keys(fixed)){
 const original=get(pub,id),next={...original,...fixed[id]},pts=JSON.parse(original.polygon);
 if(!Array.isArray(pts)||pts.length!==4)throw Error("STOP mapped 4-edge polygon invalid "+id);
 const sides=["front","back","depth","depth2"],idx=["front_edge_index","back_edge_index","depth_edge_index","depth2_edge_index"];
 const lengths=pts.map((a,i)=>{const b=pts[(i+1)%pts.length];return Math.hypot((a[0]-b[0])*W,(a[1]-b[1])*H)*scale});
 const residuals=sides.map((s,i)=>Math.abs(Number(next[s])/lengths[next[idx[i]]]-1));
 if(residuals.some(x=>!Number.isFinite(x)||x>0.125))throw Error("STOP physical edge length mismatch "+id+" "+residuals);
 console.log("GUARD_PLOT "+JSON.stringify({id,area:original.sqm,current:[original.front,original.back,original.depth,original.depth2],updated:[next.front,next.back,next.depth,next.depth2],residualPercent:residuals.map(x=>+(x*100).toFixed(1)),vertices:pts.length}));
}
console.log("GUARD_107 "+JSON.stringify({id:107,oldRoles:roles107p.roles,newRoles:roles107d.roles,polygonSame:true}));
const mode=process.env.CONFIRMED_REPAIR==="yes";
console.log("GUARD_SUMMARY "+JSON.stringify({mode,project:P,draftRows:draft.length,publishedRows:pub.length,affected:[...chosen],version:2,cacheRevision:oldRev[0].value}));
if(!mode){console.log("GUARD_NO_WRITES");process.exit(0)}
const backup={tag:"future-invest-remaining-before-20261102",project:project[0],snapshot:snapshot[0],cacheRevision:oldRev[0].value,draft,published:pub};
const data=JSON.stringify(backup),file="/tmp/fi-rem-before.json",copy="/tmp/fi-rem-readback.json";
writeFileSync(file,data,{mode:0o600});
const key="projects/"+P+"/backups/remaining-side-fields-before-20261102-"+randomBytes(8).toString("hex")+".json";
exec(["r2","object","put","tiyansh-gallery-production/"+key,"--remote","--file",file,"--content-type","application/json"]);
exec(["r2","object","get","tiyansh-gallery-production/"+key,"--remote","--file",copy]);
const sha=x=>createHash("sha256").update(x).digest("hex");
if(sha(readFileSync(copy))!==sha(Buffer.from(data)))throw Error("STOP backup readback mismatch");
console.log("BACKUP_VERIFIED "+JSON.stringify({key,sha256:sha(Buffer.from(data))}));
const gate=" AND EXISTS (SELECT 1 FROM projects WHERE id="+enc(P)+" AND slug='future-invest-realty-ec6b45' AND publish_version=2 AND public_status='published')";
const immutable=(before)=>" AND polygon="+enc(before.polygon)+" AND edge_semantics="+enc(before.edge_semantics);
function apply(table,id,changes,before){
 const updates=Object.entries(changes).map(([k,v])=>k+"="+enc(v)).join(",");
 const oldGuard=Object.keys(changes).map(k=>" AND "+k+" IS "+enc(before[k])).join("");
 const stmt="UPDATE "+table+" SET "+updates+" WHERE project_id="+enc(P)+" AND id="+enc(id)+immutable(before)+oldGuard+gate;
 const r=sql(stmt);if(r.changed!==1)throw Error("STOP row update count "+table+" "+id+"="+r.changed);
 console.log("UPDATED "+table+" "+id);
}
for(const id of Object.keys(fixed)){
 apply("plots",id,fixed[id],get(draft,id));
 apply("published_plots",id,fixed[id],get(pub,id));
}
apply("published_plots","107",{edge_semantics:proj107draft.edge_semantics},proj107pub);
// Remove stale 'Back not applicable' note only for plots now verified to have Back.
for(const id of ["203","242"]){
 const before=get(draft,id),t=String(before.notes||"");
 const next=t.replace(/BACK NOT APPLICABLE:[^\.]*\./,"BACK CAD PDF VERIFIED: fourth boundary is present; road-facing Front and opposing Back are both mapped.");
 if(next===t)throw Error("STOP expected stale note missing "+id);
 const r=sql("UPDATE plots SET notes="+enc(next)+" WHERE project_id="+enc(P)+" AND id="+enc(id)+" AND notes="+enc(t)+gate);
 if(r.changed!==1)throw Error("STOP notes update "+id);
}
const verify=(table,before)=>{
 const queryFields=fields+(table==="plots"?",notes":"");
 const newer=sql("SELECT "+queryFields+" FROM "+table+" WHERE project_id="+enc(P)+" "+(table==="plots"?"AND inventory_active=1 ":"")+"ORDER BY id").rows;
 if(newer.length!==before.length)throw Error("STOP rowcount changed after");
 for(const b of before){
  const a=get(newer,b.id);if(!a)throw Error("STOP missing plot "+b.id);
  const allowed={...b,...(fixed[String(b.id)]||{})};
  if(table==="published_plots"&&String(b.id)==="107")allowed.edge_semantics=proj107draft.edge_semantics;
  if(table==="plots"&&["203","242"].includes(String(b.id)))allowed.notes=a.notes;
  for(const key of Object.keys(b))if(JSON.stringify(a[key])!==JSON.stringify(allowed[key]))throw Error("STOP immutable value changed "+table+" "+b.id+" "+key);
 }
 console.log("VERIFIED "+table+" "+JSON.stringify({rows:newer.length,changedIds:[...chosen],polygonsUnchanged:true,areasUnchanged:true}));
};
verify("plots",draft);verify("published_plots",pub);
const newRevision="fi-side-repair-20261102-"+randomBytes(10).toString("hex");
const bump=sql("UPDATE published_settings SET value="+enc(newRevision)+" WHERE project_id="+enc(P)+" AND key='publicDataRevision' AND value="+enc(oldRev[0].value)+gate);
if(bump.changed!==1)throw Error("STOP cache revision update failed");
const after=sql("SELECT value FROM published_settings WHERE project_id="+enc(P)+" AND key='publicDataRevision'").rows;
if(after.length!==1||after[0].value!==newRevision)throw Error("STOP post revision mismatch");
console.log("REPAIR_COMPLETE "+JSON.stringify({projectId:P,affectedIds:[...chosen],draftChanged:5,publishedChanged:6,polygonChanges:0,areaChanges:0,cacheRevision:newRevision,backupKey:key}));
