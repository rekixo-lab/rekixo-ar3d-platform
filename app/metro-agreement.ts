import {env} from "cloudflare:workers";

export const METRO_AGREEMENT_PROJECT_ID="c024a562-634d-4e49-b647-43209f6e450b";
export const METRO_AGREEMENT_FIELD="agreement_done";
export const METRO_PUBLIC_BOOKED_LABEL="Registered";

// Feature deliberately requires exact verified tenant identity AND an enabled checkbox field.
// Never rewrite the canonical plots.status or treat "booked" as evidence of registration.
export async function metroAgreementEnabled(projectId:string):Promise<boolean>{
 if(projectId!==METRO_AGREEMENT_PROJECT_ID)return false;
 const found=await env.DB.prepare(
  "SELECT 1 FROM projects p JOIN project_custom_fields f ON f.project_id=p.id "+
  "WHERE p.id=? AND p.slug='metro-city-c024a5' AND p.name='Metro City' AND p.status='active' "+
  "AND f.field_key='agreement_done' AND f.field_type='checkbox' AND f.enabled=1 LIMIT 1"
 ).bind(projectId).first();
 return !!found;
}

export type MetroAgreementRow={plotId:string;value:string;revision:number};
// These queries expose ONLY an opt-in boolean, never private owner, amount, notes or history.
export async function metroAgreementValues(projectId:string){
 const rows=await env.DB.prepare(
  "SELECT c.plot_id AS plotId,c.field_value AS value,c.revision "+
  "FROM plot_custom_values c JOIN plots p ON p.project_id=c.project_id AND p.id=c.plot_id AND p.inventory_active=1 "+
  "WHERE c.project_id=? AND c.field_key='agreement_done'"
 ).bind(projectId).all<MetroAgreementRow>();
 return new Map(rows.results.map(r=>[r.plotId,{done:r.value==="true",revision:r.revision}]));
}
