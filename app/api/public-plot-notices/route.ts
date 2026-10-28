import {env} from "cloudflare:workers";
import {publicProjectId} from "@/modules/projects";
import {publicSiteEnabled,publicSiteUnavailableResponse} from "@/modules/public-site-access";
import {indiaDate,parseNoticeRows} from "@/app/project-plot-notices";
export async function GET(req:Request){
 const projectId=await publicProjectId(req);
 if(!projectId)return Response.json({enabled:false,notices:[]},{status:404,headers:{"cache-control":"no-store"}});
 if(!await publicSiteEnabled(projectId))return publicSiteUnavailableResponse();
 const row=await env.DB.prepare("SELECT enabled FROM project_plot_notice_settings WHERE project_id=?").bind(projectId).first<{enabled:number}>();
 if(row?.enabled!==1)return Response.json({enabled:false,notices:[]},{headers:{"cache-control":"no-store"}});
 // Only today's India-date announcements are current. Older published
 // notices remain in the admin audit/history but are not shown to customers.
 const today=indiaDate(new Date().toISOString());
 const found=await env.DB.prepare("SELECT id,event_date AS eventDate,category,label,plot_ids_json AS plotIdsJson,state,source,created_at AS createdAt,published_at AS publishedAt FROM project_plot_notices WHERE project_id=? AND state='published' AND event_date=? ORDER BY updated_at DESC,id DESC LIMIT 2000").bind(projectId,today).all<Record<string,unknown>>();
 const notices=parseNoticeRows(found.results).map(({id,eventDate,category,label,plotIds,publishedAt})=>({id,eventDate,category,label,plotIds,publishedAt}));
 return Response.json({enabled:true,notices},{headers:{"cache-control":"no-store"}});
}
