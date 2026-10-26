#!/usr/bin/env node
// Manual one-time Metro City S-1..S-10 inventory repair.
// Never run during production deploy. All writes are project-scoped and guarded.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mode = process.argv[2] || "dry-run";
if (!["dry-run", "apply"].includes(mode)) throw Error("mode must be dry-run or apply");
const DB="tiyansh-production", BUCKET="tiyansh-gallery-production", EXPECTED=711;
const ids=Array.from({length:10},(_,i)=>"S-"+(i+1)), remove=ids.slice(1);
const norm=s=>String(s??"").trim().toUpperCase().replace(/\s+/g,"");
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const temp=mkdtempSync(join(tmpdir(),"metro-s1-"));
const file=name=>join(temp,name);
const wrangler=args=>execFileSync("npx",["--no-install","wrangler",...args],{encoding:"utf8",maxBuffer:2e7});
function query(sql){
  const result=JSON.parse(wrangler(["d1","execute",DB,"--remote","--json","--command",sql]));
  const output=[];
  function walk(value){
    if(Array.isArray(value)){value.forEach(walk);return;}
    if(value&&typeof value==="object"){
      if(Array.isArray(value.results)){output.push(...value.results);return;}
      Object.values(value).forEach(walk);
    }
  }
  walk(result);return output;
}
function assert(ok,reason){if(!ok)throw Error("STOP; no intentional change: "+reason);}
function get(key,path){wrangler(["r2","object","get",BUCKET+"/"+key,"--remote","--file="+path]);}
function put(key,path){wrangler(["r2","object","put",BUCKET+"/"+key,"--remote","--file="+path,"--content-type=text/csv; charset=utf-8"]);}
function parseCSV(text){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===","&&!quoted){row.push(field);field="";}
    else if((c==="\n"||c==="\r")&&!quoted){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(field);rows.push(row);row=[];field="";
    }else field+=c;
  }
  assert(!quoted,"unclosed source CSV quote");
  if(field!==""||row.length){row.push(field);rows.push(row);}
  return rows;
}
const toCSV=rows=>rows.map(row=>row.map(x=>{
  const s=String(x??"");
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}).join(",")).join("\r\n")+"\r\n";
function transform(text,factor,activeIds){
  const original=parseCSV(text.replace(/^\uFEFF/,""));
  const headers=original[0]||[];
  const names=headers.map(s=>s.toLowerCase().replace(/[^a-z0-9]/g,""));
  const col=(...alts)=>names.findIndex(s=>alts.includes(s));
  const idCol=col("id","plot","plotno","plotnumber","lot","lotno","lotnumber");
  const sqft=col("sqft","squarefeet","squarefoot","areaft","areasqft");
  const sqm=col("sqm","squaremetre","squaremeter","m2","areasqm");
  const sqyd=col("sqyd","squareyard","squareyards","yd2","areasqyd");
  const dimensions=col("dimensions","dimension","size","plotsize","measurement");
  assert(idCol>=0&&(sqft>=0||sqm>=0||sqyd>=0)&&dimensions>=0,"unrecognized plot sheet columns");
  const rows=original.slice(1).filter(row=>row.some(v=>String(v).trim()));
  const found=rows.map(row=>norm(row[idCol]));
  assert(rows.length===EXPECTED&&rows.every(r=>r.length===headers.length),"source CSV row/count mismatch");
  assert(new Set(found).size===EXPECTED&&activeIds.size===EXPECTED&&found.every(id=>activeIds.has(id)),"R2 source differs from active D1 inventory");
  assert(ids.every(id=>found.filter(x=>x===id).length===1),"source lacks exact S-1 through S-10");
  const clear=new Set(["road","roadaccess","facing","face","roadfacing","front","frontage","frontlength","frontft","frontfeet","back","rear","backlength","rearwidth","backft","backfeet","depth","plotdepth","depthlength","depthft","depthfeet","deptha","depth2","depthb","depthright","otherdepth","seconddepth","frontedge","frontedge1based","roadedge","roadsideedge","depthedge","depthedge1based","depthsideedge","depthaedge","backedge","rearedge","backedge1based","depth2edge","depthbedge","seconddepthedge","frontlabel","frontdisplay","fronttext","frontdisplaylabel","depthlabel","depthdisplay","depthtext","depthdisplaylabel","depthalabel","backlabel","rearlabell","reardisplay","backdisplay","depth2label","depthblabel","seconddepthlabel","sidedimensions","sidemeasurements","sidelabels","pdfsides","frontdirection","roadfrontdirection","frontside","roadfrontside","notes","note","remarks","remark"]);
  const next=[headers];
  for(const prior of rows){
    const plot=norm(prior[idCol]);if(remove.includes(plot))continue;
    const row=[...prior];
    if(plot==="S-1"){
      row[idCol]="S-1";
      if(sqft>=0)row[sqft]="3000";
      if(sqm>=0)row[sqm]=(3000/factor).toFixed(6);
      if(sqyd>=0)row[sqyd]=(3000/factor*1.1959900463).toFixed(6);
      row[dimensions]="60 x 50 ft";
      for(let i=0;i<names.length;i++)if(clear.has(names[i]))row[i]="";
      const unit=col("dimensionunit","lengthunit","measurementunit","unit");
      if(unit>=0)row[unit]="ft";
    }
    next.push(row);
  }
  assert(next.length===703,"corrected source must have 702 plot records plus header");
  return toCSV(next);
}
function main(){
  const projects=query("SELECT id,name,slug FROM projects WHERE LOWER(TRIM(name))='metro city' AND status='active'");
  assert(projects.length===1,"Metro City project not uniquely identified; do not alter any other project");
  const p=projects[0],projectId=String(p.id),pid=quote(projectId);
  assert(/^[a-f0-9-]{20,50}$/i.test(projectId),"project ID not recognized");
  const all=query("SELECT p.id,p.status,p.sqft,p.inventory_active AS active,LENGTH(TRIM(COALESCE(p.polygon,''))) AS polygonSize,(SELECT COUNT(*) FROM property_sales s WHERE s.project_id=p.project_id AND s.plot_id=p.id) AS sales,(SELECT COUNT(*) FROM plot_pricing pr WHERE pr.project_id=p.project_id AND pr.plot_id=p.id) AS pricing,(SELECT COUNT(*) FROM plot_admin_details d WHERE d.project_id=p.project_id AND d.plot_id=p.id AND (COALESCE(TRIM(d.owner_name),'')<>'' OR d.booking_amount_paise IS NOT NULL OR COALESCE(TRIM(d.broker_name),'')<>'')) AS adminDetails FROM plots p WHERE p.project_id="+pid);
  const active=all.filter(x=>Number(x.active)===1),byId=new Map(all.map(x=>[norm(x.id),x]));
  const targets=ids.map(id=>byId.get(id));
  console.log(JSON.stringify({mode,project:p.name,slug:p.slug,projectId,activeCount:active.length,targets:targets.map((row,i)=>({id:ids[i],exists:!!row,active:row?.active,status:row?.status,mapped:Boolean(row?.polygonSize),sales:row?.sales,pricing:row?.pricing,ownerDetails:row?.adminDetails}))},null,2));
  assert(active.length===EXPECTED,"active plot count differs from original 711");
  assert(targets.every((row,i)=>row&&row.id===ids[i]&&Number(row.active)===1),"old IDs must be exactly S-1..S-10 and all active");
  assert(targets.every(row=>row.status==="available"&&!Number(row.sales)&&!Number(row.pricing)&&!Number(row.adminDetails)),"some S plots have Sold/Booked/financial or owner/pricing data; manual review necessary");
  const settingRows=query("SELECT key,value FROM settings WHERE project_id="+pid+" AND key IN ('sqmToSqftFactor','plotSheetName','plotFrontDirections')");
  const settings=Object.fromEntries(settingRows.map(r=>[r.key,r.value]));
  const factor=settings.sqmToSqftFactor===undefined?10.7639:Number(settings.sqmToSqftFactor);
  assert(Number.isFinite(factor)&&factor>0,"invalid project area conversion factor");
  assert(/\.csv$/i.test(settings.plotSheetName||""),"R2 canonical source is not named .csv");
  const canonical="projects/"+projectId+"/mapper/plotSheet";
  const oldFile=file("old.csv"),newFile=file("new.csv");
  get(canonical,oldFile);
  const edited=transform(readFileSync(oldFile,"utf8"),factor,new Set(active.map(row=>norm(row.id))));
  writeFileSync(newFile,edited);
  console.log("Preflight PASS: exactly 711 -> 702 active plots; S-1 will be 60x50 ft (3000 sqft), unmapped.");
  console.log("Masterplan and published customer snapshot will not be touched.");
  if(mode==="dry-run"){console.log("NO CHANGES: Run again with mode=apply after reviewing this report.");return;}
  let directions=null;
  if(settings.plotFrontDirections!==undefined){
    let values;try{values=JSON.parse(settings.plotFrontDirections);}catch{throw Error("Invalid directions JSON; stopped");}
    assert(values&&!Array.isArray(values)&&typeof values==="object","invalid plot directions");
    for(const key of Object.keys(values))if(ids.includes(norm(key)))delete values[key];
    directions=JSON.stringify(values);
  }
  const full=ids.map(quote).join(","),retired=remove.map(quote).join(",");
  const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const stmts=[
    "CREATE TABLE _metro_s_guard_20261026(ok INTEGER NOT NULL CHECK(ok=1))",
    "INSERT INTO _metro_s_guard_20261026(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM projects WHERE id="+pid+" AND LOWER(TRIM(name))='metro city' AND status='active')=1 AND (SELECT COUNT(*) FROM plots WHERE project_id="+pid+" AND inventory_active=1)=711 AND (SELECT COUNT(*) FROM plots WHERE project_id="+pid+" AND id IN ("+full+") AND inventory_active=1 AND status='available')=10 AND (SELECT COUNT(*) FROM property_sales WHERE project_id="+pid+" AND plot_id IN ("+full+"))=0 AND (SELECT COUNT(*) FROM plot_pricing WHERE project_id="+pid+" AND plot_id IN ("+full+"))=0 AND (SELECT COUNT(*) FROM plot_admin_details WHERE project_id="+pid+" AND plot_id IN ("+full+") AND (COALESCE(TRIM(owner_name),'')<>'' OR booking_amount_paise IS NOT NULL OR COALESCE(TRIM(broker_name),'')<>''))=0 THEN 1 ELSE 0 END",
    "CREATE TABLE metro_sseries_before_20261026_plots AS SELECT * FROM plots WHERE project_id="+pid+" AND id IN ("+full+")",
    "CREATE TABLE metro_sseries_before_20261026_edges AS SELECT * FROM plot_edge_measurements WHERE project_id="+pid+" AND plot_id IN ("+full+")",
    "CREATE TABLE metro_sseries_before_20261026_geo AS SELECT * FROM geo_features WHERE project_id="+pid+" AND linked_plot_id IN ("+full+")",
    "CREATE TABLE metro_sseries_before_20261026_settings AS SELECT * FROM settings WHERE project_id="+pid+" AND key IN ('plotSheetCount','plotSheetName','plotFrontDirections')",
    "DELETE FROM plot_edge_measurements WHERE project_id="+pid+" AND plot_id='S-1'",
    "UPDATE geo_features SET linked_plot_id=NULL WHERE project_id="+pid+" AND linked_plot_id IN ("+full+")",
    "UPDATE plots SET sqft=3000,sqm="+(3000/factor)+",sqyd="+(3000/factor*1.1959900463)+",dimensions='60 x 50 ft',road='',front=NULL,back=NULL,depth=NULL,depth2=NULL,dimension_unit='ft',front_edge_index=NULL,back_edge_index=NULL,depth_edge_index=NULL,depth2_edge_index=NULL,front_label=NULL,back_label=NULL,depth_label=NULL,depth2_label=NULL,side_dimensions=NULL,edge_semantics=NULL,polygon='',notes='',featured=0,updated_at="+now+" WHERE project_id="+pid+" AND id='S-1' AND inventory_active=1",
    "UPDATE plots SET inventory_active=0,updated_at="+now+" WHERE project_id="+pid+" AND id IN ("+retired+") AND inventory_active=1",
    "INSERT INTO settings(project_id,key,value,updated_at) VALUES("+pid+",'plotSheetCount','702',"+now+") ON CONFLICT(project_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    "UPDATE settings SET value='Metro_City_702_S1_60x50.csv',updated_at="+now+" WHERE project_id="+pid+" AND key='plotSheetName'",
    ...(directions===null?[]:["UPDATE settings SET value="+quote(directions)+",updated_at="+now+" WHERE project_id="+pid+" AND key='plotFrontDirections'"]),
    "CREATE TABLE _metro_s_post_20261026(ok INTEGER NOT NULL CHECK(ok=1))",
    "INSERT INTO _metro_s_post_20261026(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM plots WHERE project_id="+pid+" AND inventory_active=1)=702 AND (SELECT COUNT(*) FROM plots WHERE project_id="+pid+" AND id='S-1' AND sqft=3000 AND polygon='' AND inventory_active=1)=1 AND (SELECT COUNT(*) FROM plots WHERE project_id="+pid+" AND id IN ("+retired+") AND inventory_active=0)=9 THEN 1 ELSE 0 END",
    "DROP TABLE _metro_s_guard_20261026",
    "DROP TABLE _metro_s_post_20261026"
  ];
  writeFileSync(file("patch.sql"),stmts.join(";\n")+";\n");
  // Private original R2 backup. If D1 fails, canonical R2 is still unchanged.
  put("projects/"+projectId+"/backups/plotSheet-before-S-series-20261026.csv",oldFile);
  console.log("Original R2 CSV backed up. Applying guarded draft-only D1 correction.");
  wrangler(["d1","execute",DB,"--remote","--file="+file("patch.sql")]);
  const check=query("SELECT COUNT(*) AS total FROM plots WHERE project_id="+pid+" AND inventory_active=1");
  assert(Number(check[0]?.total)===702,"postflight D1 count invalid; do not overwrite canonical R2");
  put(canonical,newFile);
  const readback=file("readback.csv");get(canonical,readback);
  assert(readFileSync(readback,"utf8")===edited,"R2 source readback mismatch; original backup is available");
  console.log("SUCCESS: Metro City draft contains 702 active plots. S-1 = 3000 sqft, unmapped. S-2..S-10 inactive. Draw S-1 boundary on the new image and then Publish Update.");
}
try{main();}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
