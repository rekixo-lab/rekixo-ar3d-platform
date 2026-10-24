"use client";
import {useState} from "react";
type Sale={id:string;plotId:string;buyerName:string;buyerMobile:string|null;buyerAddress:string|null;saleDate:string;state:string;revision:number;receivedPaise:number};
type Role="viewer"|"editor"|"approver";
export default function SalesCorrectionsPanel({sale,role,onRefresh,onVoided}:{sale:Sale;role:Role;onRefresh:()=>Promise<void>;onVoided:()=>void}){
 const [name,setName]=useState(sale.buyerName),[mobile,setMobile]=useState(sale.buyerMobile||""),[address,setAddress]=useState(sale.buyerAddress||"");
 const [saleDate,setSaleDate]=useState(sale.saleDate),[reason,setReason]=useState(""),[cancelReason,setCancelReason]=useState("");
 const [confirmation,setConfirmation]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 if(role==="viewer"||sale.state!=="active")return null;
 async function send(action:string,values:Record<string,unknown>){
  setBusy(true);setMessage("");
  try{
   const res=await fetch("/api/client/sales/corrections",{method:"PATCH",headers:{"content-type":"application/json"},
    body:JSON.stringify({action,saleId:sale.id,expectedRevision:sale.revision,...values})});
   const data=await res.json();if(!res.ok)throw Error(data.error||"Correction was not saved");
   setMessage(action==="voidSale"?"Sale cancelled. Its history is preserved.":"Correction saved.");
   if(action==="voidSale")onVoided();else await onRefresh();
  }catch(error){setMessage(error instanceof Error?error.message:"Could not save correction")}
  finally{setBusy(false)}
 }
 return <div className="sales-corrections">
  <details><summary>Edit Buyer Details</summary>
   <form className="sales-inline-form" onSubmit={e=>{e.preventDefault();void send("updateBuyer",{buyerName:name,buyerMobile:mobile,buyerAddress:address,reason})}}>
    <label>Name<input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Mobile<input required maxLength={20} inputMode="tel" value={mobile} onChange={e=>setMobile(e.target.value)}/></label>
    <label>Full Address<textarea required minLength={8} maxLength={600} value={address} onChange={e=>setAddress(e.target.value)}/></label>
    <label>Correction reason<input required minLength={3} maxLength={400} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button className="sales-button sales-button-primary" disabled={busy}>Save Buyer Correction</button>
   </form>
  </details>
  {role==="approver"&&<>
   <details><summary>Correct Sale Date</summary>
    <form className="sales-inline-form" onSubmit={e=>{e.preventDefault();void send("updateSaleDate",{saleDate,reason})}}>
     <label>Sale Date<input type="date" required value={saleDate} onChange={e=>setSaleDate(e.target.value)}/></label>
     <label>Reason<input required minLength={3} maxLength={400} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <button className="sales-button sales-button-primary" disabled={busy}>Correct Date</button>
    </form>
   </details>
   <details className="sales-danger-section"><summary>Cancel Mistaken Sale (Undo)</summary>
    <p>This keeps the history but excludes the cancelled Sale from active finance totals. First reverse any received payments; this is not a bank refund. Plot status remains Sold until you explicitly change it under Plots.</p>
    <form className="sales-inline-form" onSubmit={e=>{e.preventDefault();if(window.confirm("Cancel this Sale? This will preserve accounting history. Plot status stays unchanged."))void send("voidSale",{reason:cancelReason,confirmation})}}>
     <label>Why cancel?<input required minLength={5} maxLength={400} value={cancelReason} onChange={e=>setCancelReason(e.target.value)} placeholder="Test record / wrong sale"/></label>
     <label>Type Plot ID to confirm <strong>{sale.plotId}</strong><input required value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={sale.plotId}/></label>
     <button type="submit" className="sales-button sales-button-danger" disabled={busy||confirmation!==sale.plotId}>Cancel Sale Safely</button>
    </form>
   </details>
  </>}
  {message&&<p role="status" className="sales-hint">{message}</p>}
 </div>
}
