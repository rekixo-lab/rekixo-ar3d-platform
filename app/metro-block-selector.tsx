import {env} from "cloudflare:workers";
import Link from "next/link";
import {METRO_BLOCK_PROJECT_ID, METRO_BLOCK_KEYS, publishedMetroBlock} from "./metro-blocks";

type Totals={blockKey:string;total:number;available:number;booked:number;registered:number};
export default async function MetroBlockSelector() {
  const counts=await env.DB.prepare(
    "SELECT m.block_key AS blockKey,COUNT(*) AS total,SUM(CASE WHEN p.status='available' THEN 1 ELSE 0 END) AS available,SUM(CASE WHEN p.status='booked' THEN 1 ELSE 0 END) AS booked,SUM(CASE WHEN p.status='sold' THEN 1 ELSE 0 END) AS registered FROM metro_block_published_maps m JOIN plots p ON p.project_id=m.project_id AND p.id=m.plot_id AND p.inventory_active=1 WHERE m.project_id=? GROUP BY m.block_key"
  ).bind(METRO_BLOCK_PROJECT_ID).all<Totals>();
  const byBlock=new Map(counts.results.map(x=>[x.blockKey,x]));
  const assets=await Promise.all(METRO_BLOCK_KEYS.map(b=>publishedMetroBlock(METRO_BLOCK_PROJECT_ID,b)));
  if(assets.some(x=>!x))return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#070f1c",color:"white"}}>Project Block Viewer temporarily unavailable.</main>;
  const total=counts.results.reduce((n,r)=>n+r.total,0);
  return <main style={{minHeight:"100vh",background:"linear-gradient(150deg,#080f1f,#0d2035 55%,#091321)",color:"#f6f9ff",fontFamily:"system-ui,sans-serif",padding:"clamp(20px,4vw,55px)"}}>
    <header style={{maxWidth:1260,margin:"0 auto",display:"flex",justifyContent:"space-between",gap:18,alignItems:"center",flexWrap:"wrap",borderBottom:"1px solid #263954",paddingBottom:22}}>
      <div><div style={{fontSize:12,letterSpacing:3,color:"#e5c474",fontWeight:700}}>WELCOME TO</div><h1 style={{fontSize:"clamp(28px,4vw,52px)",margin:"3px 0",fontWeight:800}}>METRO CITY</h1><p style={{margin:0,color:"#a8bcd5"}}>Gaura, Naubatpur, Patna · Explore your preferred block</p></div>
      <div style={{textAlign:"right",color:"#b7c9df",fontSize:13}}><b style={{color:"#f3d37a",fontSize:24}}>{total}</b><div>Residential plots across 3 blocks</div></div>
    </header>
    <section style={{maxWidth:1260,margin:"36px auto"}}>
      <h2 style={{fontSize:"clamp(20px,2.6vw,29px)",margin:"0 0 6px"}}>Explore a Block</h2>
      <p style={{color:"#b2c3dc",margin:"0 0 24px"}}>Choose a block to open its full interactive 2D and 3D plot layout.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,285px),1fr))",gap:22}}>
      {METRO_BLOCK_KEYS.map(b=>{const v=byBlock.get(b);const asset=assets[METRO_BLOCK_KEYS.indexOf(b)]!;return <Link key={b} href={`/projects/metro-city-c024a5/block/${b}`} style={{color:"inherit",textDecoration:"none",border:"1px solid #294662",borderRadius:22,overflow:"hidden",background:"#111f30",boxShadow:"0 14px 50px #0005"}}>
        <div style={{height:235,position:"relative",background:"#182437"}}>
          <img loading="lazy" alt={`Block ${b.toUpperCase()} masterplan preview`} src={`/api/project-asset/masterplan?projectSlug=metro-city-c024a5&block=${b}&variant=public&bv=${asset.state.version}`} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          <span style={{position:"absolute",top:14,left:14,background:"#061423e8",border:"1px solid #ffd78c66",padding:"7px 13px",borderRadius:30,fontSize:12,fontWeight:700}}>BLOCK {b.toUpperCase()}</span>
        </div>
        <div style={{padding:20,display:"grid",gap:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><strong style={{fontSize:23}}>Block {b.toUpperCase()}</strong><span style={{color:"#f1cd74",fontSize:13}}>View Site →</span></div>
          <div style={{fontSize:13,color:"#b8c9dc"}}>{v?.total||0} Plots · {v?.available||0} Available · {v?.booked||0} Booked</div>
          <div style={{fontSize:12,color:"#90a9c3"}}>Live status, plot search, 2D/3D and site amenities</div>
        </div>
      </Link>})}
      </div>
    </section>
    <footer style={{maxWidth:1260,margin:"0 auto",fontSize:12,color:"#8198b4"}}>Single METRO CITY project · Three interactive block layouts · Shared inventory and admin</footer>
  </main>;
}
