"use client";
import {useCallback,useEffect,useMemo,useState,type ChangeEvent} from "react";
import PlotMapper from "@/app/plot-mapper";
type Block="a"|"b"|"c";
type DraftMap={plotId:string;blockKey:Block;polygon:string;sideBindings:string};
type Asset={blockKey:Block;draftObjectKey:string;draftWidth:number;draftHeight:number;draftFilename:string;northAngle:number};
type AssignmentPreview={total:number;autoAssigned:number;unknown:string[];counts:Record<Block,number>};
type Draft={plots:Array<{id:string;sqft:number;dimensions:string;status:string}>;maps:DraftMap[];assets:Asset[];assignmentPreview:AssignmentPreview;state:{enabled:number;version:number;draftRevision:number}};
const projectId="c024a562-634d-4e49-b647-43209f6e450b";
const blocks:Block[]=["a","b","c"];
const baseButton:React.CSSProperties={border:"1px solid #3b5570",borderRadius:9,padding:"10px 13px",color:"#e9f4ff",background:"#1a314d",cursor:"pointer",fontSize:13};
export default function MetroBlockMapper(){
  const [block,setBlock]=useState<Block>("a");
  const [draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [search,setSearch]=useState("");
  const [assignmentSearch,setAssignmentSearch]=useState("");
  const [explicitBlocks,setExplicitBlocks]=useState<Record<string,Block>>({});
  const [refresh,setRefresh]=useState(0);
  const load=useCallback(async()=>{
    const response=await fetch("/api/admin/metro-blocks",{cache:"no-store"});
    if(!response.ok)throw Error("METRO block draft API unavailable.");
    const next=await response.json() as Draft;
    setDraft(next);
  },[]);
  useEffect(()=>{void load().catch(e=>setMessage(String(e)))},[load]);
  async function action(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/admin/metro-blocks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const json=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!json.ok)throw Error(json.error||"Action failed");
      await load();setMessage("Saved successfully");return true;
    }catch(e){setMessage(String(e));return false}
    finally{setBusy(false)}
  }
  const unknown=draft?.assignmentPreview.unknown||[];
  const unresolved=unknown.filter(id=>!explicitBlocks[id]);
  const previewCounts=blocks.reduce((counts,b)=>{
    counts[b]=(draft?.assignmentPreview.counts[b]||0)+unknown.filter(id=>explicitBlocks[id]===b).length;
    return counts;
  },{a:0,b:0,c:0} as Record<Block,number>);
  async function initialize(){
    if(!draft||draft.maps.length||unresolved.length)return;
    if(!window.confirm(
      `Initialize ${draft.plots.length} existing plots? Block A: ${previewCounts.a}, B: ${previewCounts.b}, C: ${previewCounts.c}.\n`+
      `${unknown.length} unusual plot IDs were manually reviewed. This will NOT change live geometry, booking/status or measurements.`
    ))return;
    const assignments=unknown.map(plotId=>({plotId,block:explicitBlocks[plotId]}));
    if(await action({action:"initialize",assignments})){
      setExplicitBlocks({});
      setRefresh(n=>n+1);
    }
  }
  const currentMaps=useMemo(()=>draft?.maps.filter(x=>x.blockKey===block)||[],[block,draft]);
  const mapped=useMemo(()=>currentMaps.filter(x=>{try{const p=JSON.parse(x.polygon);return Array.isArray(p)&&p.length>=3}catch{return false}}).length,[currentMaps]);
  const incomplete=useMemo(()=>draft?.maps.length?draft.maps.filter(x=>!x.polygon).length:0,[draft]);
  const ready=Boolean(draft&&draft.maps.length===draft.plots.length&&draft.plots.length>0&&incomplete===0&&blocks.every(b=>draft.assets.some(a=>a.blockKey===b&&a.draftObjectKey)));
  const asset=draft?.assets.find(x=>x.blockKey===block);
  const allCount=useMemo(()=>Object.fromEntries(blocks.map(b=>[b,{total:draft?.maps.filter(x=>x.blockKey===b).length||0,mapped:draft?.maps.filter(x=>x.blockKey===b&&Boolean(x.polygon)).length||0}])),[draft]);
  const available=useMemo(()=>draft?.maps.filter(x=>x.plotId.toLowerCase().includes(search.trim().toLowerCase())).slice(0,150)||[],[draft,search]);
  async function upload(event:ChangeEvent<HTMLInputElement>){
    const input=event.currentTarget;const file=input.files?.[0];
    if(!file)return;
    let typedConfirmation="";
    if(mapped){
      typedConfirmation=window.prompt(`DANGER: Replacing Block ${block.toUpperCase()} image will CLEAR ${mapped} mapped draft polygons. The server will first create and verify a private R2 recovery checkpoint.\nType REPLACE BLOCK ${block.toUpperCase()} to continue:`,"")||"";
      if(typedConfirmation!==`REPLACE BLOCK ${block.toUpperCase()}`){input.value="";return}
    }
    setBusy(true);setMessage("");
    const url=URL.createObjectURL(file),image=new Image();
    try{
      const loaded=await new Promise<{width:number;height:number}>((resolve,reject)=>{
        image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});
        image.onerror=()=>reject(Error("Invalid image"));image.src=url;
      });
      const form=new FormData();
      form.set("block",block);form.set("file",file);
      form.set("width",String(loaded.width));form.set("height",String(loaded.height));
      form.set("expectedDraftRevision",String(draft?.state.draftRevision??-1));
      if(mapped)form.set("confirmation",typedConfirmation);
      const response=await fetch("/api/admin/metro-blocks",{method:"POST",body:form});
      const data=await response.json() as {ok?:boolean;error?:string;privateBackupId?:string};
      if(!response.ok||!data.ok)throw Error(data.error||"Upload failed");
      await load();setRefresh(n=>n+1);
      setMessage(`Block ${block.toUpperCase()} image uploaded. ${mapped? `Private R2 recovery checkpoint ${data.privateBackupId||"not confirmed"} created BEFORE ${mapped} draft boundaries were cleared.`:"No mapped plots cleared."} Live site unchanged.`);
    }catch(e){setMessage(String(e))}
    finally{URL.revokeObjectURL(url);input.value="";setBusy(false)}
  }
  async function move(plotId:string,target:Block){
    if(draft?.maps.find(x=>x.plotId===plotId)?.polygon){setMessage("This plot is already mapped: download backup and remove its saved boundary before moving blocks.");return}
    if(!window.confirm(`Move plot ${plotId} to Block ${target.toUpperCase()}? Its draft polygon will be cleared. Live project remains unchanged.`))return;
    if(await action({action:"move",plotId,block:target}))setRefresh(n=>n+1);
  }
  async function publish(){
    if(!draft||!ready)return;
    if(!window.confirm(`Publish 3 verified METRO CITY block sites with ${draft.maps.length} polygons? The public main link will become the block selector.`))return;
    const ok=await action({action:"publish",expectedVersion:draft.state.version,expectedDraftRevision:draft.state.draftRevision,confirmation:"PUBLISH METRO BLOCKS"});
    if(ok)setMessage("All three blocks published. Verify public A/B/C pages, plot search and live statuses immediately.");
  }
  async function restore(){
    if(!window.confirm("RESTORE the original METRO CITY customer site? Existing booking/status data and block drafts are retained."))return;
    await action({action:"disable",confirmation:"RESTORE METRO LEGACY"});
  }
  async function createCheckpoint(){
    if(!draft?.maps.length)return;
    setBusy(true);setMessage("");
    try{
      const res=await fetch("/api/admin/metro-blocks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"backup",block})});
      const data=await res.json() as {ok?:boolean;error?:string;backupId?:string;mapped?:number};
      if(!res.ok||!data.ok)throw Error(data.error||"Checkpoint failed");
      setMessage(`Block ${block.toUpperCase()} · ${data.mapped} mapped plots checkpointed to PRIVATE R2 ✓ (ID ${data.backupId}). Draft unchanged.`);
    }catch(e){setMessage(`Backup NOT created: ${String(e)}`)}finally{setBusy(false)}
  }
  async function downloadDraftBackup(){
    try{
      const response=await fetch("/api/admin/metro-blocks",{cache:"no-store"});
      if(!response.ok)throw Error("Server draft reload failed");
      const current=await response.json() as Draft;
      const bundle={format:"metro-city-draft-export-v1",exportedAt:new Date().toISOString(),projectId,block,
        draftRevision:current.state.draftRevision,
        asset:current.assets.find(a=>a.blockKey===block)||null,
        maps:current.maps.filter(m=>m.blockKey===block).map(m=>({plotId:m.plotId,polygon:m.polygon,sideBindings:m.sideBindings}))};
      const blob=new Blob([JSON.stringify(bundle,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a");anchor.href=url;
      anchor.download=`metro-city-block-${block.toUpperCase()}-draft-rev-${current.state.draftRevision}.json`;
      anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage(`Block ${block.toUpperCase()} mapping JSON backup exported. Keep this file private.`);
    }catch(e){setMessage(`Backup download failed: ${String(e)}`)}
  }
  const notify=(msg:string)=>setMessage(msg);
  return <main style={{background:"#070f1b",color:"#edf5ff",minHeight:"100vh",fontFamily:"system-ui,sans-serif",padding:"clamp(10px,2vw,24px)"}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap"}}>
      <div><h1 style={{fontSize:22,fontWeight:800,margin:0}}>METRO CITY · Advanced Block Mapper</h1>
        <p style={{fontSize:13,color:"#aec4db",margin:"5px 0"}}>Original premium Plot Mapper tools · independent block drafts · 702 shared live plots</p></div>
      <a style={{color:"#80c8ff",fontSize:13}} href="/admin">← Super Admin</a>
    </header>
    <section style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",margin:"15px 0"}}>
      {blocks.map(b=><button key={b} type="button" disabled={busy} aria-pressed={b===block} style={{...baseButton,background:b===block?"#086f9c":"#192b43",fontWeight:b===block?800:500}}
        onClick={()=>{setBlock(b);setSearch("");setMessage("")}}>Block {b.toUpperCase()} · {allCount[b]?.mapped||0}/{allCount[b]?.total||0}</button>)}
      <span style={{fontSize:12,color:"#bdd0e2",marginLeft:6}}>Assigned {draft?.maps.length||0}/{draft?.plots.length||0} · {draft?.maps.length?`Pending ${incomplete}`:"Not initialized"} · Public {draft?.state.enabled?"BLOCKS LIVE":"Legacy unchanged"}</span>
    </section>
    {message&&<div role="status" style={{background:"#183149",border:"1px solid #2c526f",borderRadius:10,padding:12,marginBottom:10,fontSize:13}}>{message}</div>}
    {draft&&!draft.maps.length&&<section style={{background:"#18304a",padding:15,borderRadius:12,marginBottom:12}}>
      <strong>Step 1 — Assign existing plots to blocks</strong>
      <p style={{fontSize:13,color:"#bcd0e5"}}>Uses the original ${draft.plots.length} active plot records. This creates separate Block drafts; no live map, status, measurements or customer data will change.</p>
      <p style={{fontSize:13,color:"#aee0ff",margin:"8px 0"}}>
        Automatically recognized: <b>{draft.assignmentPreview.autoAssigned}</b> · Need review: <b>{unknown.length}</b>
        {" · "}Proposed A <b>{previewCounts.a}</b> / B <b>{previewCounts.b}</b> / C <b>{previewCounts.c}</b>
      </p>
      {unknown.length>0&&<div style={{background:"#0e2236",border:"1px solid #536a84",borderRadius:10,padding:12,margin:"10px 0"}}>
        <b style={{fontSize:14}}>Review {unknown.length} unrecognized Plot IDs before initialization</b>
        <p style={{color:"#c3d4e8",fontSize:12,margin:"7px 0"}}>
          These plot labels do not clearly indicate A/B/C. Choose the correct block using the approved layout. We won't guess or change any existing plot record.
        </p>
        <p style={{fontSize:12,color:unresolved.length?"#ffcc80":"#6ee4ae",margin:"7px 0"}}>
          {unresolved.length? `${unresolved.length} need a block selection`:"Every unusual plot ID has a reviewed block"}
        </p>
        <input value={assignmentSearch} onChange={e=>setAssignmentSearch(e.target.value)} placeholder="Find unusual Plot ID" aria-label="Find unrecognized plot" style={{background:"#162e48",color:"white",border:"1px solid #425b77",borderRadius:7,padding:9,width:"min(100%,300px)",boxSizing:"border-box",marginBottom:8}}/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8,maxHeight:285,overflow:"auto"}}>
          {unknown.filter(id=>id.toLowerCase().includes(assignmentSearch.trim().toLowerCase())).map(id=><label key={id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"7px 9px",border:"1px solid #2c4e6a",borderRadius:8,fontSize:13}}>
            <span style={{overflowWrap:"anywhere",flex:1}}>{id}</span>
            <select aria-label={`Block for plot ${id}`} value={explicitBlocks[id]||""} disabled={busy}
              onChange={e=>setExplicitBlocks(current=>({...current,[id]:e.target.value as Block}))}
              style={{background:"#203c5a",color:"#f5f9ff",borderRadius:6,padding:7,border:"1px solid #526982"}}>
              <option value="">Choose block</option>
              {blocks.map(b=><option key={b} value={b}>Block {b.toUpperCase()}</option>)}
            </select>
          </label>)}
        </div>
      </div>}
      <button disabled={busy||unresolved.length>0} style={{...baseButton,background:"#057b65",opacity:unresolved.length?.5:1}} onClick={initialize}>
        {unresolved.length? `Review ${unresolved.length} plots to initialize`:`Initialize ${draft.plots.length} plot assignments`}
      </button>
    </section>}
    <section style={{border:"1px solid #243d59",borderRadius:12,padding:12,marginBottom:10,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <label style={{...baseButton,display:"inline-block",background:"#123c60"}}>Upload Block {block.toUpperCase()} masterplan
        <input style={{display:"block",fontSize:11,marginTop:6,maxWidth:235}} type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={upload}/></label>
      <span style={{fontSize:12,color:"#b8cfe4"}}>{asset?.draftFilename||"No draft image"} {asset?.draftWidth?(`· ${asset.draftWidth}×${asset.draftHeight}`):""}</span>
      <a style={{marginLeft:"auto",color:"#8ed0ff",fontSize:13}} href="/projects/metro-city-c024a5" target="_blank" rel="noreferrer">View customer site</a>
    </section>
    {draft?.maps.length>0&&<section style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
      <button type="button" disabled={busy} onClick={createCheckpoint} style={baseButton}>Create private R2 checkpoint · Block {block.toUpperCase()}</button>
      <button type="button" disabled={busy} onClick={downloadDraftBackup} style={baseButton}>Download Block {block.toUpperCase()} mapping JSON</button>
      <small style={{color:"#d8bc84"}}>Recommended after each mapping session. Saves polygons, side roles and image reference — never buyer data.</small>
    </section>}
    {draft?.maps.length? <details style={{border:"1px solid #263f5d",borderRadius:12,marginBottom:12,padding:12}}>
      <summary style={{cursor:"pointer",fontSize:13,fontWeight:700}}>Plot belongs to another block? Move assignment safely (no customer inventory changes)</summary>
      <input placeholder="Search plot ID…" value={search} onChange={e=>setSearch(e.target.value)} style={{padding:9,margin:"12px 0",background:"#142c48",color:"white",borderRadius:8,border:"1px solid #38536d"}}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:5,maxHeight:240,overflow:"auto"}}>
        {available.map(map=><label key={map.plotId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,gap:4}}>
          <span>{map.plotId}</span>
          <select disabled={busy||Boolean(map.polygon)} title={map.polygon?"Mapped plot: backup and remove its boundary before reassigning":""} value={map.blockKey} aria-label={`Block assignment for ${map.plotId}`} onChange={e=>void move(map.plotId,e.target.value as Block)}
            style={{background:"#203953",color:"#fff",padding:5,borderRadius:6}}>
            {blocks.map(b=><option key={b} value={b}>{b.toUpperCase()}</option>)}</select>
        </label>)}
      </div>
    </details>:null}
    {draft?.maps.length&&asset?.draftObjectKey?
      <PlotMapper key={`${block}:${asset.draftObjectKey}:${refresh}`} projectId={projectId} blockKey={block}
        notify={notify} onDraftChanged={()=>{void load().catch(e=>setMessage(String(e)))}}/>:
      <p style={{textAlign:"center",padding:25,color:"#a6bdd6"}}>Initialize plot assignments and upload Block {block.toUpperCase()} image to open the advanced precision mapper.</p>}
    <footer style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",padding:"14px 4px"}}>
      <button style={{...baseButton,background:"#047857"}} disabled={busy||!ready} onClick={publish}>Verify & Publish all 3 blocks</button>
      <button style={{...baseButton,background:"#84273e"}} disabled={busy||!draft?.state.enabled} onClick={restore}>Restore legacy site</button>
      {!ready&&<span style={{fontSize:12,color:"#f5c67b"}}>Publish locked until all 3 images and all active plot boundaries are complete and verified.</span>}
    </footer>
  </main>;
}
