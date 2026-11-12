import { env } from "cloudflare:workers";
import { METRO_AGREEMENT_PROJECT_ID } from "./metro-agreement";

export const METRO_BLOCK_PROJECT_ID = METRO_AGREEMENT_PROJECT_ID;
export const METRO_BLOCK_SLUG = "metro-city-c024a5";
export const METRO_BLOCK_KEYS = ["a", "b", "c"] as const;
export type MetroBlockKey = (typeof METRO_BLOCK_KEYS)[number];

export function metroBlockKey(raw: unknown): MetroBlockKey | null {
  const key = String(raw || "").toLowerCase();
  return key === "a" || key === "b" || key === "c" ? key : null;
}

export async function metroBlockState(projectId: string) {
  if (projectId !== METRO_BLOCK_PROJECT_ID) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT s.public_enabled AS enabled,s.version,p.slug FROM metro_block_state s JOIN projects p ON p.id=s.project_id WHERE s.project_id=? AND p.slug=? AND p.status='active' AND p.public_status='published' LIMIT 1",
    ).bind(projectId, METRO_BLOCK_SLUG).first<{enabled: number;version: number;slug: string}>();
    return row && row.enabled === 1 && row.version > 0 ? row : null;
  } catch (error) {
    // A migration that has not been applied must never take the legacy public site down.
    console.error("METRO block state unavailable; keeping legacy customer site", error);
    return null;
  }
}

export type MetroPublishedMap = {plotId: string; polygon: string; blockKey: MetroBlockKey};
export type MetroPublishedAsset = {
  objectKey: string; width: number; height: number; version: number; northAngle: number;
};

export async function publishedMetroBlock(projectId: string, block: MetroBlockKey) {
  const state = await metroBlockState(projectId);
  if (!state) return null;
  const asset = await env.DB.prepare(
    "SELECT published_object_key AS objectKey,published_width AS width,published_height AS height,published_version AS version,published_north_angle AS northAngle FROM metro_block_assets WHERE project_id=? AND block_key=?",
  ).bind(projectId, block).first<MetroPublishedAsset>();
  if (!asset || !asset.objectKey || asset.width < 100 || asset.height < 100 || asset.version !== state.version) return null;
  return {state,asset};
}

/** All three blocks are enabled together. Invalid/missing block data fails closed. */
export async function publishedMetroBlockMap(projectId: string, block: MetroBlockKey) {
  const published = await publishedMetroBlock(projectId, block);
  if (!published) return null;
  const rows = await env.DB.prepare(
    "SELECT plot_id AS plotId,polygon,block_key AS blockKey FROM metro_block_published_maps WHERE project_id=? AND block_key=? ORDER BY plot_id",
  ).bind(projectId, block).all<MetroPublishedMap>();
  return {...published,maps:rows.results};
}

/** The original masterplan and all canonical plot data are never touched. */
export async function metroBlockImageResponse(projectId: string, block: MetroBlockKey, request: Request) {
  const published = await publishedMetroBlock(projectId, block);
  if (!published) return new Response("Not found", {status:404});
  const url = new URL(request.url);
  const requestedVersion = url.searchParams.get("bv");
  if (requestedVersion && requestedVersion !== String(published.state.version)) {
    return new Response("Block version changed", {status:409,headers:{"cache-control":"no-store"}});
  }
  const object = await env.BUCKET.get(published.asset.objectKey);
  if (!object) return new Response("Block image unavailable", {status:503,headers:{"cache-control":"no-store"}});
  if (url.searchParams.get("inspect") === "1") {
    return Response.json({original:true,width:published.asset.width,height:published.asset.height,source:"metro-block-published",version:published.state.version},{headers:{"cache-control":"no-store"}});
  }
  return new Response(object.body, {
    headers:{
      "content-type":object.httpMetadata?.contentType || "image/jpeg",
      "cache-control":"public,max-age=300",
      "x-rekixo-metro-block":block,
      "x-rekixo-publish-version":String(published.state.version),
    },
  });
}
