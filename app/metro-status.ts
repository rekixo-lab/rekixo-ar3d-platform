/** Metro City public-facing status. Canonical inventory stays three-valued for Sales. */
export type MetroDisplayStatus="available"|"booked"|"registered"|"agreement";
export function metroDisplayStatus(status:string,agreementDone:boolean):MetroDisplayStatus{
  if(agreementDone)return "agreement";
  return status==="sold"?"registered":status==="booked"?"booked":"available";
}
export function metroTarget(status:MetroDisplayStatus){
  return {inventoryStatus:status==="registered"||status==="agreement"?"sold":status,
    agreementDone:status==="agreement"};
}
export function isMetroDisplayStatus(value:unknown):value is MetroDisplayStatus{
  return value==="available"||value==="booked"||value==="registered"||value==="agreement";
}
export function metroDisplayLabel(status:MetroDisplayStatus){
  return status==="registered"?"Registered":status==="agreement"?"Agreement Done":
    status==="booked"?"Booked":"Available";
}
