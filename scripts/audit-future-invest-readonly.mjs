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
