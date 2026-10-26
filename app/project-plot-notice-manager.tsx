"use client";
import {useCallback,useEffect,useState} from "react";
type Notice={id:string;eventDate:string;label:string;plotIds:string[];state:string};
type Data={enabled:boolean;notices:Notice[];error?:string};
export default function ProjectPlotNoticeManager({projectId,notify}:{projectId:string;notify:(s:string)=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const load=useCallback(async()=>{
  const r=await fetch("/api/admin/plot-notices?projectId="+encodeURIComponent(projectId),{cache:"no-store"});
  const d=await r.json() as Data;if(!r.ok)throw Error(d.error||"Unavailable");setData(d);
 },[projectId]);
 useEffect(()=>{let live=true;setData(null);setError("");load().catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[load]);
 async function toggle(enabled:boolean){
  setSaving(true);setError("");
  try{
   const r=await fetch("/api/admin/plot-notices",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,action:"enable",enabled})});
   const d=await r.json() as Data;if(!r.ok)throw Error(d.error||"Change failed");
   setData(d);notify("Project notification module updated");
  }catch(e){setError(e instanceof Error?e.message:"Save failed")}finally{setSaving(false)}
 }
 return <section style={{marginTop:17,border:"1px solid #30475e",background:"#101d31",padding:18,borderRadius:14,color:"#eaf5ff"}}>
  <h3 style={{margin:"0 0 8px"}}>Plot Update Notifications</h3>
  <p style={{fontSize:13,color:"#aec4db",lineHeight:1.6}}>Super Admin controls only whether this project has the notification module. The project's <strong>Client Admin</strong> independently creates, approves, publishes, hides and unpublishes dated updates. No Super Admin approval required.</p>
  {error&&<p role="alert" style={{color:"#ffb1bf"}}>{error}</p>}
  {!data?<p>Loading…</p>:<>
   <label style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",fontSize:14}}>
    <input type="checkbox" checked={data.enabled} disabled={saving} onChange={e=>void toggle(e.target.checked)} style={{width:22,height:22}}/>
    Enable customer website updates for this project
   </label>
   <p style={{color:"#9fb5c8",fontSize:12,marginTop:8}}>Private updates remain saved when disabled. Currently {data.notices.filter(n=>n.state==="published").length} published and {data.notices.filter(n=>n.state==="draft").length} draft update(s). Client Admin → Plot Updates is the publishing workspace.</p>
  </>}
 </section>;
}
