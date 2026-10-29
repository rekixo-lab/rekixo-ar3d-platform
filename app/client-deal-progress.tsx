"use client";
import {useCallback,useEffect,useState} from "react";
import type {CustomField,DealStage} from "./project-admin-studio-policy";

type Plot={id:string;status:string;sqft:number;stageSlug:string|null;holdUntil:string|null;revision:number|null};
type Value={fieldKey:string;value:string;revision:number};
type State={stageSlug:string|null;holdUntil:string|null;note:string;revision:number};
type Event={previousStage:string|null;nextStage:string|null;note:string;holdUntil:string|null;createdAt:string};
type Data={enabled:boolean;features:{dealProgress:boolean;customFields:boolean};stages:DealStage[];fields:CustomField[];plots?:Plot[];plot?:Plot;state?:State;values?:Value[];events?:Event[];offset?:number;hasMore?:boolean;error?:string};
const card:React.CSSProperties={border:"1px solid #30435d",background:"#101d31",borderRadius:14,padding:16,marginBottom:16,minWidth:0};
const label:React.CSSProperties={fontSize:12,color:"#bbcee4",display:"grid",gap:7};
const input:React.CSSProperties={minWidth:0,width:"100%",minHeight:44,color:"#f2f7fc",fontSize:15,background:"#091527",border:"1px solid #38516f",borderRadius:8,padding:"9px 11px"};
const action:React.CSSProperties={minHeight:44,borderRadius:8,border:"1px solid #388e6b",background:"#36d896",color:"#08251b",fontWeight:750,padding:"9px 16px",cursor:"pointer"};
export default function ClientDealProgress({notify,metroAgreementEnabled=false}:{notify:(message:string)=>void;metroAgreementEnabled?:boolean}){
  const [data,setData]=useState<Data|null>(null),[detail,setDetail]=useState<Data|null>(null);
  const [query,setQuery]=useState(""),[submitted,setSubmitted]=useState(""),[offset,setOffset]=useState(0);
  const [selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [stage,setStage]=useState(""),[note,setNote]=useState(""),[holdUntil,setHoldUntil]=useState("");
  const [draftValues,setDraftValues]=useState<Record<string,string>>({});
  const reload=useCallback(async()=>{
    const params=new URLSearchParams({q:submitted,offset:String(offset)});
    const response=await fetch("/api/client/deal-progress?"+params,{cache:"no-store"});
    const next=await response.json() as Data;
    if(!response.ok)throw Error(next.error||"Could not load deal progress");
    setData(next);
  },[submitted,offset]);
  const loadDetail=useCallback(async(plotId:string)=>{
    const response=await fetch("/api/client/deal-progress?plotId="+encodeURIComponent(plotId),{cache:"no-store"});
    const next=await response.json() as Data;
    if(!response.ok)throw Error(next.error||"Could not load plot");
    setDetail(next);setStage(next.state?.stageSlug||"");
    setNote(next.state?.note||"");setHoldUntil(next.state?.holdUntil||"");
    setDraftValues(Object.fromEntries((next.values||[]).map(x=>[x.fieldKey,x.value])));
  },[]);
  useEffect(()=>{setError("");void reload().catch(e=>setError(String(e)))},[reload]);
  useEffect(()=>{if(!selected)return;void loadDetail(selected).catch(e=>setError(String(e)))},[selected,loadDetail]);
  async function write(change:Record<string,unknown>){
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/client/deal-progress",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({plotId:selected,...change})});
      const result=await res.json() as {error?:string};
      if(!res.ok)throw Error(result.error||"Save failed");
      await Promise.all([loadDetail(selected),reload()]);
      notify("Private project workflow saved");
    }catch(e){setError(e instanceof Error?e.message:"Could not save");}
    finally{setBusy(false)}
  }
  const inventoryLabel=(status:string)=>metroAgreementEnabled&&status==="sold"?"Registered":status;
  const stageLabel=(slug:string|null|undefined)=>data?.stages.find(x=>x.slug===slug)?.label||slug||"Not started";
  const current=detail?.state||{stageSlug:"",note:"",holdUntil:null,revision:0};
  const chosen=detail?.stages.find(x=>x.slug===stage);
  const today=new Date().toISOString().slice(0,10);
  return <section style={{color:"#f0f5ff",minWidth:0}}>
    <header style={{...card,borderColor:"#326758"}}>
      <h2 style={{fontSize:22,margin:"0 0 6px"}}>Deal Progress &amp; Project Fields</h2>
      <p style={{color:"#a7bed7",fontSize:13,margin:0,lineHeight:1.65}}>Private builder tracking only. {metroAgreementEnabled?"Metro's four public plot statuses are controlled only in Plot Management.":"Available / Booked / Sold are controlled by Plot Management."} Financial receipts remain under Sales &amp; Accounts.</p>
    </header>
    {error&&<p role="alert" style={{...card,color:"#ffacb9",borderColor:"#854857"}}>{error}</p>}
    {!data?<div style={card}>Loading…</div>:!data.enabled?<div style={card}>This project has no configured Deal Progress or Custom Fields module.</div>:<>
      <form style={{...card,display:"flex",flexWrap:"wrap",gap:10,alignItems:"end"}} onSubmit={e=>{e.preventDefault();setOffset(0);setSubmitted(query)}}>
        <label style={{...label,flex:"1 1 220px"}}>Search plot number<input style={input} placeholder="Plot number…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <button style={action}>Search</button><button type="button" style={{...action,background:"#23354b",color:"#d8e7fb"}} onClick={()=>{setQuery("");setSubmitted("");setOffset(0)}}>Clear</button>
      </form>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,320px),1fr))",gap:14}}>
        <div style={card}>
          <h3 style={{fontSize:16,margin:"0 0 12px"}}>Plots</h3>
          <div style={{maxHeight:480,overflow:"auto",display:"grid",gap:7}}>
            {(data.plots||[]).map(plot=><button type="button" key={plot.id} onClick={()=>setSelected(plot.id)} aria-pressed={selected===plot.id} style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",background:selected===plot.id?"#164436":"#162840",color:"#f0f5ff",border:"1px solid "+(selected===plot.id?"#58dca5":"#304561"),padding:12,textAlign:"left",borderRadius:8,cursor:"pointer"}}>
              <span><strong>{plot.id}</strong><small style={{display:"block",color:"#9eb1cb",marginTop:4}}>{inventoryLabel(plot.status)} · {plot.sqft?.toLocaleString("en-IN")} sqft</small></span>
              <span style={{fontSize:12,textAlign:"right"}}>{stageLabel(plot.stageSlug)}{plot.holdUntil&&plot.holdUntil<today&&plot.stageSlug==="hold"?<small style={{display:"block",color:"#ffbc7b"}}>Hold overdue</small>:null}</span>
            </button>)}
            {!data.plots?.length&&<span style={{color:"#94a8c1"}}>No matching active plots</span>}
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",marginTop:14}}>
            <button type="button" disabled={offset===0} style={{...action,background:"#23354b",color:"#d8e7fb"}} onClick={()=>setOffset(x=>Math.max(0,x-50))}>Previous</button>
            <span style={{fontSize:12,color:"#a0b5cc"}}>{offset+1}–{offset+(data.plots?.length||0)}</span>
            <button type="button" disabled={!data.hasMore} style={{...action,background:"#23354b",color:"#d8e7fb"}} onClick={()=>setOffset(x=>x+50)}>Next</button>
          </div>
        </div>
        <div style={card}>
          {!selected?<p style={{color:"#a7bdd5"}}>Select a plot to manage its private workflow and fields.</p>:!detail||detail.plot?.id!==selected?<p>Loading {selected}…</p>:<>
            <h3 style={{margin:"0 0 5px",fontSize:19}}>Plot {selected}</h3>
            <p style={{color:"#a0b5cc",fontSize:13}}>Inventory: {inventoryLabel(detail.plot.status)} (unchanged)</p>
            {detail.features.dealProgress&&<form onSubmit={e=>{e.preventDefault();void write({action:"stage",stageSlug:stage,holdUntil:stage==="hold"?holdUntil:null,note,expectedRevision:current.revision})}} style={{display:"grid",gap:13,marginTop:16}}>
              <label style={label}>Deal Progress stage<select style={input} value={stage} onChange={e=>{setStage(e.target.value);if(e.target.value!=="hold")setHoldUntil("")}}>
                <option value="">Not started</option>
                {detail.stages.filter(x=>(x.enabled||x.slug===stage)&&(!metroAgreementEnabled||!["agreement_done","registered"].includes(x.slug)||x.slug===stage)).map(x=><option key={x.slug} disabled={!x.enabled||(metroAgreementEnabled&&["agreement_done","registered"].includes(x.slug))} value={x.slug}>{x.label}{metroAgreementEnabled&&["agreement_done","registered"].includes(x.slug)?" (historical — use Plot Management)":x.enabled?"":" (disabled)"}</option>)}
              </select></label>
              {stage==="hold"&&<label style={label}>Optional Hold expiry date<input style={input} type="date" value={holdUntil} onChange={e=>setHoldUntil(e.target.value)}/></label>}
              <label style={label}>Private note<textarea style={{...input,minHeight:84}} value={note} maxLength={600} onChange={e=>setNote(e.target.value)} placeholder="Internal remark (not visible to customer)"/></label>
              {chosen?.requiresSale&&<p style={{fontSize:12,color:"#ffce86",margin:0}}>This stage requires a confirmed active Sale and Sold inventory status. Saving never creates a sale automatically.</p>}
              {stage==="token_received"&&<p style={{fontSize:12,color:"#ffce86",margin:0}}>Token Received here is only a progress label. Record actual money under Sales &amp; Accounts.</p>}
              <button style={action} disabled={busy||(metroAgreementEnabled&&["agreement_done","registered"].includes(stage))}>Save Deal Progress</button>
            </form>}
            {detail.features.customFields&&<div style={{marginTop:22}}>
              <h4 style={{fontSize:16}}>Project-specific fields</h4>
              {detail.fields.filter(x=>x.enabled&&!(metroAgreementEnabled&&(x.fieldKey==="agreement_done"||/agreement[_\s-]*date/i.test(x.fieldKey)||/agreement\s*date/i.test(x.label)))).map(field=>{
                const v=(detail.values||[]).find(x=>x.fieldKey===field.fieldKey);
                const value=draftValues[field.fieldKey]??"";
                const onChange=(s:string)=>setDraftValues(prev=>({...prev,[field.fieldKey]:s}));
                return <form key={field.fieldKey} onSubmit={e=>{e.preventDefault();void write({action:"field",fieldKey:field.fieldKey,value,expectedRevision:v?.revision||0})}} style={{borderTop:"1px solid #30435d",padding:"13px 0",display:"grid",gap:8}}>
                  <label style={label}>{field.label}{field.required?" *":""}
                    {field.fieldType==="select"?<select style={input} value={value} onChange={e=>onChange(e.target.value)}><option value="">Select…</option>{field.choices.map(x=><option key={x} value={x}>{x}</option>)}</select>:
                    field.fieldType==="checkbox"?<select style={input} value={value} onChange={e=>onChange(e.target.value)}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>:
                    <input style={input} type={field.fieldType==="number"?"number":field.fieldType==="date"?"date":"text"} step={field.fieldType==="number"?"any":undefined} maxLength={500} value={value} onChange={e=>onChange(e.target.value)}/>}
                  </label>
                  <button disabled={busy} style={{...action,justifySelf:"start",minHeight:38,fontSize:12}}>Save {field.label}</button>
                </form>;
              })}
            </div>}
            {!!detail.events?.length&&<details style={{marginTop:20}}><summary style={{cursor:"pointer"}}>Recent progress history ({detail.events.length})</summary><ol style={{paddingLeft:20,color:"#b5c8dc",fontSize:12}}>{detail.events.map((item,i)=><li key={i} style={{marginTop:9}}>{item.createdAt?.slice(0,16)} — {stageLabel(item.previousStage)} → {stageLabel(item.nextStage)}{item.note?" · "+item.note:""}</li>)}</ol></details>}
          </>}
        </div>
      </div>
    </>}
  </section>;
}
