"use client";
import {useCallback,useEffect,useState} from "react";
type Staff={id:string;name:string;status:string;level:string|null};
export default function SalesControls({projectId,notify}:{projectId:string;notify:(message:string)=>void}){
 const [enabled,setEnabled]=useState(false),[users,setUsers]=useState<Staff[]>([]),[salesCount,setSalesCount]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const load=useCallback(async()=>{
  const r=await fetch("/api/admin/sales-controls?projectId="+encodeURIComponent(projectId),{cache:"no-store"});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Controls unavailable");
  setEnabled(Boolean(d.enabled));setUsers(d.users||[]);setSalesCount(d.salesCount||0);
 },[projectId]);
 useEffect(()=>{load().catch(e=>setError(e.message))},[load]);
 async function update(payload:Record<string,unknown>){
  setBusy(true);setError("");
  try{
   const r=await fetch("/api/admin/sales-controls",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,...payload})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Update failed");
   await load();notify("Sales & Accounts permissions updated");
  }catch(e){setError(e instanceof Error?e.message:"Could not update")}finally{setBusy(false)}
 }
 return <div className="card" style={{padding:20,display:"grid",gap:16}}>
  <header><p style={{fontSize:12,opacity:.7}}>PRIVATE PROJECT FINANCE · SUPER ADMIN</p><h2>Sales & Accounts Controls</h2>
   <p>{salesCount} recorded sale(s). Disabling only hides private access; historic records stay intact.</p>
   <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
    {(["sales","payments","installments","adjustments"] as const).map(kind=>
     <a key={kind} href={"/api/admin/sales-export?projectId="+encodeURIComponent(projectId)+"&kind="+kind} download>Backup {kind}</a>)}
   </div></header>
  {error&&<p role="alert">{error}</p>}
  <label style={{display:"flex",gap:10,alignItems:"center"}}>
   <input type="checkbox" checked={enabled} disabled={busy} onChange={e=>update({action:"toggle",enabled:e.target.checked})}/>
   Enable Sales &amp; Accounts for this project
  </label>
  <p>Grant access separately. No existing user receives financial permissions automatically.</p>
  <div style={{display:"grid",gap:10}}>{users.map(user=><div key={user.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,borderTop:"1px solid #5555",paddingTop:10}}>
   <div><b>{user.name}</b> <small>{user.status}</small></div>
   <select aria-label={"Sales role for "+user.name} disabled={busy||user.status!=="active"} value={user.level||""}
    onChange={e=>update(e.target.value?{action:"grant",userId:user.id,level:e.target.value}:{action:"revoke",userId:user.id})}>
    <option value="">No access</option><option value="viewer">Viewer (read only)</option><option value="editor">Editor (sale + payment)</option><option value="approver">Approver (refund/reversal + corrections)</option>
   </select>
  </div>)}</div>
 </div>
}
