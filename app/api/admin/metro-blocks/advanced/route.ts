import {env} from "cloudflare:workers";
import {requireSuperAdmin,sameOrigin} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {METRO_BLOCK_PROJECT_ID,metroBlockKey,type MetroBlockKey} from "@/app/metro-blocks";
import {safeBlockPolygon,encodeBlockSides,readBlockSides} from "@/app/metro-block-safe-geometry";

export const dynamic="force-dynamic";
const PROJECT=METRO_BLOCK_PROJECT_ID;
type MapperPlot={
  id:string;polygon:string;sideBindings:string;sqft:number;sqm:number;sqyd:number;
  dimensions:string;road:string;front:number|null;back:number|null;depth:number|null;depth2:number|null;
  dimensionUnit:string|null;frontLabel:string|null;backLabel:string|null;depthLabel:string|null;depth2Label:string|null;
  sideDimensions:string|null;status:string;notes:string;featured:number;
};
type DraftAsset={objectKey:string;width:number;height:number;filename:string;northAngle:number};
const fail=(error:string,status=400)=>Response.json({error},{status,headers:{"cache-control":"no-store"}});

async function projectReady(){
  return !!await env.DB.prepare(
    "SELECT 1 FROM projects WHERE id=? AND slug='metro-city-c024a5' AND name='Metro City' AND status='active' LIMIT 1"
  ).bind(PROJECT).first();
}
async function draftAsset(block:MetroBlockKey) {
  return env.DB.prepare(
    "SELECT draft_object_key AS objectKey,draft_width AS width,draft_height AS height,draft_filename AS filename,draft_north_angle AS northAngle FROM metro_block_assets WHERE project_id=? AND block_key=?"
  ).bind(PROJECT,block).first<DraftAsset>();
}
async function rows(block:MetroBlockKey) {
  return env.DB.prepare(
    "SELECT p.id,p.sqft,p.sqm,p.sqyd,p.dimensions,p.road,p.front,p.back,p.depth,p.depth2,p.dimension_unit AS dimensionUnit,p.front_label AS frontLabel,p.back_label AS backLabel,p.depth_label AS depthLabel,p.depth2_label AS depth2Label,p.side_dimensions AS sideDimensions,p.status,p.notes,p.featured,m.polygon,m.side_bindings AS sideBindings FROM metro_block_plot_maps m JOIN plots p ON p.project_id=m.project_id AND p.id=m.plot_id WHERE m.project_id=? AND m.block_key=? AND p.inventory_active=1 ORDER BY p.id"
  ).bind(PROJECT,block).all<MapperPlot>();
}
function toEditorPlot(row:MapperPlot){
  const {sideBindings,...source}=row;
  return {...source,...readBlockSides(sideBindings),blockSideRevision:sideBindings,featured:Boolean(source.featured)};
}
async function respond(block:MetroBlockKey) {
  const [result,asset,factor]=await Promise.all([
    rows(block),draftAsset(block),
    env.DB.prepare("SELECT value FROM settings WHERE project_id=? AND key='sqmToSqftFactor'").bind(PROJECT).first<{value:string}>(),
  ]);
  const hasImage=Boolean(asset?.objectKey&&asset.width>100&&asset.height>100);
  return Response.json({
    plots:result.results.map(toEditorPlot),
    settings:{
      masterplanName:hasImage?asset!.filename:"",
      masterplanVersion:hasImage?asset!.objectKey:"",
      mapWidth:String(hasImage?asset!.width:1200),
      mapHeight:String(hasImage?asset!.height:1000),
      masterplanOriginalWidth:String(hasImage?asset!.width:1200),
      masterplanOriginalHeight:String(hasImage?asset!.height:1000),
      masterplanNorthAngle:String(hasImage?asset!.northAngle:0),
      publicRotation:"0",plotFacingEnabled:"1",plotNorthDirection:"top",
      sqmToSqftFactor:factor?.value||"10.7639",
    },
    cadGeometry:null,
  },{headers:{"cache-control":"no-store"}});
}
export async function GET(request:Request) {
  if(!await requireSuperAdmin())return fail("Super Admin only",403);
  const url=new URL(request.url);
  if(url.searchParams.get("projectId")!==PROJECT)return fail("Wrong project",404);
  const block=metroBlockKey(url.searchParams.get("block"));
  if(!block||!await projectReady())return fail("Invalid block or project",404);
  return respond(block);
}
export async function POST(request:Request) {
  const actor=await requireSuperAdmin();
  if(!actor)return fail("Super Admin only",403);
  if(!sameOrigin(request))return fail("Invalid request origin",403);
  if(!(request.headers.get("content-type")||"").includes("application/json"))return fail("JSON required",415);
  const body=await request.json().catch(()=>null) as null|{
    projectId?:string;block?:string;action?:string;
    plot?:Record<string,unknown>;expectedPolygon?:string;expectedBindings?:string;
  };
  if(!body||body.projectId!==PROJECT||!await projectReady())return fail("Wrong project",404);
  const block=metroBlockKey(body.block);
  if(!block)return fail("Invalid block",400);
  if(body.action!=="save"&&body.action!=="clear")return fail("Only block-scoped plot save/clear is allowed",403);
  const id=typeof body.plot?.id==="string"?body.plot.id.trim():"";
  // Verified against the exact assigned active ID below; combined labels are allowed.
  // Only actual C0/DEL control characters are forbidden. Do NOT match the\n  // literal digits 0/1: an earlier doubly-escaped regex rejected Plot "1".\n  if(!id||id.length>80||[...id].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))return fail("Valid existing plot ID required",400);
  if(typeof body.expectedPolygon!=="string"||typeof body.expectedBindings!=="string")return fail("Expected previous polygon/side revision required; reload editor",409);
  const current=await env.DB.prepare(
    "SELECT m.polygon,m.side_bindings AS sideBindings FROM metro_block_plot_maps m JOIN plots p ON p.project_id=m.project_id AND p.id=m.plot_id AND p.inventory_active=1 WHERE m.project_id=? AND m.block_key=? AND m.plot_id=? LIMIT 1"
  ).bind(PROJECT,block,id).first<{polygon:string;sideBindings:string}>();
  if(!current)return fail("Plot does not belong to this block",404);
  if(current.polygon!==body.expectedPolygon||current.sideBindings!==body.expectedBindings)return fail("This block plot or side assignment changed in another tab. Reload before overwriting.",409);
  let polygon="",sides="";
  if(body.action==="save"){
    const original=body.plot?.polygon;
    polygon=safeBlockPolygon(original)||"";
    if(!polygon)return fail("Polygon must be a valid, non-self-intersecting 3–80 corner shape",400);
    const points=JSON.parse(polygon) as unknown[];
    sides=encodeBlockSides(body.plot,points.length)||"";
    if(!sides)return fail("Invalid side bindings for this polygon",400);
  }
  const now=new Date().toISOString();
  // An optimistic polygon compare prevents stale tabs from overwriting newer draft geometry.
  // The canonical plots/status/sales tables are NEVER modified.
  const change=await env.DB.prepare(
    "UPDATE metro_block_plot_maps SET polygon=?,side_bindings=?,updated_at=? WHERE project_id=? AND block_key=? AND plot_id=? AND polygon=? AND side_bindings=?"
  ).bind(polygon,sides,now,PROJECT,block,id,body.expectedPolygon,body.expectedBindings).run();
  if(!change.meta.changes)return fail("Draft plot changed. Reload and retry.",409);
  await env.DB.prepare(
    "INSERT INTO metro_block_state(project_id,public_enabled,version,draft_revision,updated_at) VALUES (?,0,0,1,?) ON CONFLICT(project_id) DO UPDATE SET draft_revision=draft_revision+1,updated_at=excluded.updated_at"
  ).bind(PROJECT,now).run();
  const result=await rows(block);
  const saved=result.results.find(p=>p.id===id);
  if(!saved)return fail("Saved but read-back not found; reload",409);
  try{await writeAudit(actor,body.action==="save"?"metro.advanced_polygon_saved":"metro.advanced_polygon_cleared",PROJECT,id,{block})}catch(e){console.error("Metro advanced mapper audit write failed",e)}
  return Response.json({ok:true,plot:toEditorPlot(saved)},{headers:{"cache-control":"no-store"}});
}
