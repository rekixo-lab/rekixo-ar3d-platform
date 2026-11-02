
import {spawnSync} from "node:child_process";
const projectId="ec6b45b5-7232-475a-bba8-468caccfe568";
const ids=[1,2,3,6,16,23,29,33,34,42,50,56,85,93,107,120,123,127,149,152,198,203,205,206,214,239,240,241,242,244];
const selected=ids.map(v=>"'"+v+"'").join(",");
function query(label,sql){
 if(!/^SELECT /i.test(sql))throw Error("read only query must begin SELECT");
 const p=spawnSync("./node_modules/.bin/wrangler",["d1","execute","tiyansh-production","--remote","--json","--command",sql],{encoding:"utf8",env:process.env,maxBuffer:20000000,timeout:60000});
 if(p.status!==0)throw Error(label+": "+p.stderr.slice(0,800));
 const body=JSON.parse(p.stdout.trim());const records=Array.isArray(body)?body:[body];
 if(records.some(x=>x.success===false))throw Error(label+" unsuccessful");
 const result=records.flatMap(x=>x.results||[]);
 console.log("AUDIT_QUERY "+JSON.stringify({label,count:result.length}));
 return result;
}
const proj=query("project","SELECT id,slug,publish_version AS publishVersion FROM projects WHERE id='"+projectId+"' AND slug='future-invest-realty-ec6b45' AND status='active'");
if(proj.length!==1)throw Error("project mismatch");
const fields="id,sqm,sqft,sqyd,front,back,depth,depth2,dimension_unit AS unit,front_label AS frontLabel,back_label AS backLabel,depth_label AS depthLabel,depth2_label AS depth2Label,front_edge_index AS frontIndex,back_edge_index AS backIndex,depth_edge_index AS depthIndex,depth2_edge_index AS depth2Index,road,dimensions,side_dimensions AS sideDimensions,notes,polygon,edge_semantics AS edgeSemantics,updated_at AS updatedAt";
const source=query("source","SELECT "+fields+" FROM plots WHERE project_id='"+projectId+"' AND id IN ("+selected+") ORDER BY CAST(id AS INTEGER)");
const published=query("published","SELECT "+fields+" FROM published_plots WHERE project_id='"+projectId+"' AND id IN ("+selected+") ORDER BY CAST(id AS INTEGER)");
const publishedScale=query("scale","SELECT key,value FROM published_settings WHERE project_id='"+projectId+"' AND key IN ('mapHeight','mapWidth','publicDataRevision')");
const summary=query("count","SELECT (SELECT COUNT(*) FROM plots WHERE project_id='"+projectId+"' AND inventory_active=1) AS draftCount,(SELECT COUNT(*) FROM published_plots WHERE project_id='"+projectId+"') AS pubCount");
if(summary.length!==1||summary[0].draftCount!==243||summary[0].pubCount!==243)throw Error("unexpected row counts");
function normalized(x){
 let polygon=[];
 try{polygon=JSON.parse(x.polygon||"[]")}catch{};
 const obj={...x,verts:polygon.length};obj.polygon=polygon;
 return obj;
}
const draftMap=new Map(source.map(v=>[String(v.id),normalized(v)]));
const pubMap=new Map(published.map(v=>[String(v.id),normalized(v)]));
console.log("AUDIT_CONTEXT "+JSON.stringify({projectId,version:proj[0].publishVersion,settings:publishedScale,counts:summary[0]}));
for(const id of ids){
 const draft=draftMap.get(String(id)),pub=pubMap.get(String(id));
 console.log("AUDIT_PLOT "+JSON.stringify({id,draft,published:pub,drift:JSON.stringify(draft)!==JSON.stringify(pub)}));
}
console.log("READ_ONLY_COMPLETE");
