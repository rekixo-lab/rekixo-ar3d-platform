"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {moneyFromPaise} from "./sales-accounts-core";
import SalesSmartEntry from "./sales-smart-entry";
import {localSaleDate} from "./sales-smart-entry-policy";

type Sale={id:string;plotId:string;buyerName:string;buyerMobile:string|null;buyerAddress:string|null;agreementPaise:number;receivedPaise:number;balancePaise:number;state:string;saleDate:string};
type Payment={id:string;kind:string;amountPaise:number;paidOn:string;method:string;reference:string|null;note:string|null;reversedPaymentId:string|null};
type Detail={sale:Sale;payments:Payment[];installments:{id:string;dueOn:string;amountPaise:number;note:string|null}[];adjustments:{id:string;kind:string;amountPaise:number;note:string}[]};
type Role="viewer"|"editor"|"approver";
const fmt=(v:number)=>moneyFromPaise(Number(v)||0);
export default function ClientSalesAccounts({onDraftChange,onSaleSaved}:{onDraftChange?:(dirty:boolean)=>void;onSaleSaved?:()=>void}){
 const [items,setItems]=useState<Sale[]>([]),[count,setCount]=useState(0),[role,setRole]=useState<Role>("viewer");
 const [query,setQuery]=useState(""),[page,setPage]=useState(0),[selected,setSelected]=useState<Detail|null>(null);
 const [stats,setStats]=useState<{netSalesPaise:number;receivedPaise:number;outstandingPaise:number;activeSales:number}|null>(null);
 const [mode,setMode]=useState<"register"|"new">("register");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
 const load=useCallback(async()=>{
  const url=new URLSearchParams({limit:"50",offset:String(page*50),q:query.trim()});
  const res=await fetch("/api/client/sales?"+url.toString(),{cache:"no-store"});
  const data=await res.json();
  if(!res.ok)throw Error(data.error||"Sales data unavailable");
  setItems(data.sales||[]);setCount(data.total||0);setRole(data.role||"viewer");
 },[page,query,refresh]);
 useEffect(()=>{let active=true;load().catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[load]);
 useEffect(()=>{let open=true;fetch("/api/client/sales/summary",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(open)setStats(d?.stats||null)}).catch(()=>{});return()=>{open=false}},[refresh]);
 async function details(id:string){
  try{
   setError("");const r=await fetch("/api/client/sales?saleId="+encodeURIComponent(id),{cache:"no-store"});
   const data=await r.json();if(!r.ok)throw Error(data.error);setSelected(data);
  }catch(e){setError(e instanceof Error?e.message:"Load failed")}
 }
 return <section className="card client-sales" style={{padding:20,display:"grid",gap:16}}>
  <header style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}>
   <div><p style={{opacity:.65,fontSize:12}}>PRIVATE · PROJECT ACCOUNTING</p><h2>Sales &amp; Accounts</h2><small>{count} sales · {role} access</small>
    <div className="sales-export-toolbar">
     {(["sales","payments","installments","adjustments"] as const).map(kind=>
       <a key={kind} href={"/api/client/sales/export?kind="+kind} download>Export {kind}</a>)}
    </div>
   </div>
   {role!=="viewer"&&mode==="register"&&<button type="button" className="sales-button sales-button-primary" onClick={()=>setMode("new")}>+ New Sale</button>}
  </header>
  {error&&<p role="alert" style={{color:"#e77"}}>{error}</p>}
  {stats&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(165px,1fr))",gap:10}}>
   {([["Active Sales",stats.activeSales],["Net Sales",fmt(stats.netSalesPaise)],["Received",fmt(stats.receivedPaise)],["Outstanding",fmt(stats.outstandingPaise)]] as const).map(([label,value])=><div key={label} style={{padding:14,border:"1px solid #6b728055",borderRadius:12}}><small>{label}</small><div style={{fontWeight:700,fontSize:20}}>{value}</div></div>)}
  </div>}
  {mode==="new"?<SalesSmartEntry onDirty={onDraftChange} onBack={()=>setMode("register")}
   onSaved={async saleId=>{onSaleSaved?.();setMode("register");setPage(0);setRefresh(n=>n+1);await details(saleId)}}/>:
   <>
    <label className="sales-field sales-search">Search Sale / Buyer <input value={query} placeholder="Plot 12 / buyer name" onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>
    <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}>
     <thead><tr>{["Plot","Buyer","Sale Price","Received","Balance","Status","Details"].map(h=><th key={h} style={{padding:10}}>{h}</th>)}</tr></thead>
     <tbody>{items.map(s=><tr key={s.id} style={{borderTop:"1px solid #70707033"}}>
       <td style={{padding:10}}>{s.plotId}</td><td>{s.buyerName}</td><td>{fmt(s.agreementPaise)}</td><td>{fmt(s.receivedPaise)}</td>
       <td>{fmt(s.balancePaise)}</td><td>{s.state}</td><td><button className="sales-button sales-button-quiet" onClick={()=>details(s.id)}>Open</button></td>
     </tr>)}</tbody>
    </table></div>
    {!items.length&&<p>No sales recorded for this project.</p>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
     <button className="sales-button sales-button-quiet" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button>
     <span>Page {page+1} / {Math.max(1,Math.ceil(count/50))}</span>
     <button className="sales-button sales-button-quiet" disabled={(page+1)*50>=count} onClick={()=>setPage(p=>p+1)}>Next</button>
    </div>
   </>
  }
  {selected&&<SaleDetails info={selected} role={role} onClose={()=>setSelected(null)} onRefresh={async()=>{await details(selected.sale.id);setRefresh(n=>n+1)}}/>}
 </section>
}
function SaleDetails({info,role,onClose,onRefresh}:{info:Detail;role:Role;onClose:()=>void;onRefresh:()=>Promise<void>}){
 const {sale}=info;
 return <div className="sales-ledger" style={{border:"1px solid #6b728055",padding:16,borderRadius:12,display:"grid",gap:12}}>
  <header style={{display:"flex",justifyContent:"space-between"}}><b>{sale.plotId} · {sale.buyerName}</b><button className="sales-button sales-button-quiet" onClick={onClose}>Close</button></header>
  <p>{sale.saleDate} · Agreement {fmt(sale.agreementPaise)} · Received {fmt(sale.receivedPaise)} · <b>Due {fmt(sale.balancePaise)}</b></p>
  <div>Buyer: {sale.buyerMobile||"No phone"} · {sale.buyerAddress||"No address"}</div>
  <h3>Payment Ledger</h3>
  {info.payments.length?info.payments.map(p=><div key={p.id}>{p.paidOn}: {p.kind==="reversal"?"Reversal −":"Received +"}{fmt(p.amountPaise)} · {p.method} · {p.reference||"—"}</div>):<p>No payments. Booking amount is not a receipt.</p>}
  <h3>Due Installments</h3>
  {info.installments.map(d=><div key={d.id}>{d.dueOn} · {fmt(d.amountPaise)} {d.note}</div>)}
  {role!=="viewer"&&<PaymentForm saleId={sale.id} canApprove={role==="approver"} outstanding={Math.max(0,Number(sale.balancePaise)||0)} nextDue={info.installments[0]?.amountPaise||null} onRefresh={onRefresh}/>}
  {role!=="viewer"&&<ScheduleForm saleId={sale.id} onRefresh={onRefresh}/>}
  {role==="approver"&&<ApprovalActions saleId={sale.id} payments={info.payments} onRefresh={onRefresh}/>}
  <DocumentPanel saleId={sale.id} canUpload={role!=="viewer"}/>
  <button type="button" className="sales-button sales-button-quiet" onClick={()=>window.print()}>Print Ledger</button>
 </div>
}
function PaymentForm({saleId,canApprove,outstanding,nextDue,onRefresh}:{saleId:string;canApprove:boolean;outstanding:number;nextDue:number|null;onRefresh:()=>Promise<void>}){
 const [amount,setAmount]=useState(""),[method,setMethod]=useState("upi"),[paidOn,setPaidOn]=useState(localSaleDate());
 const [reference,setReference]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const retryKey=useRef<string|null>(null);
 async function save(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const key=retryKey.current||(retryKey.current=crypto.randomUUID());
   const r=await fetch("/api/client/sales/payments",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"receive",saleId,amount,method,paidOn,reference,idempotencyKey:key})});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Payment failed");
   retryKey.current=null;setAmount("");setReference("");await onRefresh();setMessage("Payment recorded");
  }catch(err){setMessage(err instanceof Error?err.message:"Payment not saved")}finally{setBusy(false)}
 }
 return <form className="sales-inline-form" onSubmit={save}>
  <label>Received ₹<input required inputMode="decimal" placeholder="Payment amount" value={amount} onChange={e=>{retryKey.current=null;setAmount(e.target.value)}}/></label>
  <label>Date<input type="date" value={paidOn} onChange={e=>{retryKey.current=null;setPaidOn(e.target.value)}} required/></label>
  <label>Mode<select value={method} onChange={e=>{retryKey.current=null;setMethod(e.target.value)}}><option value="upi">UPI</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
  <label>Reference<input placeholder="UPI / bank reference (optional)" value={reference} maxLength={100} onChange={e=>{retryKey.current=null;setReference(e.target.value)}}/></label>
  <div className="sales-payment-shortcuts">
   <button type="button" className="sales-button sales-button-quiet" disabled={!outstanding} onClick={()=>{retryKey.current=null;setAmount((outstanding/100).toFixed(2))}}>Full balance · {fmt(outstanding)}</button>
   {nextDue!==null&&<button type="button" className="sales-button sales-button-quiet" onClick={()=>{retryKey.current=null;setAmount((Math.min(outstanding,nextDue)/100).toFixed(2))}}>Scheduled amount (reference)</button>}
  </div>
  <button className="sales-button sales-button-primary" disabled={busy||outstanding<=0}>Add Payment</button>
  <span role="status">{message}</span>
  {canApprove&&<small>Corrections and reversals are controlled separately.</small>}
 </form>
}

function ScheduleForm({saleId,onRefresh}:{saleId:string;onRefresh:()=>Promise<void>}){
 const [amount,setAmount]=useState(""),[dueOn,setDueOn]=useState(""),[note,setNote]=useState(""),[message,setMessage]=useState("");
 async function save(e:React.FormEvent){
  e.preventDefault();
  const res=await fetch("/api/client/sales/adjustments",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({action:"installment",saleId,amount,dueOn,note})});
  const d=await res.json();setMessage(res.ok?"Installment saved":d.error||"Failed");
  if(res.ok){setAmount("");setNote("");await onRefresh()}
 }
 return <form className="sales-inline-form" onSubmit={save}>
  <label>Next Due Date<input type="date" required value={dueOn} onChange={e=>setDueOn(e.target.value)}/></label>
  <label>Due Amount ₹<input value={amount} required onChange={e=>setAmount(e.target.value)}/></label>
  <label>Note<input value={note} onChange={e=>setNote(e.target.value)}/></label>
  <button className="sales-button sales-button-primary">Schedule Installment</button><span role="status">{message}</span>
 </form>
}
function ApprovalActions({saleId,payments,onRefresh}:{saleId:string;payments:Payment[];onRefresh:()=>Promise<void>}){
 const [kind,setKind]=useState("discount"),[amount,setAmount]=useState(""),[reason,setReason]=useState(""),[message,setMessage]=useState("");
 const reversed=new Set(payments.filter(p=>p.reversedPaymentId).map(p=>p.reversedPaymentId));
 const receipts=payments.filter(p=>p.kind==="receipt"&&!reversed.has(p.id));
 async function adjust(e:React.FormEvent){
  e.preventDefault();
  const r=await fetch("/api/client/sales/adjustments",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({action:"adjust",saleId,kind,amount,note:reason})});
  const d=await r.json();setMessage(r.ok?"Adjustment saved":d.error||"Failed");if(r.ok){setAmount("");setReason("");await onRefresh()}
 }
 async function reverse(paymentId:string){
  const reason=window.prompt("Reason for reversing this receipt (minimum 3 characters):");
  if(!reason||reason.trim().length<3)return;
  const r=await fetch("/api/client/sales/payments",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({action:"reverse",saleId,paymentId,reason,idempotencyKey:crypto.randomUUID()})});
  const d=await r.json();setMessage(r.ok?"Receipt reversed":d.error||"Failed");if(r.ok)await onRefresh();
 }
 return <section style={{borderTop:"1px solid #8886",paddingTop:12}}>
  <h3>Approver Controls</h3>
  <form className="sales-inline-form" onSubmit={adjust}>
   <select value={kind} onChange={e=>setKind(e.target.value)}><option value="discount">Discount</option><option value="charge">Charge</option></select>
   <input aria-label="Adjustment amount rupees" placeholder="Amount ₹" required value={amount} onChange={e=>setAmount(e.target.value)}/>
   <input aria-label="Reason" placeholder="Reason required" required minLength={3} value={reason} onChange={e=>setReason(e.target.value)}/>
   <button className="sales-button sales-button-primary">Save Adjustment</button>
  </form>
  <h4>Reverse Recorded Payment</h4>
  {receipts.map(p=><div key={p.id}>{p.paidOn} · {fmt(p.amountPaise)} <button className="sales-button sales-button-quiet" onClick={()=>reverse(p.id)}>Reverse</button></div>)}
  <span role="status">{message}</span>
 </section>
}

function DocumentPanel({saleId,canUpload}:{saleId:string;canUpload:boolean}){
 const [rows,setRows]=useState<{id:string;kind:string;fileName:string;uploadedAt:string}[]>([]);
 const [kind,setKind]=useState("agreement"),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function load(){
  const r=await fetch("/api/client/sales/documents?saleId="+encodeURIComponent(saleId),{cache:"no-store"});
  if(r.ok){const d=await r.json();setRows(d.documents||[])}
 }
 useEffect(()=>{load().catch(()=>{})},[saleId]);
 async function upload(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const formNode=e.currentTarget;setBusy(true);setMessage("");
  try{
   const body=new FormData(formNode);body.set("saleId",saleId);body.set("kind",kind);
   const r=await fetch("/api/client/sales/documents",{method:"POST",body});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Upload failed");
   setMessage("Private document attached");await load();
   formNode.reset();
  }catch(err){setMessage(err instanceof Error?err.message:"Upload failed")}finally{setBusy(false)}
 }
 return <section style={{display:"grid",gap:10}}>
  <h3>Private Sale Documents</h3>
  {rows.map(d=><a key={d.id} href={"/api/client/sales/documents?saleId="+encodeURIComponent(saleId)+"&documentId="+encodeURIComponent(d.id)} download>
    {d.kind} · {d.fileName} · {d.uploadedAt.slice(0,10)}</a>)}
  {!rows.length&&<small>No sale documents uploaded yet.</small>}
  {canUpload&&<form className="sales-inline-form" onSubmit={upload}>
   <select name="kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="agreement">Agreement</option><option value="receipt">Receipt</option><option value="other">Other</option></select>
   <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required/>
   <button className="sales-button sales-button-primary" disabled={busy}>Upload Securely</button><span role="status">{message}</span>
  </form>}
 </section>
}
