/** Private sales core. Amounts are exact paise; never use floats for ledger writes. */
export type SalesLevel = "viewer" | "editor" | "approver";
export type SalesKind = "receipt" | "reversal";
export type SaleSums = { agreementPaise:number; chargesPaise:number; discountsPaise:number; receiptsPaise:number; reversalsPaise:number };
export const MAX_SALES_PAISE = 100_000_000_000_000;
export function parseMoneyPaise(input: unknown, allowZero=false): number | null {
  if(typeof input!=="string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(input.trim())) return null;
  const [rupees,frac=""]=input.trim().split(".");
  const value=Number(rupees)*100+Number(frac.padEnd(2,"0"));
  return Number.isSafeInteger(value) && value<=MAX_SALES_PAISE && (allowZero||value>0)?value:null;
}
export function salesBalance(row:SaleSums) {
  const netSale=row.agreementPaise+row.chargesPaise-row.discountsPaise;
  const received=row.receiptsPaise-row.reversalsPaise;
  return {netSale,received,balance:netSale-received};
}
export function moneyFromPaise(value:number) {return (value/100).toLocaleString("en-IN",{style:"currency",currency:"INR"});}
export function validSaleDate(date:unknown):date is string {
  if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const d=new Date(date+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
}
export function validSalesName(value:unknown, max=120):value is string {
  return typeof value==="string" && value.trim().length>=2 && value.trim().length<=max;
}
export function safeNote(value:unknown,max=400) {return typeof value==="string"?value.trim().slice(0,max):"";}
