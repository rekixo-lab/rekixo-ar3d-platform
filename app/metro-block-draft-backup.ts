import {env} from "cloudflare:workers";
import {METRO_BLOCK_PROJECT_ID,type MetroBlockKey} from "@/app/metro-blocks";

/**
 * Immutable private R2 checkpoint, scoped to one METRO CITY block. Stores
 * normalized polygons, side bindings, original draft image reference, North
 * calibration, view orientation and revision — never buyer/payment details.
 */
export async function createMetroBlockCheckpoint(
  block:MetroBlockKey,
  reason:"manual"|"before-image-replacement",
  expectedRevision?:number,
){
  const project=METRO_BLOCK_PROJECT_ID;
  const [state,asset,plots]=await Promise.all([
    env.DB.prepare("SELECT draft_revision AS revision FROM metro_block_state WHERE project_id=?")
      .bind(project).first<{revision:number}>(),
    env.DB.prepare(
      "SELECT draft_object_key AS objectKey,draft_filename AS filename,draft_width AS width,draft_height AS height,draft_north_angle AS northAngle,draft_view_rotation AS viewRotation FROM metro_block_assets WHERE project_id=? AND block_key=?"
    ).bind(project,block).first(),
    env.DB.prepare(
      "SELECT plot_id AS plotId,polygon,side_bindings AS sideBindings FROM metro_block_plot_maps WHERE project_id=? AND block_key=? ORDER BY plot_id"
    ).bind(project,block).all(),
  ]);
  if(!state||!asset)return {ok:false as const,error:"Draft state or block image unavailable"};
  if(expectedRevision!==undefined&&state.revision!==expectedRevision)
    return {ok:false as const,error:"Draft changed in another tab. Refresh and retry before replacing image"};
  const stamped=new Date().toISOString();
  const id=crypto.randomUUID();
  const key=`projects/${project}/metro-blocks/private-backups/${block}/${stamped.replaceAll(":","-")}-${id}.json`;
  const mapped=plots.results.filter(p=>Boolean((p as {polygon?:string}).polygon)).length;
  const body=JSON.stringify({schema:"metro-block-draft-backup-v1",projectId:project,block,reason,createdAt:stamped,
    draftRevision:state.revision,asset,maps:plots.results});
  const bytes=new TextEncoder().encode(body);
  await env.BUCKET.put(key,body,{httpMetadata:{contentType:"application/json"}});
  const head=await env.BUCKET.head(key);
  if(!head||head.size!==bytes.byteLength)return {ok:false as const,error:"Private R2 checkpoint byte verification failed; no draft changed"};
  await env.DB.prepare(
    "INSERT INTO metro_block_draft_backups(id,project_id,block_key,object_key,mapped_plots,draft_revision,reason,created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(id,project,block,key,mapped,state.revision,reason,stamped).run();
  return {ok:true as const,id,mapped,draftRevision:state.revision,objectKey:key};
}
