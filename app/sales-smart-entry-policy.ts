export type SalesPlotChoice={
 id:string;status:string;sqft:number|null;sqm:number|null;sqyd:number|null;
 ownerName:string|null;brokerName:string|null;bookingAmountPaise:number|null;
 pricingType:string|null;unit:string|null;rate:number|null;fixedPrice:number|null;currency:string|null;
 activeSaleId:string|null;
};
export type ExistingBuyer={id:string;name:string;mobile:string|null;address:string|null};
export function localSaleDate(date:Date=new Date()){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(date);
 const get=(kind:string)=>parts.find(p=>p.type===kind)?.value||"";
 return `${get("year")}-${get("month")}-${get("day")}`;
}
export function suggestedAgreement(plot:SalesPlotChoice|null):string|null{
 if(!plot||plot.currency!=="INR")return null;
 let amount:number|null=null;
 if(plot.pricingType==="fixed"&&Number.isFinite(plot.fixedPrice)&&Number(plot.fixedPrice)>0)
  amount=Number(plot.fixedPrice);
 if(plot.pricingType==="rate"&&Number.isFinite(plot.rate)&&Number(plot.rate)>0){
  const area=plot.unit==="sqft"?plot.sqft:plot.unit==="sqm"?plot.sqm:plot.unit==="sqyd"?plot.sqyd:null;
  if(Number.isFinite(area)&&Number(area)>0)amount=Number(plot.rate)*Number(area);
 }
 return amount!==null&&Number.isFinite(amount)&&amount>0&&amount<=1_000_000_000_000
  ?(Math.round(amount*100)/100).toFixed(2):null;
}
export function hasSaleDraft(data:{plotId:string;buyerName:string;buyerMobile:string;buyerAddress:string;agreementAmount:string;buyerId:string}){
 return Boolean(data.plotId||data.buyerName.trim()||data.buyerMobile.trim()||data.buyerAddress.trim()||data.agreementAmount||data.buyerId);
}
