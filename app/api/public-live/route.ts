import { env } from "cloudflare:workers";
import { PROJECT_CONTACT_KEYS, publicProjectId, withProjectContactFallbacks } from "@/modules/projects";
import { publicSiteEnabled, publicSiteUnavailableResponse } from "@/modules/public-site-access";
import {metroAgreementEnabled,metroAgreementValues} from "@/app/metro-agreement";

type StatusRow={id:string;status:string;updatedAt:string|null};
type PricingRow={plotId:string;pricingType:string;unit:string;rate:number|null;fixedPrice:number|null;currency:string};

export async function GET(request:Request){
  const projectId=await publicProjectId(request);
  if(!projectId)return Response.json({error:"Published project nahi mila"},{status:404,headers:{"cache-control":"no-store"}});
  if(!(await publicSiteEnabled(projectId)))return publicSiteUnavailableResponse();

  const contactPlaceholders=PROJECT_CONTACT_KEYS.map(()=>"?").join(",");
  const [statusResult,pricingSetting,contactResult]=await Promise.all([
    env.DB.prepare("SELECT id,status,updated_at AS updatedAt FROM plots WHERE project_id=?").bind(projectId).all<StatusRow>(),
    env.DB.prepare("SELECT value FROM settings WHERE project_id=? AND key='pricingEnabled' LIMIT 1").bind(projectId).first<{value:string}>(),
    env.DB.prepare(`SELECT key,value FROM settings WHERE project_id=? AND key IN (${contactPlaceholders})`).bind(projectId,...PROJECT_CONTACT_KEYS).all<{key:string;value:string}>(),
  ]);
  const metroPublicAgreement=await metroAgreementEnabled(projectId);
  const metroAgreementByPlot=metroPublicAgreement?await metroAgreementValues(projectId):new Map<string,{done:boolean;revision:number}>();
  const pricingEnabled=pricingSetting?.value==="1";
  const pricingResult=pricingEnabled
    ? await env.DB.prepare("SELECT plot_id AS plotId,pricing_type AS pricingType,unit,rate,fixed_price AS fixedPrice,currency FROM plot_pricing WHERE project_id=? ORDER BY plot_id").bind(projectId).all<PricingRow>()
    : {results:[] as PricingRow[]};
  const settings=withProjectContactFallbacks(Object.fromEntries(contactResult.results.map(row=>[row.key,row.value])));
  return Response.json(
    {
      projectId,
      metroAgreementEnabled:metroPublicAgreement,
      statuses:statusResult.results.map(row=>({
        id:row.id,
        status:row.status==="booked"||row.status==="sold"?row.status:"available",
        updatedAt:row.updatedAt,
        ...(metroPublicAgreement?{agreementDone:metroAgreementByPlot.get(row.id)?.done||false}:{}),
      })),
      pricingEnabled,
      pricing:pricingEnabled?pricingResult.results:[],
      settings,
      fetchedAt:new Date().toISOString(),
    },
    {headers:{"cache-control":"no-store","x-rekixo-live-state":"1"}},
  );
}
