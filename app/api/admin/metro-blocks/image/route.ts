import {env} from "cloudflare:workers";
import {requireSuperAdmin} from "@/modules/auth";
import {METRO_BLOCK_PROJECT_ID,metroBlockKey} from "@/app/metro-blocks";
export async function GET(request:Request) {
  if(!await requireSuperAdmin())return new Response("Forbidden",{status:403});
  const block=metroBlockKey(new URL(request.url).searchParams.get("block"));
  if(!block)return new Response("Invalid block",{status:400});
  const row=await env.DB.prepare("SELECT draft_object_key AS objectKey,draft_width AS width,draft_height AS height FROM metro_block_assets WHERE project_id=? AND block_key=?")
    .bind(METRO_BLOCK_PROJECT_ID,block).first<{objectKey:string;width:number;height:number}>();
  if(!row?.objectKey)return new Response("Missing draft image",{status:404});
  if(new URL(request.url).searchParams.get("inspect")==="1")return Response.json({original:true,width:row.width,height:row.height,source:"metro-block-admin-draft"},{headers:{"cache-control":"private,no-store"}});
  const object=await env.BUCKET.get(row.objectKey);
  return object?new Response(object.body,{headers:{"content-type":object.httpMetadata?.contentType||"image/jpeg","cache-control":"private,no-store"}}):new Response("Draft unavailable",{status:404});
}
