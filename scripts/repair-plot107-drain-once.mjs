
import{spawnSync}from"node:child_process";
import{writeFileSync,readFileSync}from"node:fs";
import{randomBytes,createHash}from"node:crypto";
const P="ec6b45b5-7232-475a-bba8-468caccfe568";
const oldRev="fi-segment-repair-20261102-946b2d9228968313108f";
const nextValue=19.2;
const nextLabel="19.2 m (63 ft; PDF DRAIN boundary 6.1+4.5+8.6 m, 3 segments)";
if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)throw Error("D1 credentials unavailable");
const q=v=>v===null?"NULL":typeof v==="number"?String(v):"'"+String(v).replaceAll("'","''")+"'";
function exec(args){const r=spawnSync("./node_modules/.bin/wrangler",args,{encoding:"utf8",maxBuffer:30000000,timeout:60000,env:process.env});if(r.status!==0)throw Error("wrangler command rejected "+r.stderr.slice(0,500));return r.stdout.trim()}
function d1(cmd){const z=JSON.parse(exec(["d1","execute","tiyansh-production","--remote","--json","--command",cmd]));const xs=Array.isArray(z)?z:[z];if(xs.some(x=>x.success===false))throw Error("SQL rejected");return{rows:xs.flatMap(x=>x.results||[]),changed:xs.reduce((n,x)=>n+Number(x.meta?.changes||0),0)}}
const project=d1("SELECT id,slug,publish_version AS v,public_status AS status FROM projects WHERE id="+q(P)).rows;
const snapshot=d1("SELECT publish_version AS v FROM project_public_snapshots WHERE project_id="+q(P)).rows;
const rev=d1("SELECT value FROM published_settings WHERE project_id="+q(P)+" AND key='publicDataRevision'").rows;
if(project.length!==1||project[0].slug!=="future-invest-realty-ec6b45"||project[0].v!==2||project[0].status!=="published"||snapshot[0]?.v!==2||rev[0]?.value!==oldRev)throw Error("STOP project/version/revision guard");
const fields="id,front,back,depth,depth2,front_label,back_label,depth_label,depth2_label,front_edge_index,back_edge_index,depth_edge_index,depth2_edge_index,polygon,edge_semantics,sqm,sqft,sqyd,status";
const draft=d1("SELECT "+fields+" FROM plots WHERE project_id="+q(P)+" AND inventory_active=1 ORDER BY id").rows;
const pub=d1("SELECT "+fields+" FROM published_plots WHERE project_id="+q(P)+" ORDER BY id").rows;
if(draft.length!==243||pub.length!==243)throw Error("STOP rowcounts");
const get=(rows,id)=>rows.find(x=>String(x.id)===String(id));
const a=get(draft,107),b=get(pub,107);
if(!a||!b||a.depth2!==8.6||b.depth2!==8.6||a.polygon!==b.polygon||a.edge_semantics!==b.edge_semantics)throw Error("STOP plot107 preconditions changed");
const sem=JSON.parse(a.edge_semantics),pts=JSON.parse(a.polygon);
if(pts.length!==6||JSON.stringify(sem.roles?.depthB)!==JSON.stringify([1,2,3]))throw Error("STOP expected chain missing");
const W=4096,H=2304,scale=.1184;
const lens=pts.map((v,i)=>{const n=pts[(i+1)%pts.length];return Math.hypot((v[0]-n[0])*W,(v[1]-n[1])*H)*scale});
const len=sem.roles.depthB.reduce((n,i)=>n+lens[i],0),pct=Math.abs(nextValue/len-1)*100;
if(pct>10)throw Error("STOP PDF sum does not match mapped chain");
console.log("PLOT107_PREFLIGHT "+JSON.stringify({oldNumeric:8.6,newNumeric:nextValue,printedSegments:[6.1,4.5,8.6],geometryChainLength:+len.toFixed(2),differencePercent:+pct.toFixed(1),polygonVertices:6,roles:sem.roles.depthB}));
if(process.env.FIX_PLOT107!=="yes"){console.log("PLOT107_NO_WRITES");process.exit(0)}
const backup={project:project[0],snapshot:snapshot[0],previousRevision:oldRev,draft,published:pub};
const body=JSON.stringify(backup),file="/tmp/fi107-backup.json",check="/tmp/fi107-check.json";
writeFileSync(file,body,{mode:0o600});
const key="projects/"+P+"/backups/plot107-drain-depth-before-20261102-"+randomBytes(8).toString("hex")+".json";
exec(["r2","object","put","tiyansh-gallery-production/"+key,"--remote","--file",file,"--content-type","application/json"]);
exec(["r2","object","get","tiyansh-gallery-production/"+key,"--remote","--file",check]);
const sha=x=>createHash("sha256").update(x).digest("hex");
if(sha(readFileSync(check))!==sha(Buffer.from(body)))throw Error("STOP R2 backup mismatch");
console.log("PLOT107_BACKUP_VERIFIED "+key);
const gate=" AND EXISTS(SELECT 1 FROM projects WHERE id="+q(P)+" AND slug='future-invest-realty-ec6b45' AND publish_version=2 AND public_status='published')";
for(const [table,old] of [["plots",a],["published_plots",b]]){
 const stmt="UPDATE "+table+" SET depth2="+q(nextValue)+",depth2_label="+q(nextLabel)+" WHERE project_id="+q(P)+" AND id='107' AND depth2=8.6 AND depth2_label="+q(old.depth2_label)+" AND polygon="+q(old.polygon)+" AND edge_semantics="+q(old.edge_semantics)+gate;
 const result=d1(stmt);
 if(result.changed!==1)throw Error("STOP row update mismatch "+table);
 console.log("PLOT107_UPDATED "+table);
}
for(const [table,original] of [["plots",draft],["published_plots",pub]]){
 const now=d1("SELECT "+fields+" FROM "+table+" WHERE project_id="+q(P)+" "+(table==="plots"?"AND inventory_active=1 ":"")+"ORDER BY id").rows;
 if(now.length!==243)throw Error("STOP rows after");
 for(const old of original){
  const latest=get(now,old.id);
  const want={...old};
  if(String(old.id)==="107"){want.depth2=nextValue;want.depth2_label=nextLabel}
  for(const col of Object.keys(old))if(JSON.stringify(latest?.[col])!==JSON.stringify(want[col]))throw Error("STOP unintended field mutation "+table+" "+old.id+" "+col);
 }
 console.log("PLOT107_VERIFIED "+JSON.stringify({table,rows:now.length,polygonsChanged:0,areasChanged:0}));
}
const newRevision="fi-drain-chain-20261102-"+randomBytes(8).toString("hex");
const n=d1("UPDATE published_settings SET value="+q(newRevision)+" WHERE project_id="+q(P)+" AND key='publicDataRevision' AND value="+q(oldRev)+gate).changed;
if(n!==1||d1("SELECT value FROM published_settings WHERE project_id="+q(P)+" AND key='publicDataRevision'").rows[0]?.value!==newRevision)throw Error("STOP revision");
console.log("PLOT107_REPAIR_COMPLETE "+JSON.stringify({id:107,depth2:nextValue,newRevision,backupKey:key,polygonsChanged:0,areaChanged:0}));
