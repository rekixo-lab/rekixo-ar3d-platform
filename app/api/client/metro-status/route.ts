import {env} from "cloudflare:workers";
import {sameOrigin,validAdminSession} from "@/modules/auth";
import {writeAudit} from "@/modules/audit";
import {recordAutomaticPlotNotice} from "@/app/project-plot-notices";
import {METRO_AGREEMENT_FIELD,metroAgreementEnabled} from "@/app/metro-agreement";
import {isMetroDisplayStatus,metroDisplayStatus,metroDisplayLabel,metroTarget} from "@/app/metro-status";

const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
type Existing={status:string;agreementValue:string|null;agreementRevision:number|null;activeSaleId:string|null};

// Only Metro City's *public plot stage* is changed here, not its Sale Ledger.
// The builder may mark Registered or Agreement Done for historical/offline deals
// without manufacturing a payment, buyer, legal document, or financial Sale entry.
// Existing active Sales remain protected against downgrades to Available/Booked.
// One guarded D1 transaction changes inventory and agreement flag atomically.
// The guard intentionally fails before writes on stale revision / tenant / Sale.
export async function PATCH(request:Request){
  if(!sameOrigin(request))return reply({error:"Invalid request origin"},403);
  const session=await validAdminSession();
  if(!session||session.role!=="client_admin")return reply({error:"Client Admin access required"},401);
  if(!await metroAgreementEnabled(session.projectId))return reply({error:"Metro City status feature unavailable"},403);
  let body:Record<string,unknown>;
  try{
    const raw=await request.text();
    if(raw.length>1200)throw Error("oversized");
    body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))throw Error("invalid");
  }catch{return reply({error:"Invalid status request"},400)}
  const plotId=typeof body.plotId==="string"?body.plotId.trim():"";
  const target=body.status;
  const expectedStatus=body.expectedStatus;
  const expectedAgreementDone=body.expectedAgreementDone;
  const expectedRevision=body.expectedAgreementRevision;
  if(!plotId||plotId.length>80||!isMetroDisplayStatus(target)||
    !["available","booked","sold"].includes(String(expectedStatus))||
    typeof expectedAgreementDone!=="boolean"||!Number.isSafeInteger(expectedRevision)||
    Number(expectedRevision)<0)return reply({error:"Plot, expected status and revision required"},400);

  const projectId=session.projectId;
  const existing=await env.DB.prepare(
    "SELECT p.status,cv.field_value AS agreementValue,cv.revision AS agreementRevision,"+
    "(SELECT s.id FROM property_sales s WHERE s.project_id=p.project_id AND s.plot_id=p.id AND s.state='active' LIMIT 1) AS activeSaleId "+
    "FROM plots p LEFT JOIN plot_custom_values cv ON cv.project_id=p.project_id AND cv.plot_id=p.id AND cv.field_key=? "+
    "WHERE p.project_id=? AND p.id=? AND p.inventory_active=1 LIMIT 1"
  ).bind(METRO_AGREEMENT_FIELD,projectId,plotId).first<Existing>();
  if(!existing)return reply({error:"Active plot not found"},404);
  const beforeDone=existing.agreementValue==="true";
  const beforeRevision=existing.agreementRevision||0;
  if(existing.status!==expectedStatus||beforeDone!==expectedAgreementDone||beforeRevision!==expectedRevision)
    return reply({error:"Plot status changed in another session. Reload plots.",code:"STALE_METRO_STATUS",currentStatus:existing.status,currentAgreementDone:beforeDone,currentRevision:beforeRevision},409);

  const desired=metroTarget(target);
  if(existing.activeSaleId&&desired.inventoryStatus!=="sold")
    return reply({error:"Active Sale exists. Do not move this plot to Available or Booked.",code:"ACTIVE_SALE_STATUS_PROTECTED"},409);
  if(desired.inventoryStatus===existing.status&&desired.agreementDone===beforeDone)
    return reply({ok:true,plotId,status:target,inventoryStatus:existing.status,
      agreementDone:beforeDone,agreementRevision:beforeRevision,
      activeSaleRecorded:Boolean(existing.activeSaleId)});

  const now=new Date().toISOString();
  // Guard and mutations run in a single SQLite transaction (Cloudflare D1 batch).
  // The guard also rechecks eligibility and revision *inside* that transaction,
  // preventing a Sale or another admin session from racing the two writes.
  const guard=env.DB.prepare(`SELECT CASE WHEN EXISTS(
    SELECT 1 FROM plots p JOIN projects pr ON pr.id=p.project_id
    JOIN project_custom_fields f ON f.project_id=p.project_id
    WHERE p.project_id=? AND p.id=? AND p.inventory_active=1 AND p.status=?
    AND pr.slug='metro-city-c024a5' AND pr.name='Metro City' AND pr.status='active'
    AND f.field_key='agreement_done' AND f.field_type='checkbox' AND f.enabled=1
    AND COALESCE((SELECT revision FROM plot_custom_values
      WHERE project_id=p.project_id AND plot_id=p.id AND field_key='agreement_done'),0)=?
    AND COALESCE((SELECT field_value FROM plot_custom_values
      WHERE project_id=p.project_id AND plot_id=p.id AND field_key='agreement_done'),'false')=?
    AND (?='sold' OR NOT EXISTS(SELECT 1 FROM property_sales s
      WHERE s.project_id=p.project_id AND s.plot_id=p.id AND s.state='active'))
  ) THEN 1 ELSE json('metro-status-conflict') END AS allowed`)
    .bind(projectId,plotId,existing.status,beforeRevision,beforeDone?"true":"false",
      desired.inventoryStatus);
  const statements=[guard];
  if(desired.inventoryStatus!==existing.status){
    statements.push(env.DB.prepare(
      "UPDATE plots SET status=?,updated_at=? WHERE project_id=? AND id=? AND inventory_active=1 AND status=?"
    ).bind(desired.inventoryStatus,now,projectId,plotId,existing.status));
  }
  if(desired.agreementDone!==beforeDone){
    statements.push(env.DB.prepare(
      "INSERT INTO plot_custom_values(project_id,plot_id,field_key,field_value,revision,updated_at,updated_by) "+
      "VALUES(?,?,?,?,1,?,?) ON CONFLICT(project_id,plot_id,field_key) DO UPDATE SET "+
      "field_value=excluded.field_value,revision=plot_custom_values.revision+1,"+
      "updated_at=excluded.updated_at,updated_by=excluded.updated_by"
    ).bind(projectId,plotId,METRO_AGREEMENT_FIELD,desired.agreementDone?"true":"false",now,session.id));
  }
  try{await env.DB.batch(statements)}
  catch(error){
    console.error("Metro status transaction rejected",{plotId,error:String(error)});
    return reply({error:"Plot status or Sale changed. Reload latest plots and try again.",code:"METRO_STATUS_CONFLICT"},409);
  }
  const saved=await env.DB.prepare(
    "SELECT p.status,cv.field_value AS agreementValue,cv.revision AS agreementRevision "+
    "FROM plots p LEFT JOIN plot_custom_values cv ON cv.project_id=p.project_id AND cv.plot_id=p.id AND cv.field_key=? "+
    "WHERE p.project_id=? AND p.id=? AND p.inventory_active=1"
  ).bind(METRO_AGREEMENT_FIELD,projectId,plotId).first<Pick<Existing,"status"|"agreementValue"|"agreementRevision">>();
  if(!saved||saved.status!==desired.inventoryStatus||(saved.agreementValue==="true")!==desired.agreementDone)
    return reply({error:"Status committed, but latest value changed. Reload plots.",code:"METRO_VERIFY_REFRESH"},409);
  const revision=saved.agreementRevision||0;
  try{
    await writeAudit(session,"project.metro_status_updated",projectId,plotId,{
      previousInventory:existing.status,nextInventory:desired.inventoryStatus,
      previousAgreement:beforeDone,nextAgreement:desired.agreementDone,
      activeSaleRecorded:Boolean(existing.activeSaleId),revision});
  }catch{console.error("Metro status saved; audit unavailable",{plotId})}
  try{
    await recordAutomaticPlotNotice(projectId,plotId,"inventory",metroDisplayLabel(target),
      "metro-status:"+plotId+":"+now,session.id,now);
  }catch{console.error("Metro status saved; optional notice unavailable",{plotId})}
  return reply({ok:true,plotId,status:metroDisplayStatus(saved.status,desired.agreementDone),
    inventoryStatus:saved.status,agreementDone:desired.agreementDone,
    agreementRevision:revision,activeSaleRecorded:Boolean(existing.activeSaleId)});
}
