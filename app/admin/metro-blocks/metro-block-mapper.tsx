"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import type {ChangeEvent,MouseEvent} from "react";

type BlockKey="a"|"b"|"c";
type Plot={id:string;sqft:number;status:string;dimensions:string};
type BlockMap={plotId:string;blockKey:BlockKey;polygon:string};
type Asset={blockKey:string;draftObjectKey:string;draftWidth:number;draftHeight:number;draftFilename:string;northAngle:number;publishedVersion:number};
type Draft={plots:Plot[];maps:BlockMap[];assets:Asset[];state:{enabled:number;version:number}};
type Point=[number,number];
const BLOCKS:BlockKey[]=["a","b","c"];
const projectLink="/projects/metro-city-c024a5";
const parse=(raw:string):Point[]=>{try{const v=JSON.parse(raw);return Array.isArray(v)?v.filter((p:unknown)=>Array.isArray(p)&&p.length===2&&p.every((n:unknown)=>typeof n==="number"&&n>=0&&n<=1)) as Point[]:[]}catch{return []}};
const points=(v:Point[])=>v.map(p=>`${p[0]*1000},${p[1]*1000}`).join(" ");
export default function MetroBlockMapper(){
  const [draft,setDraft]=useState<Draft|null>(null),[block,setBlock]=useState<BlockKey>("a"),[selected,setSelected]=useState(""),[query,setQuery]=useState(""),[verts,setVerts]=useState<Point[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[zoom,setZoom]=useState(100);
  const load=useCallback(async()=>{const r=await fetch("/api/admin/metro-blocks",{cache:"no-store"});if(!r.ok)throw Error("Super Admin block data unavailable. Apply DB migration 0048 before opening.");setDraft(await r.json())},[]);
  useEffect(()=>{load().catch(e=>setMessage(String(e)))},[load]);
  const maps=useMemo(()=>draft?.maps.filter(m=>m.blockKey===block)||[],[draft,block]);
  const filtered=useMemo(()=>maps.filter(m=>m.plotId.toLowerCase().includes(query.trim().toLowerCase())).slice(0,300),[maps,query]);
  const current=maps.find(m=>m.plotId===selected),areaById=useMemo(()=>new Map((draft?.plots||[]).map(p=>[p.id,p])),[draft]);
  const asset=draft?.assets.find(a=>a.blockKey===block);
  const mapped=maps.filter(m=>parse(m.polygon).length>=3).length;
  const unfinished=(draft?.maps||[]).filter(m=>parse(m.polygon).length<3).length;
  const allMapped=!!draft&&draft.maps.length===draft.plots.length&&unfinished===0;
  const imageUrl=asset?.draftObjectKey?`/api/admin/metro-blocks/image?block=${block}&v=${encodeURIComponent(asset.draftObjectKey)}`:"";
  async function send(body:Record<string,unknown>,refresh=true) {
    setBusy(true);setMessage("");
    try{const r=await fetch("/api/admin/metro-blocks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||"Save failed");if(refresh)await load();setMessage("Saved successfully");return true}catch(e){setMessage(String(e));return false}finally{setBusy(false)}
  }
  async function upload(event:ChangeEvent<HTMLInputElement>){
    const file=event.currentTarget.files?.[0];if(!file)return;
    const url=URL.createObjectURL(file),img=new Image();img.src=url;
    try{
      await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error("Image cannot be opened"))});
      setBusy(true);setMessage("Uploading image…");
      const form=new FormData();form.set("block",block);form.set("file",file);form.set("width",String(img.naturalWidth));form.set("height",String(img.naturalHeight));
      const r=await fetch("/api/admin/metro-blocks",{method:"POST",body:form});
      const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||"Image upload failed");
      await load();setMessage("Draft image uploaded (customer site unchanged)");
    }catch(e){setMessage(String(e))}finally{URL.revokeObjectURL(url);event.currentTarget.value="";setBusy(false)}
  }
  function choose(id:string){setSelected(id);setVerts(parse(maps.find(m=>m.plotId===id)?.polygon||""));setMessage("")}
  function clickMap(e:MouseEvent<SVGSVGElement>){
    if(!selected||busy)return;
    const rect=e.currentTarget.getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;
    if(x<0||x>1||y<0||y>1)return;
    setVerts(v=>v.length>=80?v:[...v,[Number(x.toFixed(7)),Number(y.toFixed(7))]]);
  }
  async function calibrateNorth(angle:number){await send({action:"calibrate",block,angle})}
  async function savePolygon(){if(!selected||verts.length<3){setMessage("Select a plot and mark 3 or more vertices.");return}
    const ok=await send({action:"map",block,plotId:selected,polygon:verts});if(ok)setVerts([]); // load the saved geometry from snapshot on next selection
  }
  async function initialize(){if(!confirm("Initialize draft block assignment from existing plot ID prefixes? Existing plots, statuses, sales and published data will not change."))return;await send({action:"initialize"})}
  async function move(plotId:string,next:BlockKey){if(!confirm(`Move ${plotId} to Block ${next.toUpperCase()}? Its draft polygon will be cleared; live site unchanged.`))return;await send({action:"move",block:next,plotId});if(plotId===selected){setSelected("");setVerts([])}}
  async function publish(){if(!draft||!allMapped||!BLOCKS.every(b=>draft.assets.some(a=>a.blockKey===b&&a.draftObjectKey))){setMessage("All active plots need a polygon and all blocks need draft images.");return}
    if(!confirm(`Publish three complete blocks with ${draft.plots.length} plots? The current customer link will become the block selector. Continue?`))return;
    const ok=await send({action:"publish",expectedVersion:draft.state.version,confirmation:"PUBLISH METRO BLOCKS"});if(ok)setMessage("All three blocks published and enabled. Recheck customer link, search, status and images.")}
  async function restore(){if(!confirm("Restore original METRO CITY customer site? Draft and published block assets will be retained."))return;await send({action:"disable",confirmation:"RESTORE METRO LEGACY"})}
  return <main style={{background:"#07101c",color:"#eaf3ff",minHeight:"100vh",padding:18,fontFamily:"system-ui,sans-serif"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div><h1 style={{fontWeight:800,fontSize:24,margin:0}}>METRO CITY · Block Mapper</h1><p style={{color:"#9db1cb",margin:"4px 0"}}>Super Admin only · A/B/C Draft mapping isolated from live plots</p></div>
      <a href="/admin" style={{color:"#70bcff"}}>← Back to Super Admin</a>
    </header>
    {message&&<p role="status" style={{padding:12,background:"#132438",borderRadius:8}}>{message}</p>}
    <section style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",margin:"14px 0"}}>
      {!draft?.maps.length&&<button disabled={busy} onClick={initialize} style={buttonStyle}>Initialize plot assignments</button>}
      {BLOCKS.map(b=><button key={b} disabled={busy} onClick={()=>{setBlock(b);setSelected("");setVerts([]);setZoom(100);setQuery("")}} style={{...buttonStyle,background:block===b?"#136aa4":"#16253b"}}>Block {b.toUpperCase()} · {draft?.maps.filter(m=>m.blockKey===b&&parse(m.polygon).length>=3).length||0}/{draft?.maps.filter(m=>m.blockKey===b).length||0}</button>)}
      <span style={{color:"#b1c3dd",fontSize:13}}>Total {draft?.maps.length||0}/{draft?.plots.length||0} · Pending {unfinished}</span>
      <span style={{color:draft?.state.enabled?"#73e0ad":"#ffcc70",fontSize:13}}>Public: {draft?.state.enabled?"Block selection LIVE":"Legacy site unchanged"}</span>
    </section>
    <section style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:12}}>
      <label style={buttonStyle}>Upload Block {block.toUpperCase()} Masterplan <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy} style={{display:"block",marginTop:5,maxWidth:230}}/></label>
      <span style={{fontSize:12,color:"#9db1cb"}}>{asset?.draftFilename||"No image uploaded"} {asset?.draftWidth?(`${asset.draftWidth}×${asset.draftHeight}`):""}</span>
      <label>Zoom <input type="range" min="70" max="450" step="10" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/>{zoom}%</label>
      <label style={{fontSize:13,color:"#b9cce2"}}>North angle (°) <input key={block+String(asset?.northAngle||0)} type="number" min="0" max="359.999" step="0.1" defaultValue={asset?.northAngle??0} onBlur={e=>{const value=Number(e.currentTarget.value);if(Number.isFinite(value)&&value>=0&&value<360&&value!==asset?.northAngle)calibrateNorth(value)}} style={{width:76,padding:8,background:"#203651",color:"white",border:"1px solid #345473",borderRadius:7}}/></label>
    </section>
    <div style={{display:"grid",gridTemplateColumns:"minmax(220px,280px) minmax(0,1fr)",gap:12,alignItems:"start"}}>
      <aside style={{background:"#101d30",borderRadius:12,padding:12,maxHeight:"72vh",overflow:"auto"}}>
        <input aria-label="Search plot" placeholder="Search plot number" value={query} onChange={e=>setQuery(e.target.value)} style={{boxSizing:"border-box",width:"100%",padding:10,background:"#213149",color:"white",border:"1px solid #40546f",borderRadius:8}}/>
        <p style={{fontSize:12,color:"#9db1cb"}}>Choose a plot, click its corners in order, then Save. Image coordinates remain normalized.</p>
        {filtered.map(m=><div key={m.plotId} style={{display:"flex",gap:4,marginBottom:4}}>
          <button onClick={()=>choose(m.plotId)} style={{...buttonStyle,flex:1,textAlign:"left",background:selected===m.plotId?"#116e89":"#1a2a43"}}>
            {m.polygon?"✓":"○"} {m.plotId} <span style={{float:"right",opacity:.75}}>{areaById.get(m.plotId)?.sqft||0} ft²</span>
          </button>
          <select aria-label={`Move ${m.plotId}`} value={m.blockKey} onChange={e=>move(m.plotId,e.target.value as BlockKey)} disabled={busy} style={{background:"#273851",color:"white",borderRadius:6}}>{BLOCKS.map(b=><option key={b} value={b}>{b.toUpperCase()}</option>)}</select>
        </div>)}
      </aside>
      <div style={{minWidth:0}}>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
          <b>{selected||"Select a plot"}</b><span style={{fontSize:12,color:"#9db1cb"}}>{verts.length} corners (3 minimum)</span>
          <button disabled={!verts.length||busy} onClick={()=>setVerts(v=>v.slice(0,-1))} style={buttonStyle}>Undo point</button>
          <button disabled={!selected||busy} onClick={()=>setVerts([])} style={buttonStyle}>Redraw</button>
          <button disabled={verts.length<3||busy} onClick={savePolygon} style={{...buttonStyle,background:"#047857"}}>Save polygon</button>
        </div>
        <div style={{overflow:"auto",height:"min(68vh,750px)",border:"1px solid #314560",borderRadius:12,background:"#101c2c"}}>
          {imageUrl?<div style={{position:"relative",width:`${zoom}%`,minWidth:"100%",lineHeight:0}}>
            <img src={imageUrl} alt={`Block ${block.toUpperCase()} draft masterplan`} draggable={false} style={{display:"block",width:"100%",height:"auto"}}/>
            <svg aria-label="Click image to add polygon vertices" onClick={clickMap} viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%",cursor:selected?"crosshair":"default"}}>
              {maps.filter(m=>m.plotId!==selected&&m.polygon).map(m=><polygon key={m.plotId} points={points(parse(m.polygon))} fill="#13ab8533" stroke="#13efbb" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
              {verts.length>1&&<polyline points={points(verts)} fill="none" stroke="#ffdd66" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
              {verts.length>2&&<polygon points={points(verts)} fill="#ffdd6629" stroke="#ffdd66" strokeDasharray="5 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>}
              {verts.map((p,i)=><circle key={i} cx={p[0]*1000} cy={p[1]*1000} r="3" fill="#ffec90" stroke="#111" strokeWidth="0.7"/>)}
            </svg>
          </div>:<p style={{padding:30,textAlign:"center",color:"#adc2da"}}>Upload Block {block.toUpperCase()} image first. Existing customer site is unaffected.</p>}
        </div>
      </div>
    </div>
    <footer style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"18px 0"}}>
      <button disabled={!allMapped||busy||!BLOCKS.every(b=>draft?.assets.some(a=>a.blockKey===b&&a.draftObjectKey))} onClick={publish} style={{...buttonStyle,background:"#047857"}}>Verify & Publish all 3 blocks</button>
      <button disabled={!draft?.state.enabled||busy} onClick={restore} style={{...buttonStyle,background:"#8e3147"}}>Restore legacy site (rollback)</button>
      <a href={projectLink} target="_blank" rel="noreferrer" style={{color:"#7dc6ff"}}>Open customer site</a>
    </footer>
  </main>;
}
const buttonStyle:React.CSSProperties={background:"#203651",color:"#ecf4ff",border:"1px solid #385570",borderRadius:8,padding:"8px 12px",cursor:"pointer",fontSize:13};
