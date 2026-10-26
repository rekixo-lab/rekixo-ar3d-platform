// Private project-local workflow configuration: NEVER extend canonical plot.status.
export const ADMIN_FEATURE_KEYS = ["deal_progress","custom_fields"] as const;
export type AdminFeature = (typeof ADMIN_FEATURE_KEYS)[number];
export type FieldType = "text"|"number"|"date"|"select"|"checkbox";
export type DealStage = {slug:string;label:string;sortOrder:number;enabled:boolean;requiresSale:boolean};
export type CustomField = {fieldKey:string;label:string;fieldType:FieldType;choices:string[];sortOrder:number;required:boolean;enabled:boolean};
export const validKey=(v:unknown)=>typeof v==="string"&&/^[a-z][a-z0-9_]{1,47}$/.test(v);
export const validLabel=(v:unknown)=>typeof v==="string"&&v.trim().length>=2&&v.trim().length<=80&&!/[<>]/.test(v);
export function validChoices(input:unknown):string[]|null {
  if(!Array.isArray(input)||input.length>20)return null;
  if(!input.every(v=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=70))return null;
  const result=input.map((v:string)=>v.trim());
  return new Set(result).size===result.length?result:null;
}
export const validDate=(v:unknown):v is string=>{
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const date=new Date(v+"T00:00:00.000Z");
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===v;
};
export function validateCustomValue(field:CustomField,value:unknown):string|null {
  if(typeof value!=="string"||value.length>2000)return null;
  const clean=value.trim();
  if(!clean)return field.required?null:"";
  switch(field.fieldType){
    case "text":return clean.length<=500?clean:null;
    case "number":{if(!/^-?\d{1,12}(?:\.\d{1,4})?$/.test(clean))return null;const n=Number(clean);return Number.isFinite(n)?String(n):null;}
    case "date":return validDate(clean)?clean:null;
    case "checkbox":return ["true","false"].includes(clean)?clean:null;
    case "select":return field.choices.includes(clean)?clean:null;
    default:return null;
  }
}
export const stagesOf=(rows:Array<Record<string,unknown>>):DealStage[]=>rows.map(r=>({
  slug:String(r.slug),label:String(r.label),sortOrder:Number(r.sortOrder),
  enabled:Number(r.enabled)===1,requiresSale:Number(r.requiresSale)===1,
}));
export const fieldsOf=(rows:Array<Record<string,unknown>>):CustomField[]=>rows.map(r=>{
  let choices:unknown=[];
  try{choices=JSON.parse(String(r.choicesJson||"[]"));}catch{}
  return {fieldKey:String(r.fieldKey),label:String(r.label),fieldType:r.fieldType as FieldType,
    choices:validChoices(choices)||[],sortOrder:Number(r.sortOrder),
    enabled:Number(r.enabled)===1,required:Number(r.required)===1};
});
