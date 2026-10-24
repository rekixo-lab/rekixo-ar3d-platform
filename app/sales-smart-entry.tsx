"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {displayPlotId} from "./plot-display-id";
import {moneyFromPaise,parseMoneyPaise} from "./sales-accounts-core";
import {hasSaleDraft,localSaleDate,suggestedAgreement,type ExistingBuyer,type SalesPlotChoice} from "./sales-smart-entry-policy";

type Draft={plotId:string;buyerId:string;buyerName:string;buyerMobile:string;buyerAddress:string;agreementAmount:string;saleDate:string;markSold:boolean;expectedPlotStatus:string};
const empty=():Draft=>({plotId:"",buyerId:"",buyerName:"",buyerMobile:"",buyerAddress:"",agreementAmount:"",saleDate:localSaleDate(),markSold:false,expectedPlotStatus:""});
const currency=(paise:number|null)=>paise===null?"Not recorded":moneyFromPaise(paise);
function Field({title,children,optional=false,wide=false}:{title:string;children:React.ReactNode;optional?:boolean;wide?:boolean}){
 return <label className={wide?"sales-field sales-field-wide":"sales-field"}><span>{title}{optional&&<small> · optional</small>}</span>{children}</label>;
}
function PlotPicker({value,onSelect,selected}:{value:string;onSelect:(plot:SalesPlotChoice)=>void;selected:SalesPlotChoice|null}){
 const [open,setOpen]=useState(false),[q,setQ]=useState(""),[items,setItems]=useState<SalesPlotChoice[]>([]),
  [loading,setLoading]=useState(false),[more,setMore]=useState(false),[error,setError]=useState("");
 const wrapper=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!open)return;const onOutside=(e:PointerEvent)=>{if(!wrapper.current?.contains(e.target as Node))setOpen(false)};
  document.addEventListener("pointerdown",onOutside);return()=>document.removeEventListener("pointerdown",onOutside)},[open]);
 useEffect(()=>{if(open)search.current?.focus()},[open]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();let active=true;
  const timer=window.setTimeout(async()=>{
   setLoading(true);setError("");
   try{
    const res=await fetch("/api/client/sales/assist?kind=plots&q="+encodeURIComponent(q.trim()),{cache:"no-store",signal:controller.signal});
    const data=await res.json();if(!res.ok)throw Error(data.error||"Plots unavailable");
    if(active){setItems(data.plots||[]);setMore(Boolean(data.hasMore))}
   }catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Lookup failed")}
   finally{if(active)setLoading(false)}
  },q?160:0);
  return()=>{active=false;window.clearTimeout(timer);controller.abort()}
 },[q,open]);
 return <div className="sales-plot-picker" ref={wrapper} onKeyDown={e=>{if(e.key==="Escape")setOpen(false)}}>
  <button type="button" className="sales-select-trigger" aria-haspopup="listbox" aria-expanded={open}
   aria-label="Select plot or unit" onClick={()=>setOpen(v=>!v)}>
   <span>{value?displayPlotId(value):"Select a project plot / unit"}</span><span aria-hidden="true">⌄</span>
  </button>
  {open&&<div className="sales-picker-menu">
   <input ref={search} aria-label="Search project plot" placeholder="Search Plot 1, B1, C2…" value={q}
    onChange={e=>setQ(e.target.value)}/>
   <div role="listbox" aria-label="Project plots" className="sales-picker-list">
    {loading&&<p className="sales-hint">Loading project plots…</p>}
    {error&&<p role="alert" className="sales-error">{error}</p>}
    {!loading&&!error&&items.map(p=><button role="option" aria-selected={p.id===value} className="sales-picker-option"
      type="button" key={p.id} onClick={()=>{onSelect(p);setOpen(false);setQ("")}}>
      <span><strong>{displayPlotId(p.id)}</strong><small>{Number(p.sqft||0).toLocaleString("en-IN")} sq.ft</small></span>
      <span className={"sales-pill "+p.status}>{p.status}{p.activeSaleId?" · Sale recorded":""}</span>
     </button>)}
    {!loading&&!error&&!items.length&&<p className="sales-hint">No matching active plot.</p>}
    {more&&<p className="sales-hint">More plots available — narrow your search.</p>}
   </div>
  </div>}
  {selected?.activeSaleId&&<p className="sales-error">This plot already has an active Sale. Open it from the Register instead of creating a duplicate.</p>}
 </div>;
}
export default function SalesSmartEntry({onSaved,onBack,onDirty}:{onSaved:(saleId:string)=>Promise<void>;onBack:()=>void;onDirty?:(dirty:boolean)=>void}){
 const [form,setForm]=useState<Draft>(empty);
 const [plot,setPlot]=useState<SalesPlotChoice|null>(null),[stage,setStage]=useState<"edit"|"review">("edit");
 const [buyerSearch,setBuyerSearch]=useState(""),[buyers,setBuyers]=useState<ExistingBuyer[]>([]);
 const [showBuyers,setShowBuyers]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const dirty=hasSaleDraft(form);
 useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false)},[dirty,onDirty]);
 useEffect(()=>{if(!dirty)return;const before=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};
  window.addEventListener("beforeunload",before);return()=>window.removeEventListener("beforeunload",before)},[dirty]);
 useEffect(()=>{
  if(!showBuyers)return;
  const ctrl=new AbortController();let active=true;
  const t=window.setTimeout(async()=>{
   try{
    const res=await fetch("/api/client/sales/assist?kind=buyers&q="+encodeURIComponent(buyerSearch.trim()),{cache:"no-store",signal:ctrl.signal});
    const data=await res.json();if(res.ok&&active)setBuyers(data.buyers||[]);
   }catch{/* retain typed buyer details; user can retry search */}
  },180);
  return()=>{active=false;clearTimeout(t);ctrl.abort()}
 },[buyerSearch,showBuyers]);
 const suggestion=useMemo(()=>suggestedAgreement(plot),[plot]);
 const canReview=Boolean(plot&&!plot.activeSaleId&&form.plotId&&form.buyerName.trim().length>=2&&
  parseMoneyPaise(form.agreementAmount)!==null&&form.saleDate);
 const change=useCallback((key:keyof Draft,value:string|boolean)=>{
  setForm(s=>({...s,[key]:value}));setStage("edit");setError("");
 },[]);
 const selectPlot=(next:SalesPlotChoice)=>{
  setPlot(next);setForm(s=>({...s,plotId:next.id,expectedPlotStatus:next.status,markSold:false,agreementAmount:""}));
  setError("");setStage("edit");
 };
 const chooseBuyer=(buyer:ExistingBuyer)=>{
  setForm(s=>({...s,buyerId:buyer.id,buyerName:buyer.name,buyerMobile:buyer.mobile||"",buyerAddress:buyer.address||""}));
  setShowBuyers(false);setStage("edit");
 };
 const clearBuyer=()=>setForm(s=>({...s,buyerId:"",buyerName:"",buyerMobile:"",buyerAddress:""}));
 function goBack(){
  if(busy)return;
  if(dirty&&!window.confirm("Discard unsaved Sale details?"))return;
  onBack();
 }
 async function submit(){
  if(!canReview||!plot||busy)return;
  setBusy(true);setError("");
  try{
   const res=await fetch("/api/client/sales",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"createSale",...form})});
   const data=await res.json();if(!res.ok)throw Error(data.error||"Sale not saved");
   setForm(empty());setPlot(null);await onSaved(data.saleId);
  }catch(e){setError(e instanceof Error?e.message:"Unable to save. Review plot / buyer.");setStage("edit")}
  finally{setBusy(false)}
 }
 return <section className="sales-entry">
  <div className="sales-section-head">
   <div><h3>New Property Sale</h3><p>Choose the plot, confirm buyer and final sale amount. Nothing is imported as received payment.</p></div>
   <button type="button" className="sales-button sales-button-quiet" onClick={goBack} disabled={busy}>Back to Register</button>
  </div>
  {error&&<div role="alert" className="sales-error-block">{error}</div>}
  {stage==="edit"?<form className="sales-entry-form" onSubmit={e=>{e.preventDefault();if(canReview)setStage("review")}}>
   <div className="sales-form-section">
    <h4><span>01</span> Property details</h4>
    <Field title="Plot / Unit ID" wide><PlotPicker value={form.plotId} selected={plot} onSelect={selectPlot}/></Field>
    {plot&&<div className="sales-plot-summary">
     <div><b>{displayPlotId(plot.id)}</b><span className={"sales-pill "+plot.status}>{plot.status}</span></div>
     <dl>
      <div><dt>Area</dt><dd>{Number(plot.sqft||0).toLocaleString("en-IN")} sq.ft</dd></div>
      <div><dt>Existing plot owner</dt><dd>{plot.ownerName||"Not recorded"}</dd></div>
      <div><dt>Booking reference</dt><dd>{currency(plot.bookingAmountPaise)}</dd></div>
      <div><dt>Broker</dt><dd>{plot.brokerName||"Not recorded"}</dd></div>
     </dl>
     <p>These are existing private plot details, not confirmed buyer information or received payments.</p>
     {plot.activeSaleId&&<p className="sales-error">Existing active sale — use the Sales Register.</p>}
     {!plot.activeSaleId&&plot.status!=="sold"&&<label className="sales-checkbox">
      <input type="checkbox" checked={form.markSold} onChange={e=>change("markSold",e.target.checked)}/>
      Mark this plot Sold when saving this Sale (optional, requires confirmation)
     </label>}
    </div>}
   </div>
   <div className="sales-form-section">
    <h4><span>02</span> Buyer details</h4>
    <div className="sales-buyer-tools">
     {form.buyerId?<><span className="sales-pill available">Existing buyer selected</span><button className="sales-link" type="button" onClick={clearBuyer}>Use new buyer</button></>:
      <button type="button" className="sales-button sales-button-quiet" onClick={()=>setShowBuyers(v=>!v)}>
       {showBuyers?"Close buyer search":"Find existing buyer"}
      </button>}
    </div>
    {showBuyers&&!form.buyerId&&<div className="sales-buyer-search">
     <input aria-label="Search previous buyer" placeholder="Search saved buyer name / mobile" value={buyerSearch} onChange={e=>setBuyerSearch(e.target.value)}/>
     <div className="sales-buyer-list" role="listbox" aria-label="Saved project buyers">
      {buyers.map(b=><button key={b.id} type="button" role="option" aria-selected={false} onClick={()=>chooseBuyer(b)}>
       <b>{b.name}</b><small>{b.mobile||"No mobile"}</small>
      </button>)}
      {!buyers.length&&<small>No saved buyer found; enter a new buyer below.</small>}
     </div>
    </div>}
    <div className="sales-fields">
     <Field title="Buyer Name"><input required autoComplete="name" value={form.buyerName} disabled={Boolean(form.buyerId)}
      maxLength={120} placeholder="Full name" onChange={e=>change("buyerName",e.target.value)}/></Field>
     <Field title="Mobile" optional><input autoComplete="tel" inputMode="tel" maxLength={20} disabled={Boolean(form.buyerId)}
      placeholder="+91 Mobile" value={form.buyerMobile} onChange={e=>change("buyerMobile",e.target.value)}/></Field>
     <Field title="Buyer Address" optional wide><textarea rows={2} maxLength={600} autoComplete="street-address"
      placeholder="Buyer address" disabled={Boolean(form.buyerId)} value={form.buyerAddress} onChange={e=>change("buyerAddress",e.target.value)}/></Field>
    </div>
   </div>
   <div className="sales-form-section">
    <h4><span>03</span> Sale agreement</h4>
    <div className="sales-fields">
     <Field title="Final Sale Amount (₹)">
      <input required inputMode="decimal" placeholder="e.g. 1250000.00" value={form.agreementAmount}
       onChange={e=>change("agreementAmount",e.target.value)}/>
     </Field>
     <Field title="Sale Date"><input required type="date" value={form.saleDate} onChange={e=>change("saleDate",e.target.value)}/></Field>
    </div>
    {plot&&suggestion&&<div className="sales-suggestion">
     <div><b>Suggested asking price: ₹{Number(suggestion).toLocaleString("en-IN")}</b><small>Calculated from the existing project pricing; not a confirmed agreement or paid amount.</small></div>
     <button type="button" className="sales-button sales-button-quiet" onClick={()=>change("agreementAmount",suggestion)}>Use price</button>
    </div>}
   </div>
   <div className="sales-form-actions">
    <p>Booking amount is never auto-counted as a received payment.</p>
    <button type="submit" className="sales-button sales-button-primary" disabled={!canReview||busy}>Review Sale →</button>
   </div>
  </form>:
  <div className="sales-review">
   <h4>04 — Review before saving</h4>
   <dl>
    <div><dt>Property</dt><dd>{displayPlotId(form.plotId)} · {Number(plot?.sqft||0).toLocaleString("en-IN")} sq.ft</dd></div>
    <div><dt>Buyer</dt><dd>{form.buyerName}{form.buyerMobile?" · "+form.buyerMobile:""}</dd></div>
    <div><dt>Agreement amount</dt><dd>{moneyFromPaise(parseMoneyPaise(form.agreementAmount)||0)}</dd></div>
    <div><dt>Sale date</dt><dd>{form.saleDate}</dd></div>
    <div><dt>Plot status</dt><dd>{form.markSold?"Set Sold when saving":"Keep "+plot?.status}</dd></div>
   </dl>
   <p className="sales-hint">This saves a private agreement and buyer. No payment is assumed. The customer site still follows its existing publishing process.</p>
   <div className="sales-form-actions">
    <button type="button" className="sales-button sales-button-quiet" disabled={busy} onClick={()=>setStage("edit")}>Edit Details</button>
    <button type="button" className="sales-button sales-button-primary" disabled={busy} onClick={submit}>
     {busy?"Saving…":"Confirm & Save Sale"}
    </button>
   </div>
  </div>}
 </section>;
}
