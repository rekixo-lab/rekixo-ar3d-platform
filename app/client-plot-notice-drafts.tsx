"use client";
import {useEffect,useState} from "react";
type Notice={id:string;eventDate:string;label:string;plotIds:string[];state:string;source:string};
type Data={enabled:boolean;notices:Notice[];error?:string};
export default function ClientPlotNoticeDrafts({notify}:{notify:(s:string)=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [date,setDate]=useState(new Date().toISOString().slice(0,10)),[category,setCategory]=useState("deal"),[label,setLabel]=useState(""),[plotText,setPlotText]=useState("");
 async function refresh(){
  const r=await fetch("/api/client/plot-notices",{cache:"no-store"});const d=await r.json() as Data;
  if(!r.ok)throw Error(d.error||"Could not load notices");setData(d);
 }
 useEffect(()=>{let active=true;void refresh().catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[]);
 async function changeNoticeState(id:string,state:"published"|"draft"|"hidden"){
  setBusy(true);setError("");
  try{
   const r=await fetch("/api/client/plot-notices",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,state})});
   const d=await r.json() as {error?:string};
   if(!r.ok)throw Error(d.error||"Could not change notice");
   await refresh();notify(state==="published"?"Notice published on the customer masterplan":"Notice updated");
  }catch(e){setError(e instanceof Error?e.message:"Update failed")}finally{setBusy(false)}
 }
 async function save(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");
  try{
   const plotIds=plotText.split(/[,\s]+/).filter(Boolean);
   const r=await fetch("/api/client/plot-notices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({eventDate:date,category,label,plotIds})});
   const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error||"Draft save failed");
   await refresh();setLabel("");setPlotText("");notify("Draft submitted for Super Admin review. Not public yet.");
  }catch(e){setError(e instanceof Error?e.message:"Save failed")}finally{setBusy(false)}
 }
 if(!data?.enabled)return null;
 const input:React.CSSProperties={background:"#081627",border:"1px solid #3a526d",borderRadius:8,padding:"10px",color:"#f3f7fd",width:"100%",minHeight:44};
 return <section style={{marginTop:20,background:"#101d31",border:"1px solid #2d485d",borderRadius:14,padding:16}}>
  <h3 style={{margin:"0 0 8px"}}>Plot Update Announcements</h3>
  <p style={{color:"#b0c7df",fontSize:13}}>Create, review and publish your own dated plot updates. Your Admin controls public announcements; Super Admin does not need to approve them. Only published updates appear on the customer map. Check accuracy before publishing.</p>
  {error&&<p role="alert" style={{color:"#ffabb8"}}>{error}</p>}
  <form onSubmit={save} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,alignItems:"end"}}>
   <label style={{fontSize:12}}>Date<input required type="date" value={date} onChange={e=>setDate(e.target.value)} style={input}/></label>
   <label style={{fontSize:12}}>Category<select value={category} onChange={e=>setCategory(e.target.value)} style={input}><option value="deal">Deal Progress</option><option value="inventory">Plot Inventory</option></select></label>
   <label style={{fontSize:12}}>Update label<input required minLength={2} maxLength={70} value={label} onChange={e=>setLabel(e.target.value)} style={input} placeholder="On Hold"/></label>
   <label style={{fontSize:12}}>Plots (e.g. 18, 48)<input required value={plotText} onChange={e=>setPlotText(e.target.value)} style={input}/></label>
   <button disabled={busy} style={{minHeight:44,background:"#39ce94",border:0,borderRadius:8,fontWeight:700,padding:"10px 15px"}}>Submit draft</button>
  </form>
  <details style={{marginTop:15}}>
   <summary style={{cursor:"pointer"}}>Manage updates · Publish / Hide ({data.notices.length})</summary>
   <div style={{maxHeight:260,overflowY:"auto",paddingTop:9,display:"grid",gap:8}}>
    {data.notices.map(n=><div key={n.id} style={{padding:10,background:"#192b41",borderRadius:7,fontSize:13,display:"grid",gap:8}}>
     <span><strong>{n.eventDate} · {n.label}</strong> · Plot {n.plotIds.join(", ")} <b style={{color:n.state==="published"?"#69dfa5":"#f0d19c"}}>({n.state})</b></span>
     {n.source==="admin_reference"&&<small style={{color:"#edc890"}}>Historical customer example — please verify these records and their date before publication.</small>}
     <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {n.state!=="published"&&<button type="button" disabled={busy} onClick={()=>void changeNoticeState(n.id,"published")} style={{background:"#35d198",color:"#09241b",padding:"9px 12px",fontWeight:750,border:0,borderRadius:7,minHeight:38}}>Publish</button>}
      {n.state==="published"&&<button type="button" disabled={busy} onClick={()=>void changeNoticeState(n.id,"draft")} style={{background:"#30485e",color:"#eaf4ff",padding:"9px 12px",border:"1px solid #516a83",borderRadius:7,minHeight:38}}>Unpublish</button>}
      {n.state!=="hidden"&&<button type="button" disabled={busy} onClick={()=>void changeNoticeState(n.id,"hidden")} style={{background:"#30485e",color:"#eaf4ff",padding:"9px 12px",border:"1px solid #516a83",borderRadius:7,minHeight:38}}>Hide</button>}
     </div>
   </div>)}
   </div>
  </details>
 </section>;
}
