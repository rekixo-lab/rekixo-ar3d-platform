"use client";
import {useCallback,useEffect,useState} from "react";
import type {CustomField,DealStage,FieldType} from "./project-admin-studio-policy";

type Configuration={projectId:string;features:{deal_progress:boolean;custom_fields:boolean};stages:DealStage[];fields:CustomField[]};
const initialStage={slug:"",label:"",sortOrder:50,enabled:true,requiresSale:false};
const initialField={fieldKey:"",label:"",fieldType:"text" as FieldType,sortOrder:50,enabled:true,required:false,choices:""};
const panel:React.CSSProperties={background:"#101d31",border:"1px solid #2b405c",borderRadius:14,padding:20,marginBottom:16};
const input:React.CSSProperties={background:"#091629",color:"#f1f5fc",border:"1px solid #3a526d",borderRadius:8,minHeight:43,padding:"8px 12px",width:"100%",fontSize:14};
const button:React.CSSProperties={border:"1px solid #31644f",borderRadius:8,padding:"10px 16px",minHeight:42,color:"#08291d",background:"#4de0a0",fontWeight:750,cursor:"pointer"};
const label:React.CSSProperties={display:"grid",gap:6,minWidth:0,fontSize:13,color:"#bfcee1"};
const grid:React.CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:12,marginTop:14};
export default function ProjectAdminStudioManager({projectId,notify}:{projectId:string;notify:(message:string)=>void}){
  const [config,setConfig]=useState<Configuration|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [stage,setStage]=useState(initialStage),[field,setField]=useState(initialField);
  const [error,setError]=useState("");
  const reload=useCallback(async()=>{
    const r=await fetch("/api/admin/project-admin-studio?projectId="+encodeURIComponent(projectId),{cache:"no-store"});
    const data=await r.json() as Configuration&{error?:string};
    if(!r.ok)throw Error(data.error||"Could not read configuration");
    setConfig(data);
  },[projectId]);
  useEffect(()=>{let active=true;setLoading(true);setConfig(null);reload().catch(e=>{if(active)setError(String(e))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[reload]);
  async function submit(changes:Record<string,unknown>){
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/admin/project-admin-studio",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,...changes})});
      const data=await r.json() as Configuration&{error?:string};
      if(!r.ok)throw Error(data.error||"Save failed");
      setConfig(data);notify("Project-specific Admin Studio saved");
      return true;
    }catch(e){setError(e instanceof Error?e.message:"Save failed");return false}
    finally{setBusy(false)}
  }
  if(loading)return <section style={panel}>Loading project Admin Studio…</section>;
  if(!config)return <section style={panel}><p role="alert">{error||"Configuration unavailable"}</p><button style={button} onClick={()=>void reload()}>Retry</button></section>;
  return <div style={{color:"#f0f5ff",maxWidth:1150}}>
    <section style={panel}>
      <h2 style={{fontSize:22,margin:"0 0 6px"}}>Project Admin Studio</h2>
      <p style={{color:"#aabed6",margin:"0 0 16px",lineHeight:1.6}}>Is project ke options hi uske Client Admin me dikhte hain. Available / Booked / Sold, Sales Ledger aur public website alag aur protected hain.</p>
      <div style={grid}>
        {([{key:"deal_progress",title:"Deal Progress",desc:"Hold, Token, Agreement, Registered"},{key:"custom_fields",title:"Custom Plot Fields",desc:"Text, date, number, dropdown and checkbox"}] as const).map(item=>
          <label key={item.key} style={{...panel,margin:0,display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
            <input type="checkbox" checked={config.features[item.key]} disabled={busy} onChange={e=>void submit({action:"feature",feature:item.key,enabled:e.target.checked})} style={{width:22,height:22,flexShrink:0}}/>
            <span><strong>{item.title}</strong><small style={{display:"block",color:"#90a9c4",marginTop:4}}>{item.desc}</small></span>
          </label>
        )}
      </div>
      <p style={{fontSize:12,color:"#9cbed4",marginTop:16}}>Disabling a module hides its UI; no existing project-specific records are deleted.</p>
      <a href={"/api/admin/project-admin-studio/export?projectId="+encodeURIComponent(projectId)} style={{display:"inline-block",padding:"10px 14px",color:"#b7e9ff",textDecoration:"underline"}}>Download project Admin Studio backup (JSON)</a>
    </section>
    {error&&<p role="alert" style={{color:"#ffb6bd",padding:12,border:"1px solid #895462",borderRadius:8}}>{error}</p>}
    {config.features.deal_progress&&<section style={panel}>
      <h3 style={{fontSize:18,margin:0}}>Deal Stages</h3><p style={{color:"#97afc9",fontSize:13}}>Names sirf is project me apply honge. Registered + Require Sale ensures that official sale and Sold status exist first.</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:9,margin:"15px 0"}}>
        {config.stages.map(item=><button key={item.slug} type="button" disabled={busy} onClick={()=>setStage({...item})} style={{...button,background:item.enabled?"#173b39":"#202d43",color:"#e5f5ed",borderColor:item.enabled?"#347f65":"#40546c"}}>{item.label}{item.enabled?"":" (Off)"}</button>)}
      </div>
      <form onSubmit={async e=>{e.preventDefault();const ok=await submit({action:"stage",...stage});if(ok)setStage(initialStage)}}>
        <div style={grid}>
          <label style={label}>Stage key (permanent)<input style={input} pattern="[a-z][a-z0-9_]{1,47}" required value={stage.slug} readOnly={config.stages.some(x=>x.slug===stage.slug)} onChange={e=>setStage({...stage,slug:e.target.value})} placeholder="agreement_done"/></label>
          <label style={label}>Display name<input style={input} maxLength={80} required value={stage.label} onChange={e=>setStage({...stage,label:e.target.value})}/></label>
          <label style={label}>Order<input style={input} type="number" min={0} max={9999} value={stage.sortOrder} onChange={e=>setStage({...stage,sortOrder:Number(e.target.value)})}/></label>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:18,margin:"16px 0"}}>
          <label><input type="checkbox" checked={stage.enabled} onChange={e=>setStage({...stage,enabled:e.target.checked})}/> Enabled</label>
          <label><input type="checkbox" checked={stage.requiresSale} onChange={e=>setStage({...stage,requiresSale:e.target.checked})}/> Require existing active Sale + Sold</label>
        </div>
        <div style={{display:"flex",gap:8}}><button disabled={busy} style={button}>Save stage</button><button type="button" style={{...button,background:"#20344c",color:"#d2e1f3"}} onClick={()=>setStage(initialStage)}>New stage</button></div>
      </form>
    </section>}
    {config.features.custom_fields&&<section style={panel}>
      <h3 style={{fontSize:18,margin:0}}>Custom Plot Fields</h3><p style={{color:"#97afc9",fontSize:13}}>Client ke private forms me naye fields; no custom JavaScript. Keys permanent; fields ko off karne se saved data bachta hai.</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:9,margin:"15px 0"}}>
        {config.fields.map(item=><button type="button" disabled={busy} key={item.fieldKey} onClick={()=>setField({...item,choices:item.choices.join("\n")})} style={{...button,background:item.enabled?"#173b39":"#202d43",color:"#e5f5ed",borderColor:"#347f65"}}>{item.label}{item.enabled?"":" (Off)"}</button>)}
      </div>
      <form onSubmit={async e=>{e.preventDefault();const choices=field.fieldType==="select"?field.choices.split("\n").map(x=>x.trim()).filter(Boolean):[];const ok=await submit({action:"field",...field,choices});if(ok)setField(initialField)}}>
        <div style={grid}>
          <label style={label}>Field key (permanent)<input required style={input} pattern="[a-z][a-z0-9_]{1,47}" value={field.fieldKey} readOnly={config.fields.some(x=>x.fieldKey===field.fieldKey)} onChange={e=>setField({...field,fieldKey:e.target.value})} placeholder="registration_date"/></label>
          <label style={label}>Display label<input style={input} maxLength={80} required value={field.label} onChange={e=>setField({...field,label:e.target.value})}/></label>
          <label style={label}>Field type<select style={input} value={field.fieldType} onChange={e=>setField({...field,fieldType:e.target.value as FieldType})}>{(["text","number","date","select","checkbox"] as const).map(type=><option key={type} value={type}>{type}</option>)}</select></label>
          <label style={label}>Order<input type="number" min={0} max={9999} style={input} value={field.sortOrder} onChange={e=>setField({...field,sortOrder:Number(e.target.value)})}/></label>
          {field.fieldType==="select"&&<label style={label}>Choices (one per line, 2–20)<textarea style={{...input,height:100}} value={field.choices} onChange={e=>setField({...field,choices:e.target.value})}/></label>}
        </div>
        <div style={{display:"flex",gap:18,margin:"16px 0"}}><label><input type="checkbox" checked={field.enabled} onChange={e=>setField({...field,enabled:e.target.checked})}/> Enabled</label><label><input type="checkbox" checked={field.required} onChange={e=>setField({...field,required:e.target.checked})}/> Required</label></div>
        <div style={{display:"flex",gap:8}}><button style={button} disabled={busy}>Save field</button><button type="button" style={{...button,background:"#20344c",color:"#d2e1f3"}} onClick={()=>setField(initialField)}>New field</button></div>
      </form>
    </section>}
  </div>;
}
