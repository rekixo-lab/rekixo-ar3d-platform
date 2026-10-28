"use client";
import {useEffect,useMemo,useState} from "react";

type Notice={
 id:string;eventDate:string;category:"inventory"|"deal";label:string;plotIds:string[];
 state:"draft"|"published"|"hidden";source:string;createdAt:string
};
type ResponseData={enabled:boolean;notices:Notice[];error?:string};
type View="draft"|"published"|"hidden";
type Group={key:string;eventDate:string;category:Notice["category"];label:string;state:View;
 ids:string[];plotIds:string[];historical:boolean;automatic:boolean};

const istToday=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const natural=(a:string,b:string)=>a.localeCompare(b,"en",{numeric:true,sensitivity:"base"});
const normalized=(label:string)=>label.trim().toLowerCase()==="hold"?"On Hold":label.trim();
const uiInput:React.CSSProperties={width:"100%",minHeight:42,padding:"9px 11px",background:"#091729",border:"1px solid #38536d",borderRadius:9,color:"#eaf6ff",fontSize:13};
const btn:React.CSSProperties={border:0,borderRadius:9,padding:"10px 14px",minHeight:40,fontSize:13,fontWeight:750,cursor:"pointer"};
const card:React.CSSProperties={background:"#13273e",border:"1px solid #2c4965",padding:13,borderRadius:11};
function groupedUpdates(items:Notice[]):Group[]{
 const map=new Map<string,Group>();
 for(const item of items){
  const label=normalized(item.label);
  const key=[item.state,item.eventDate,item.category,label.toLowerCase()].join("|");
  let g=map.get(key);
  if(!g){
   g={key,state:item.state,eventDate:item.eventDate,category:item.category,label,ids:[],plotIds:[],historical:false,automatic:false};
   map.set(key,g);
  }
  g.ids.push(item.id);
  g.plotIds.push(...item.plotIds);
  g.historical ||= item.source==="admin_reference";
  g.automatic ||= item.source==="automatic";
 }
 return [...map.values()].map(g=>({...g,plotIds:[...new Set(g.plotIds)].sort(natural)}))
  .sort((a,b)=>b.eventDate.localeCompare(a.eventDate)||a.label.localeCompare(b.label));
}
function localDate(value:string){
 const d=new Date(value+"T00:00:00Z");
 return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(d):value;
}

export default function ClientPlotNoticeDrafts({notify}:{notify:(message:string)=>void}){
 const [data,setData]=useState<ResponseData|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [view,setView]=useState<View>("draft"),[selected,setSelected]=useState<string[]>([]);
 const [manualOpen,setManualOpen]=useState(false),[eventDate,setEventDate]=useState(istToday);
 const [category,setCategory]=useState<"deal"|"inventory">("deal");
 const [stageLabels,setStageLabels]=useState<string[]>([]);
 const [selectedLabel,setSelectedLabel]=useState("On Hold"),[customLabel,setCustomLabel]=useState(""),[plotText,setPlotText]=useState("");
 const groups=useMemo(()=>groupedUpdates(data?.notices||[]),[data]);
 const visible=groups.filter(g=>g.state===view);
 const drafts=groups.filter(g=>g.state==="draft");
 const counts={draft:drafts.length,published:groups.filter(g=>g.state==="published").length,hidden:groups.filter(g=>g.state==="hidden").length};
 const selectedGroups=drafts.filter(g=>selected.includes(g.key));
 const selectedNoticeIds=selectedGroups.flatMap(g=>g.ids);
 const lastDraftDate=drafts[0]?.eventDate;
 async function refresh(){
  const res=await fetch("/api/client/plot-notices",{cache:"no-store"});
  const next=await res.json() as ResponseData;
  if(!res.ok)throw Error(next.error||"Could not load project updates");
  setData(next);
  setSelected([]);
 }
 useEffect(()=>{let active=true;void refresh().catch(e=>{if(active)setError(e instanceof Error?e.message:String(e))});return()=>{active=false}},[]);
 useEffect(()=>{
  if(!manualOpen)return;
  let active=true;
  fetch("/api/client/deal-progress",{cache:"no-store"}).then(r=>r.ok?r.json():null)
   .then(data=>{
    if(!active||!Array.isArray(data?.stages))return;
    const names=(data.stages as {label:string;enabled:boolean}[])
     .filter(s=>s.enabled&&typeof s.label==="string").map(s=>normalized(s.label));
    setStageLabels([...new Set(names)]);
   }).catch(()=>{});
  return()=>{active=false};
 },[manualOpen]);
 const options=category==="inventory"?["Available","Booked","Sold"]:[...new Set(stageLabels.length?stageLabels:["On Hold","Token Received","Agreement Done","Registered"])];
 function updateCategory(v:"inventory"|"deal"){
  setCategory(v);
  setSelectedLabel(v==="inventory"?"Booked":stageLabels[0]||"On Hold");
  setCustomLabel("");
 }
 async function applyGroupState(ids:string[],state:View){
  if(!ids.length)return;
  setBusy(true);setError("");
  try{
   for(let start=0;start<ids.length;start+=50){
    const chunk=ids.slice(start,start+50);
    const r=await fetch("/api/client/plot-notices",{
     method:"PATCH",headers:{"content-type":"application/json"},
     body:JSON.stringify({ids:chunk,state})
    });
    const result=await r.json() as {error?:string};
    if(!r.ok)throw Error(result.error||"Could not update announcements");
   }
   await refresh();
   if(state==="published")setView("published");
   notify(state==="published"?"Approved updates are now live on the customer website":"Announcements updated");
  }catch(e){
   setError(e instanceof Error?e.message:"Update failed");
   try{await refresh()}catch{}
  }finally{setBusy(false)}
 }
 function toggle(key:string){
  setSelected(previous=>previous.includes(key)?previous.filter(x=>x!==key):[...previous,key]);
 }
 async function saveCustom(e:React.FormEvent){
  e.preventDefault();
  const label=selectedLabel==="__other__"?customLabel.trim():selectedLabel;
  const plotIds=[...new Set(plotText.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean))].sort(natural);
  if(!plotIds.length||!label){setError("Please select a status and at least one plot");return}
  setBusy(true);setError("");
  try{
   const r=await fetch("/api/client/plot-notices",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({eventDate,category,label,plotIds})
   });
   const result=await r.json() as {error?:string};
   if(!r.ok)throw Error(result.error||"Could not save update");
   await refresh();setView("draft");setPlotText("");setManualOpen(false);
   notify("Draft created. Review and Publish when accurate.");
  }catch(e){setError(e instanceof Error?e.message:"Could not save draft")}finally{setBusy(false)}
 }
 if(!data)return <section style={{padding:20,color:"#e8f4ff"}}>{error||"Loading project Plot Updates…"}</section>;
 if(!data.enabled)return null;
 return <section style={{background:"#101e32",border:"1px solid #314b65",borderRadius:15,padding:16,color:"#eaf5ff",minWidth:0}}>
  <header style={{display:"flex",gap:12,justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap"}}>
   <div>
    <h2 style={{margin:"0 0 5px",fontSize:19}}>Plot Updates</h2>
    <p style={{margin:0,color:"#a9bfd8",fontSize:13,lineHeight:1.55}}>
     Plot Status aur Deal Progress save hote hi aaj ki customer-safe update automatic LIVE hogi. Kal purani website notification band ho jayegi; special announcements manual draft rahenge.
    </p>
   </div>
   <span style={{fontSize:11,color:"#6ee2ac",padding:"5px 9px",border:"1px solid #286e54",borderRadius:30}}>Client Admin controls publishing</span>
  </header>
  {error&&<p role="alert" style={{color:"#ffc0c5",background:"#442632",padding:12,borderRadius:8,marginTop:13}}>{error}</p>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:9,margin:"17px 0"}}>
   {([{state:"draft" as const,title:"Ready",count:counts.draft},{state:"published" as const,title:"Published",count:counts.published},{state:"hidden" as const,title:"Hidden",count:counts.hidden}]).map(item=>
    <button type="button" key={item.state} onClick={()=>{setView(item.state);setSelected([])}} aria-pressed={view===item.state}
     style={{...card,color:"#eaf5ff",cursor:"pointer",textAlign:"left",borderColor:view===item.state?"#36d49a":"#2c4965",minWidth:0}}>
     <strong style={{fontSize:22,fontVariantNumeric:"tabular-nums",display:"block"}}>{item.count}</strong>
     <span style={{fontSize:12,color:view===item.state?"#76e6b3":"#a6bbd3"}}>{item.title}</span>
    </button>
   )}
  </div>
  {view==="draft"&&<div style={{display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:9,marginBottom:12}}>
   <div>
    <strong style={{fontSize:14}}>Ready to Publish</strong>
    {lastDraftDate&&<span style={{color:"#9fb8d0",fontSize:12,marginLeft:9}}>Latest: {localDate(lastDraftDate)}</span>}
   </div>
   <button type="button" disabled={busy||selectedNoticeIds.length===0}
    style={{...btn,background:selectedNoticeIds.length?"#3ad3a0":"#345364",color:selectedNoticeIds.length?"#08291d":"#a0b7c9"}}
    onClick={()=>void applyGroupState(selectedNoticeIds,"published")}>
    Publish Selected ({selectedNoticeIds.length})
   </button>
  </div>}
  <div style={{display:"grid",gap:9,maxHeight:500,overflowY:"auto",overscrollBehavior:"contain",paddingRight:2}}>
   {visible.map(group=><article key={group.key} style={card}>
    <div style={{display:"flex",alignItems:"flex-start",gap:11}}>
     {view==="draft"&&<input aria-label={"Select "+group.label+" for "+group.plotIds.join(", ")}
      type="checkbox" checked={selected.includes(group.key)} onChange={()=>toggle(group.key)}
      style={{width:20,height:20,accentColor:"#31d39a",marginTop:2,flexShrink:0}}/>}
     <div style={{minWidth:0,flex:1}}>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
       <strong style={{fontSize:14}}>{group.label}</strong>
       <span style={{fontSize:11,color:"#a8c0d7"}}>{localDate(group.eventDate)}</span>
       {group.automatic&&<span style={{fontSize:10,color:"#66e6b3"}}>AUTO-PUBLISHED</span>}
       {group.state==="published"&&<span style={{fontSize:10,color:"#75e5ac"}}>LIVE</span>}
      </div>
      <div style={{color:"#c5d8eb",fontSize:12,marginTop:5,overflowWrap:"anywhere"}}>
       Plot {group.plotIds.join(", ")}
      </div>
      {group.historical&&<p style={{fontSize:11,color:"#f4c987",margin:"7px 0 0"}}>
       Historical customer example — verify the dated status before publishing.
      </p>}
      {view==="draft"&&<small style={{fontSize:11,color:"#91abc4",display:"block",marginTop:5}}>
       Review once; {group.ids.length>1?group.ids.length+" status changes grouped automatically":"date, type and plot number already filled"}.
      </small>}
     </div>
    </div>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap",marginTop:10}}>
     {view==="draft"&&<button type="button" disabled={busy} style={{...btn,background:"#35d39b",color:"#052c1b"}}
      onClick={()=>void applyGroupState(group.ids,"published")}>Publish</button>}
     {view==="published"&&<button type="button" disabled={busy} style={{...btn,background:"#294259",color:"#e7f2fc"}}
      onClick={()=>void applyGroupState(group.ids,"draft")}>Unpublish</button>}
     {view==="hidden"&&<button type="button" disabled={busy} style={{...btn,background:"#294259",color:"#e7f2fc"}}
      onClick={()=>void applyGroupState(group.ids,"draft")}>Restore Draft</button>}
     {view!=="hidden"&&<button type="button" disabled={busy} style={{...btn,background:"#294259",color:"#e7f2fc"}}
      onClick={()=>void applyGroupState(group.ids,"hidden")}>Hide</button>}
    </div>
   </article>)}
   {!visible.length&&<p style={{...card,fontSize:13,color:"#aec6dc"}}>
    {view==="draft"?"No manual drafts yet. Today's plot status updates publish automatically.":"No "+view+" updates yet."}
   </p>}
  </div>
  <details open={manualOpen} onToggle={e=>setManualOpen(e.currentTarget.open)}
   style={{marginTop:17,borderTop:"1px solid #304963",paddingTop:14}}>
   <summary style={{cursor:"pointer",fontWeight:700,fontSize:13,color:"#b9dbf3"}}>+ Custom Announcement (only when needed)</summary>
   <p style={{fontSize:12,color:"#9fb9d0",margin:"10px 0"}}>For historical or special announcements only. Normal plot status changes are automatically published for the same India date.</p>
   <form onSubmit={saveCustom} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:11,alignItems:"end"}}>
    <label style={{fontSize:12,display:"grid",gap:6}}>Date (India)<input required type="date" value={eventDate} onChange={e=>setEventDate(e.target.value)} style={uiInput}/></label>
    <label style={{fontSize:12,display:"grid",gap:6}}>Category
     <select value={category} onChange={e=>updateCategory(e.target.value as "deal"|"inventory")} style={uiInput}>
      <option value="deal">Deal Progress</option><option value="inventory">Plot Inventory</option>
     </select>
    </label>
    <label style={{fontSize:12,display:"grid",gap:6}}>Status
     <select value={options.includes(selectedLabel)?selectedLabel:"__other__"} onChange={e=>setSelectedLabel(e.target.value)} style={uiInput}>
      {options.map(x=><option value={x} key={x}>{x}</option>)}
      <option value="__other__">Other (custom)</option>
     </select>
    </label>
    {(!options.includes(selectedLabel)||selectedLabel==="__other__")&&<label style={{fontSize:12,display:"grid",gap:6}}>Custom label
     <input required maxLength={70} value={customLabel} onChange={e=>setCustomLabel(e.target.value)} style={uiInput}/>
    </label>}
    <label style={{fontSize:12,display:"grid",gap:6}}>Plot numbers<input required placeholder="18, 48, 231" value={plotText} onChange={e=>setPlotText(e.target.value)} style={uiInput}/></label>
    <button type="submit" disabled={busy} style={{...btn,background:"#35d39b",color:"#082c1d",minHeight:42}}>Create Draft</button>
   </form>
  </details>
  <p style={{fontSize:11,lineHeight:1.6,color:"#91a8bf",margin:"13px 0 0"}}>
   Publishing changes only the dated website announcement, not actual plot availability or Sales &amp; Accounts. Token Received never records a payment.
  </p>
 </section>;
}
