"use client";
import {useCallback,useEffect,useState} from "react";
import {moneyFromPaise} from "./sales-accounts-core";

type Sale={id:string;plotId:string;buyerName:string;buyerMobile:string|null;buyerAddress:string|null;agreementPaise:number;receivedPaise:number;balancePaise:number;state:string;saleDate:string};
type Payment={id:string;kind:string;amountPaise:number;paidOn:string;method:string;reference:string|null;note:string|null;reversedPaymentId:string|null};
type Detail={sale:Sale;payments:Payment[];installments:{id:string;dueOn:string;amountPaise:number;note:string|null}[];adjustments:{id:string;kind:string;amountPaise:number;note:string}[]};
type Role="viewer"|"editor"|"approver";
const emptyForm={plotId:"",buyerName:"",buyerMobile:"",buyerAddress:"",agreementAmount:"",saleDate:new Date().toISOString().slice(0,10)};
const fmt=(v:number)=>moneyFromPaise(Number(v)||0);
export default function ClientSalesAccounts(){
 const [items,setItems]=useState<Sale[]>([]),[count,setCount]=useState(0),[role,setRole]=useState<Role>("viewer");
 const [query,setQuery]=useState(""),[page,setPage]=useState(0),[selected,setSelected]=useState<Detail|null>(null);
 const [form,setForm]=useState(emptyForm),[mode,setMode]=useState<"register"|"new">("register");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
 const load=useCallback(async()=>{
  const url=new URLSearchParams({limit:"50",offset:String(page*50),q:query.trim()});
  const res=await fetch("/api/client/sales?"+url.toString(),{cache:"no-store"});
  const data=await res.json();
  if(!res.ok)throw Error(data.error||"Sales data unavailable");
  setItems(data.sales||[]);setCount(data.total||0);setRole(data.role||"viewer");
 },[page,query,refresh]);
 useEffect(()=>{let active=true;load().catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[load]);
 async function details(id:string){
  try{
   setError("");const r=await fetch("/api/client/sales?saleId="+encodeURIComponent(id),{cache:"no-store"});
   const data=await r.json();if(!r.ok)throw Error(data.error);setSelected(data);
  }catch(e){setError(e instanceof Error?e.message:"Load failed")}
 }
 async function createSale(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");
  try{
   const r=await fetch("/api/client/sales",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"createSale",...form})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Sale not saved");
   setForm(emptyForm);setMode("register");setPage(0);setRefresh(x=>x+1);await details(d.saleId);
  }catch(err){setError(err instanceof Error?err.message:"Could not save")}finally{setBusy(false)}
 }
 return <section className="card" style={{padding:20,display:"grid",gap:16}}>
  <header style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}>
   <div><p style={{opacity:.65,fontSize:12}}>PRIVATE · PROJECT ACCOUNTING</p><h2>Sales &amp; Accounts</h2><small>{count} sales · {role} access</small></div>
   {role!=="viewer"&&<button type="button" className="primary-btn" onClick={()=>setMode(mode==="new"?"register":"new")}>{mode==="new"?"Back to Register":"New Sale"}</button>}
  </header>
  {error&&<p role="alert" style={{color:"#e77"}}>{error}</p>}
  {mode==="new"?
   <form onSubmit={createSale} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
    {([["plotId","Plot / Unit ID"],["buyerName","Buyer Name"],["buyerMobile","Mobile (optional)"],["buyerAddress","Address (optional)"],["agreementAmount","Agreement Amount (₹)"],["saleDate","Sale Date"]] as const).map(([key,label])=>
      <label key={key} style={{display:"grid",gap:5}}>{label}
       <input required={["plotId","buyerName","agreementAmount","saleDate"].includes(key)} type={key==="saleDate"?"date":"text"} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} maxLength={key==="buyerAddress"?600:120}/>
      </label>)}
    <div style={{alignSelf:"end"}}><button type="submit" disabled={busy}>{busy?"Saving…":"Save Sale"}</button></div>
    <p style={{gridColumn:"1 / -1",fontSize:12,opacity:.75}}>Booking Amount is not imported as a payment. Use Add Payment to record actual money received.</p>
   </form>:
   <>
    <label>Search Sale / Buyer <input value={query} placeholder="Plot 12 / buyer name" onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>
    <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}>
     <thead><tr>{["Plot","Buyer","Sale Price","Received","Balance","Status","Details"].map(h=><th key={h} style={{padding:10}}>{h}</th>)}</tr></thead>
     <tbody>{items.map(s=><tr key={s.id} style={{borderTop:"1px solid #70707033"}}>
       <td style={{padding:10}}>{s.plotId}</td><td>{s.buyerName}</td><td>{fmt(s.agreementPaise)}</td><td>{fmt(s.receivedPaise)}</td>
       <td>{fmt(s.balancePaise)}</td><td>{s.state}</td><td><button onClick={()=>details(s.id)}>Open</button></td>
     </tr>)}</tbody>
    </table></div>
    {!items.length&&<p>No sales recorded for this project.</p>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
     <button disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button>
     <span>Page {page+1} / {Math.max(1,Math.ceil(count/50))}</span>
     <button disabled={(page+1)*50>=count} onClick={()=>setPage(p=>p+1)}>Next</button>
    </div>
   </>
  }
  {selected&&<SaleDetails info={selected} role={role} onClose={()=>setSelected(null)} onRefresh={async()=>{await details(selected.sale.id);setRefresh(n=>n+1)}}/>}
 </section>
}
function SaleDetails({info,role,onClose,onRefresh}:{info:Detail;role:Role;onClose:()=>void;onRefresh:()=>Promise<void>}){
 const {sale}=info;
 return <div style={{border:"1px solid #6b728055",padding:16,borderRadius:12,display:"grid",gap:12}}>
  <header style={{display:"flex",justifyContent:"space-between"}}><b>{sale.plotId} · {sale.buyerName}</b><button onClick={onClose}>Close</button></header>
  <p>{sale.saleDate} · Agreement {fmt(sale.agreementPaise)} · Received {fmt(sale.receivedPaise)} · <b>Due {fmt(sale.balancePaise)}</b></p>
  <div>Buyer: {sale.buyerMobile||"No phone"} · {sale.buyerAddress||"No address"}</div>
  <h3>Payment Ledger</h3>
  {info.payments.length?info.payments.map(p=><div key={p.id}>{p.paidOn}: {p.kind==="reversal"?"Reversal −":"Received +"}{fmt(p.amountPaise)} · {p.method} · {p.reference||"—"}</div>):<p>No payments. Booking amount is not a receipt.</p>}
  <h3>Due Installments</h3>
  {info.installments.map(d=><div key={d.id}>{d.dueOn} · {fmt(d.amountPaise)} {d.note}</div>)}
  {role!=="viewer"&&<PaymentForm saleId={sale.id} canApprove={role==="approver"} onRefresh={onRefresh}/>}
 </div>
}
function PaymentForm({saleId,canApprove,onRefresh}:{saleId:string;canApprove:boolean;onRefresh:()=>Promise<void>}){
 const [amount,setAmount]=useState(""),[method,setMethod]=useState("upi"),[paidOn,setPaidOn]=useState(new Date().toISOString().slice(0,10));
 const [reference,setReference]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function save(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const key=crypto.randomUUID();
   const r=await fetch("/api/client/sales/payments",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"receive",saleId,amount,method,paidOn,reference,idempotencyKey:key})});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Payment failed");
   setAmount("");setReference("");await onRefresh();setMessage("Payment recorded");
  }catch(err){setMessage(err instanceof Error?err.message:"Payment not saved")}finally{setBusy(false)}
 }
 return <form onSubmit={save} style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
  <label>Received ₹<input required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
  <label>Date<input type="date" value={paidOn} onChange={e=>setPaidOn(e.target.value)} required/></label>
  <label>Mode<select value={method} onChange={e=>setMethod(e.target.value)}><option value="upi">UPI</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
  <label>Reference<input value={reference} maxLength={100} onChange={e=>setReference(e.target.value)}/></label>
  <button disabled={busy}>Add Payment</button>
  <span role="status">{message}</span>
  {canApprove&&<small>Corrections and reversals are controlled separately.</small>}
 </form>
}
