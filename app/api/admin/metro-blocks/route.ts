import { env } from "cloudflare:workers";
import { requireSuperAdmin, sameOrigin } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { METRO_BLOCK_KEYS, METRO_BLOCK_PROJECT_ID, metroBlockKey } from "@/app/metro-blocks";

export const dynamic = "force-dynamic";
const PROJECT = METRO_BLOCK_PROJECT_ID;
const denied = () => Response.json({error:"Super Admin access required"}, {status:403});
const json = (value: unknown, status=200) => Response.json(value, {status,headers:{"cache-control":"no-store"}});

type PlotRow = {id:string;sqft:number;dimensions:string;status:string};
type BlockAsset = {blockKey:string;draftObjectKey:string;draftWidth:number;draftHeight:number;draftFilename:string;northAngle:number;publishedObjectKey:string;publishedVersion:number};
type BlockMap = {plotId:string;blockKey:string;polygon:string};
const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9 -]{0,79}$/;
function suggestedBlock(id: string) {
  return /^B[-\s]?\d+$/i.test(id) ? "b" : /^C[-\s]?\d+$/i.test(id) ? "c" : /^(?:A[-\s]?)?\d+$/i.test(id) ? "a" : null;
}
function normalizePolygon(raw: unknown) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 80) return null;
  const pts = raw.map(p => Array.isArray(p) && p.length===2 ? [Number(p[0]),Number(p[1])] : null);
  if (pts.some(p=>!p || p.some(n=>!Number.isFinite(n)||n<0||n>1))) return null;
  const v=pts as number[][];
  let area=0;
  for (let i=0;i<v.length;i++){const a=v[i],b=v[(i+1)%v.length];area+=a[0]*b[1]-b[0]*a[1];}
  if (Math.abs(area) < 0.0000001) return null;
  // Reject all non-adjacent intersections; no self-intersecting published geometry.
  const orient=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<v.length;i++)for(let j=i+1;j<v.length;j++){
    if(j===i+1||(i===0&&j===v.length-1))continue;
    const a=v[i],b=v[(i+1)%v.length],c=v[j],d=v[(j+1)%v.length];
    const x1=orient(a,b,c),x2=orient(a,b,d),y1=orient(c,d,a),y2=orient(c,d,b);
    if(x1*x2<0&&y1*y2<0)return null;
  }
  return JSON.stringify(v.map(p=>p.map(n=>Number(n.toFixed(7)))));
}
async function ensureMetro() {
  return !!await env.DB.prepare("SELECT 1 FROM projects WHERE id=? AND slug='metro-city-c024a5' AND name='Metro City' AND status='active' LIMIT 1")
    .bind(PROJECT).first();
}
async function load() {
  const [plots,assets,maps,state] = await Promise.all([
    env.DB.prepare("SELECT id,sqft,dimensions,status FROM plots WHERE project_id=? AND inventory_active=1 ORDER BY id").bind(PROJECT).all<PlotRow>(),
    env.DB.prepare("SELECT block_key AS blockKey,draft_object_key AS draftObjectKey,draft_width AS draftWidth,draft_height AS draftHeight,draft_filename AS draftFilename,draft_north_angle AS northAngle,published_object_key AS publishedObjectKey,published_version AS publishedVersion FROM metro_block_assets WHERE project_id=? ORDER BY block_key").bind(PROJECT).all<BlockAsset>(),
    env.DB.prepare("SELECT plot_id AS plotId,block_key AS blockKey,polygon FROM metro_block_plot_maps WHERE project_id=? ORDER BY plot_id").bind(PROJECT).all<BlockMap>(),
    env.DB.prepare("SELECT public_enabled AS enabled,version FROM metro_block_state WHERE project_id=?").bind(PROJECT).first<{enabled:number;version:number}>(),
  ]);
  return {plots:plots.results,assets:assets.results,maps:maps.results,state:state||{enabled:0,version:0}};
}
export async function GET() {
  const actor=await requireSuperAdmin();
  if(!actor)return denied();
  if(!await ensureMetro())return json({error:"Metro City unavailable"},404);
  return json(await load());
}
export async function POST(request:Request) {
  const actor=await requireSuperAdmin();
  if(!actor)return denied();
  if(!sameOrigin(request))return json({error:"Invalid request origin"},403);
  if(!await ensureMetro())return json({error:"Metro City unavailable"},404);
  if((request.headers.get("content-type")||"").includes("multipart/form-data")) {
    const form=await request.formData();
    const block=metroBlockKey(form.get("block"));
    const file=form.get("file");
    const width=Number(form.get("width")),height=Number(form.get("height"));
    if(!block||!(file instanceof File)||!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<1000||file.size>20*1024*1024||!Number.isInteger(width)||!Number.isInteger(height)||width<100||height<100||width>12000||height>12000)
      return json({error:"Valid JPEG/PNG/WebP and measured image width/height required (max 20MB)"},400);
    const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const isPng=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    const isWebp=String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
    if(!((file.type==="image/jpeg"&&isJpeg)||(file.type==="image/png"&&isPng)||(file.type==="image/webp"&&isWebp)))
      return json({error:"Image signature/type mismatch"},400);
    const key=`projects/${PROJECT}/metro-blocks/draft/${block}/${crypto.randomUUID()}`;
    await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
    const now=new Date().toISOString();
    // Changing image geometry must invalidate only this block's EDITABLE draft polygons.
    // Immutable published snapshots and the shared plots table are untouched.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO metro_block_assets (project_id,block_key,draft_object_key,draft_width,draft_height,draft_filename,draft_north_angle,updated_at) VALUES (?,?,?,?,?,?,0,?) ON CONFLICT(project_id,block_key) DO UPDATE SET draft_object_key=excluded.draft_object_key,draft_width=excluded.draft_width,draft_height=excluded.draft_height,draft_filename=excluded.draft_filename,draft_north_angle=0,updated_at=excluded.updated_at").bind(PROJECT,block,key,width,height,file.name.slice(0,200),now),
      env.DB.prepare("UPDATE metro_block_plot_maps SET polygon='',updated_at=? WHERE project_id=? AND block_key=?").bind(now,PROJECT,block),
    ]);
    await writeAudit(actor,"metro.block_image_draft_uploaded",PROJECT,block,{width,height,size:file.size,draftPolygonsReset:true});
    return json({ok:true,block,width,height});
  }
  const body=await request.json().catch(()=>null) as null|{action?:string;block?:string;plotId?:string;polygon?:unknown;expectedVersion?:number;confirmation?:string};
  if(!body||!body.action)return json({error:"Action required"},400);
  const now=new Date().toISOString();
  if(body.action==="initialize") {
    const d=await load();
    if(d.maps.length)return json({error:"Draft mapping already initialized; no automatic overwrite allowed"},409);
    if(!d.plots.length)return json({error:"No active plots"},409);
    const unknown=d.plots.filter(p=>!suggestedBlock(p.id));
    if(unknown.length)return json({error:"Some plots need explicit block assignment",unknown:unknown.map(p=>p.id).slice(0,100)},409);
    // One set-based statement instead of 700+ per-plot D1 queries.
    // All existing plot IDs are validated above before any insertion.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO metro_block_state (project_id,public_enabled,version,updated_at) VALUES (?,0,0,?)").bind(PROJECT,now),
      env.DB.prepare("INSERT INTO metro_block_plot_maps (project_id,plot_id,block_key,polygon,updated_at) SELECT project_id,id,CASE WHEN UPPER(id) LIKE 'B-%' OR UPPER(id) GLOB 'B[0-9]*' THEN 'b' WHEN UPPER(id) LIKE 'C-%' OR UPPER(id) GLOB 'C[0-9]*' THEN 'c' ELSE 'a' END,'',? FROM plots WHERE project_id=? AND inventory_active=1").bind(now,PROJECT),
    ]);
    await writeAudit(actor,"metro.block_draft_initialized",PROJECT,null,{plots:d.plots.length,geometryPreserved:true});
    return json({ok:true,plots:d.plots.length});
  }
  if(body.action==="calibrate") {
    const block=metroBlockKey(body.block);
    const angle=Number((body as {angle?:number}).angle);
    if(!block||!Number.isFinite(angle)||angle<0||angle>=360)return json({error:"North angle must be between 0 and 359.999 degrees"},400);
    await env.DB.prepare("UPDATE metro_block_assets SET draft_north_angle=?,updated_at=? WHERE project_id=? AND block_key=?").bind(angle,now,PROJECT,block).run();
    await writeAudit(actor,"metro.block_north_calibrated",PROJECT,block,{angle});
    return json({ok:true,block,angle});
  }
  if(body.action==="map"||body.action==="move") {
    const block=metroBlockKey(body.block);
    const plotId=String(body.plotId||"").trim();
    if(!block||!VALID_ID.test(plotId))return json({error:"Block and Plot ID required"},400);
    const existing=await env.DB.prepare("SELECT 1 FROM metro_block_plot_maps WHERE project_id=? AND plot_id=?").bind(PROJECT,plotId).first();
    if(!existing)return json({error:"Initialize and select an active plot first"},409);
    if(body.action==="move") {
      await env.DB.prepare("UPDATE metro_block_plot_maps SET block_key=?,polygon='',updated_at=? WHERE project_id=? AND plot_id=?").bind(block,now,PROJECT,plotId).run();
    } else {
      const polygon=normalizePolygon(body.polygon);
      if(!polygon)return json({error:"Polygon invalid: minimum 3 distinct non-intersecting normalized points required"},400);
      await env.DB.prepare("UPDATE metro_block_plot_maps SET polygon=?,updated_at=? WHERE project_id=? AND plot_id=? AND block_key=?").bind(polygon,now,PROJECT,plotId,block).run();
    }
    await writeAudit(actor,body.action==="move"?"metro.block_plot_moved":"metro.block_polygon_saved",PROJECT,plotId,{block});
    return json({ok:true,plotId,block});
  }
  if(body.action==="publish") {
    if(body.confirmation!=="PUBLISH METRO BLOCKS")return json({error:"Explicit publish confirmation required"},400);
    const d=await load();
    if(Number(body.expectedVersion)!==d.state.version)return json({error:"Draft publish version changed. Refresh first."},409);
    if(d.maps.length!==d.plots.length)return json({error:"All active inventory plots must belong to exactly one block",total:d.plots.length,mapped:d.maps.length},409);
    const active=new Set(d.plots.map(p=>p.id));
    if(d.maps.some(m=>!active.has(m.plotId)||!normalizePolygon(JSON.parse(m.polygon||"null"))))return json({error:"One or more block boundaries missing/invalid"},409);
    if(METRO_BLOCK_KEYS.some(b=>!d.maps.some(m=>m.blockKey===b)))return json({error:"Every block must contain plots"},409);
    if(METRO_BLOCK_KEYS.some(b=>!d.assets.some(a=>a.blockKey===b&&a.draftObjectKey&&a.draftWidth>=100&&a.draftHeight>=100)))return json({error:"Upload all three block masterplans first"},409);
    const version=d.state.version+1;
    const copies=[] as Array<{block:string;key:string;asset:BlockAsset}>;
    for(const block of METRO_BLOCK_KEYS) {
      const asset=d.assets.find(a=>a.blockKey===block)!;
      const source=await env.BUCKET.get(asset.draftObjectKey);
      if(!source)return json({error:`Missing draft image for block ${block}`},409);
      const key=`projects/${PROJECT}/metro-blocks/published/${version}/${block}`;
      await env.BUCKET.put(key,source.body,{httpMetadata:{contentType:source.httpMetadata?.contentType||"image/jpeg"}});
      if(!await env.BUCKET.head(key))return json({error:"Failed to verify published image bytes"},503);
      copies.push({block,key,asset});
    }
    try {
      const stmts=[
        env.DB.prepare("DELETE FROM metro_block_published_maps WHERE project_id=?").bind(PROJECT),
        env.DB.prepare("INSERT INTO metro_block_published_maps(project_id,plot_id,block_key,polygon) SELECT project_id,plot_id,block_key,polygon FROM metro_block_plot_maps WHERE project_id=?").bind(PROJECT),
        ...copies.map(c=>env.DB.prepare("UPDATE metro_block_assets SET published_object_key=?,published_width=?,published_height=?,published_north_angle=?,published_version=? WHERE project_id=? AND block_key=?").bind(c.key,c.asset.draftWidth,c.asset.draftHeight,c.asset.northAngle,version,PROJECT,c.block)),
        env.DB.prepare("UPDATE metro_block_state SET version=?,public_enabled=1,updated_at=? WHERE project_id=? AND version=?").bind(version,now,PROJECT,d.state.version),
      ];
      await env.DB.batch(stmts);
    } catch(error) {
      console.error("Metro block publish transaction failed",error);
      return json({error:"Block publish failed; original live site is unchanged"},409);
    }
    await writeAudit(actor,"metro.blocks_published",PROJECT,null,{version,plotCount:d.maps.length,blocks:3});
    return json({ok:true,version,plots:d.maps.length});
  }
  if(body.action==="disable") {
    if(body.confirmation!=="RESTORE METRO LEGACY")return json({error:"Explicit rollback confirmation required"},400);
    await env.DB.prepare("UPDATE metro_block_state SET public_enabled=0,updated_at=? WHERE project_id=?").bind(now,PROJECT).run();
    await writeAudit(actor,"metro.blocks_legacy_restored",PROJECT,null,{});
    return json({ok:true,legacy:true});
  }
  return json({error:"Unknown action"},400);
}
