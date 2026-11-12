import { env } from "cloudflare:workers";
import { requireSuperAdmin, sameOrigin } from "@/modules/auth";
import { writeAudit } from "@/modules/audit";
import { METRO_BLOCK_KEYS, METRO_BLOCK_PROJECT_ID, metroBlockKey } from "@/app/metro-blocks";
import {previewMetroAssignments,completeMetroAssignments} from "@/app/metro-block-assignment";

export const dynamic = "force-dynamic";
const PROJECT = METRO_BLOCK_PROJECT_ID;
const denied = () => Response.json({error:"Super Admin access required"}, {status:403});
const json = (value: unknown, status=200) => Response.json(value, {status,headers:{"cache-control":"no-store"}});

type PlotRow = {id:string;sqft:number;dimensions:string;status:string};
type BlockAsset = {blockKey:string;draftObjectKey:string;draftWidth:number;draftHeight:number;draftFilename:string;northAngle:number;publishedObjectKey:string;publishedVersion:number};
type BlockMap = {plotId:string;blockKey:string;polygon:string};
// Unusual plot labels are allowed only if they exactly match an existing active plot.
const VALID_ID = /^[^\u0000-\u001f\u007f]{1,80}$/;
function safelyNormalizeSavedPolygon(raw:string) {try{return normalizePolygon(JSON.parse(raw||"null"));}catch{return null}}
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
    env.DB.prepare("SELECT public_enabled AS enabled,version,draft_revision AS draftRevision FROM metro_block_state WHERE project_id=?").bind(PROJECT).first<{enabled:number;version:number;draftRevision:number}>(),
  ]);
  return {plots:plots.results,assets:assets.results,maps:maps.results,
    assignmentPreview:previewMetroAssignments(plots.results),
    state:state||{enabled:0,version:0,draftRevision:0}};
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
      env.DB.prepare("UPDATE metro_block_plot_maps SET polygon='',side_bindings='',updated_at=? WHERE project_id=? AND block_key=?").bind(now,PROJECT,block),
      env.DB.prepare("INSERT OR IGNORE INTO metro_block_state(project_id,public_enabled,version,draft_revision,updated_at) VALUES (?,0,0,0,?)").bind(PROJECT,now),
      env.DB.prepare("UPDATE metro_block_state SET draft_revision=draft_revision+1,updated_at=? WHERE project_id=?").bind(now,PROJECT),
    ]);
    await writeAudit(actor,"metro.block_image_draft_uploaded",PROJECT,block,{width,height,size:file.size,draftPolygonsReset:true});
    return json({ok:true,block,width,height});
  }
  const body=await request.json().catch(()=>null) as null|{action?:string;block?:string;plotId?:string;polygon?:unknown;expectedVersion?:number;expectedDraftRevision?:number;confirmation?:string;assignments?:unknown};
  if(!body||!body.action)return json({error:"Action required"},400);
  const now=new Date().toISOString();
  if(body.action==="initialize") {
    // A rejected assignment never changes the live plots or draft tables.
    const d=await load();
    if(d.maps.length)return json({error:"Draft mapping already initialized; no automatic overwrite allowed"},409);
    if(!d.plots.length)return json({error:"No active plots"},409);
    const result=completeMetroAssignments(d.plots,body.assignments||[]);
    if(!result.ok)return json({error:result.error,unknown:result.unknown,assignmentPreview:d.assignmentPreview},409);
    // Bound, chunked VALUES avoid a large SQLite variable count.
    // D1 batch is transactional; every active ID is assigned exactly once.
    const statements=[
      env.DB.prepare("INSERT OR IGNORE INTO metro_block_state (project_id,public_enabled,version,draft_revision,updated_at) VALUES (?,0,0,0,?)").bind(PROJECT,now),
    ];
    const CHUNK=12; // 12 x 4 = 48 bind parameters / statement
    for(let i=0;i<result.assignments.length;i+=CHUNK){
      const group=result.assignments.slice(i,i+CHUNK);
      const sql="INSERT INTO metro_block_plot_maps (project_id,plot_id,block_key,polygon,side_bindings,updated_at) VALUES "+
        group.map(()=>"(?,?,?,'','',?)").join(",");
      statements.push(env.DB.prepare(sql).bind(...group.flatMap(item=>[PROJECT,item.plotId,item.block,now])));
    }
    statements.push(env.DB.prepare("UPDATE metro_block_state SET draft_revision=draft_revision+1,updated_at=? WHERE project_id=?").bind(now,PROJECT));
    try{
      await env.DB.batch(statements);
    }catch(error){
      console.error("METRO draft assignment transaction rejected",error);
      return json({error:"Draft assignment could not be initialized. No live plots were changed. Refresh and retry."},409);
    }
    try{await writeAudit(actor,"metro.block_draft_initialized",PROJECT,null,{
      plots:result.assignments.length,counts:result.counts,
      explicitlyAssigned:d.assignmentPreview.unknown.length,
      geometryPreserved:true,
    })}catch(error){console.error("METRO draft assignment audit unavailable",error)}
    return json({ok:true,plots:result.assignments.length,counts:result.counts});
  }
  if(body.action==="calibrate") {
    const block=metroBlockKey(body.block);
    const angle=Number((body as {angle?:number}).angle);
    if(!block||!Number.isFinite(angle)||angle<0||angle>=360)return json({error:"North angle must be between 0 and 359.999 degrees"},400);
    if(!await env.DB.prepare("SELECT 1 FROM metro_block_assets WHERE project_id=? AND block_key=? AND draft_object_key<>''").bind(PROJECT,block).first())return json({error:"Upload the block masterplan before setting North"},409);
    await env.DB.batch([
      env.DB.prepare("UPDATE metro_block_assets SET draft_north_angle=?,updated_at=? WHERE project_id=? AND block_key=?").bind(angle,now,PROJECT,block),
      env.DB.prepare("UPDATE metro_block_state SET draft_revision=draft_revision+1,updated_at=? WHERE project_id=?").bind(now,PROJECT),
    ]);
    await writeAudit(actor,"metro.block_north_calibrated",PROJECT,block,{angle});
    return json({ok:true,block,angle});
  }
  if(body.action==="map"||body.action==="move") {
    const block=metroBlockKey(body.block);
    const plotId=String(body.plotId||"").trim();
    if(!block||!VALID_ID.test(plotId))return json({error:"Block and Plot ID required"},400);
    const existing=await env.DB.prepare("SELECT block_key AS blockKey FROM metro_block_plot_maps WHERE project_id=? AND plot_id=?").bind(PROJECT,plotId).first<{blockKey:string}>();
    if(!existing)return json({error:"Initialize and select an active plot first"},409);
    if(body.action==="map"&&existing.blockKey!==block)return json({error:"Plot belongs to a different block; reload mapping"},409);
    if(body.action==="move") {
      await env.DB.batch([
        env.DB.prepare("UPDATE metro_block_plot_maps SET block_key=?,polygon='',side_bindings='',updated_at=? WHERE project_id=? AND plot_id=?").bind(block,now,PROJECT,plotId),
        env.DB.prepare("UPDATE metro_block_state SET draft_revision=draft_revision+1,updated_at=? WHERE project_id=?").bind(now,PROJECT),
      ]);
    } else {
      const polygon=normalizePolygon(body.polygon);
      if(!polygon)return json({error:"Polygon invalid: minimum 3 distinct non-intersecting normalized points required"},400);
      await env.DB.batch([
        env.DB.prepare("UPDATE metro_block_plot_maps SET polygon=?,side_bindings='',updated_at=? WHERE project_id=? AND plot_id=? AND block_key=?").bind(polygon,now,PROJECT,plotId,block),
        env.DB.prepare("UPDATE metro_block_state SET draft_revision=draft_revision+1,updated_at=? WHERE project_id=?").bind(now,PROJECT),
      ]);
    }
    await writeAudit(actor,body.action==="move"?"metro.block_plot_moved":"metro.block_polygon_saved",PROJECT,plotId,{block});
    return json({ok:true,plotId,block});
  }
  if(body.action==="publish") {
    if(body.confirmation!=="PUBLISH METRO BLOCKS")return json({error:"Explicit publish confirmation required"},400);
    const d=await load();
    if(Number(body.expectedVersion)!==d.state.version||Number(body.expectedDraftRevision)!==d.state.draftRevision)return json({error:"Draft changed in another session. Refresh before publishing."},409);
    if(d.maps.length!==d.plots.length)return json({error:"All active inventory plots must belong to exactly one block",total:d.plots.length,mapped:d.maps.length},409);
    const active=new Set(d.plots.map(p=>p.id));
    if(d.maps.some(m=>!active.has(m.plotId)||!safelyNormalizeSavedPolygon(m.polygon)))return json({error:"One or more block boundaries missing/invalid"},409);
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
        env.DB.prepare("INSERT INTO metro_block_published_maps(project_id,plot_id,block_key,polygon,side_bindings) SELECT project_id,plot_id,block_key,polygon,side_bindings FROM metro_block_plot_maps WHERE project_id=?").bind(PROJECT),
        ...copies.map(c=>env.DB.prepare("UPDATE metro_block_assets SET published_object_key=?,published_width=?,published_height=?,published_north_angle=?,published_version=? WHERE project_id=? AND block_key=?").bind(c.key,c.asset.draftWidth,c.asset.draftHeight,c.asset.northAngle,version,PROJECT,c.block)),
        // An out-of-date revision produces CHECK(public_enabled IN (0,1)) failure.
        // D1 batch rolls back every published-map and asset pointer change.
        env.DB.prepare("UPDATE metro_block_state SET public_enabled=CASE WHEN draft_revision=? AND version=? THEN 1 ELSE -1 END,version=?,updated_at=? WHERE project_id=?").bind(d.state.draftRevision,d.state.version,version,now,PROJECT),
      ];
      await env.DB.batch(stmts);
    } catch(error) {
      console.error("Metro block publish transaction failed",error);
      return json({error:"Block publish failed; original live site is unchanged"},409);
    }
    try{await writeAudit(actor,"metro.blocks_published",PROJECT,null,{version,plotCount:d.maps.length,blocks:3})}
    catch(e){console.error("Metro block publish succeeded, optional audit write failed",e)}
    return json({ok:true,version,plots:d.maps.length});
  }
  if(body.action==="disable") {
    if(body.confirmation!=="RESTORE METRO LEGACY")return json({error:"Explicit rollback confirmation required"},400);
    await env.DB.prepare("UPDATE metro_block_state SET public_enabled=0,updated_at=? WHERE project_id=?").bind(now,PROJECT).run();
    try{await writeAudit(actor,"metro.blocks_legacy_restored",PROJECT,null,{})}
    catch(e){console.error("Metro legacy view restored; audit write failed",e)}
    return json({ok:true,legacy:true});
  }
  return json({error:"Unknown action"},400);
}
