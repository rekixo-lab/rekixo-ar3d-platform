import {env} from "cloudflare:workers";
import Link from "next/link";
import {LayoutDashboard,Phone} from "lucide-react";
import {METRO_BLOCK_PROJECT_ID, METRO_BLOCK_KEYS, METRO_BLOCK_SLUG, publishedMetroBlock} from "./metro-blocks";

type Totals={blockKey:string;total:number;available:number;booked:number;registered:number};
export default async function MetroBlockSelector() {
  const [counts,branding,liveContact]=await Promise.all([
    env.DB.prepare(
      "SELECT m.block_key AS blockKey,COUNT(*) AS total,SUM(CASE WHEN p.status='available' THEN 1 ELSE 0 END) AS available,SUM(CASE WHEN p.status='booked' THEN 1 ELSE 0 END) AS booked,SUM(CASE WHEN p.status='sold' THEN 1 ELSE 0 END) AS registered FROM metro_block_published_maps m JOIN plots p ON p.project_id=m.project_id AND p.id=m.plot_id AND p.inventory_active=1 WHERE m.project_id=? GROUP BY m.block_key"
    ).bind(METRO_BLOCK_PROJECT_ID).all<Totals>(),
    env.DB.prepare("SELECT key,value FROM published_settings WHERE project_id=? AND key IN ('logoName','logoVersion','phone1','phone2','customerCallEnabled')")
      .bind(METRO_BLOCK_PROJECT_ID).all<{key:string;value:string}>(),
    // Match the customer site's live contact behavior without exposing admin data.
    env.DB.prepare("SELECT key,value FROM settings WHERE project_id=? AND key IN ('phone1','phone2','customerCallEnabled')")
      .bind(METRO_BLOCK_PROJECT_ID).all<{key:string;value:string}>(),
  ]);
  const byBlock=new Map(counts.results.map(x=>[x.blockKey,x]));
  const settings=Object.fromEntries(branding.results.map(row=>[row.key,row.value]));
  const contact={...settings,...Object.fromEntries(liveContact.results.map(row=>[row.key,row.value]))};
  const callNumber=String(contact.phone1||contact.phone2||"").replace(/\D/g,"").slice(0,15);
  const callingAllowed=contact.customerCallEnabled!=="0" && callNumber.length>=7;
  const logoUrl=settings.logoName
    ? `/api/project-asset/logo?projectSlug=${encodeURIComponent(METRO_BLOCK_SLUG)}&variant=public&v=${encodeURIComponent(settings.logoVersion||settings.logoName)}`
    : "";
  const assets=await Promise.all(METRO_BLOCK_KEYS.map(b=>publishedMetroBlock(METRO_BLOCK_PROJECT_ID,b)));
  if(assets.some(x=>!x))return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#070f1c",color:"white"}}>Project Block Viewer temporarily unavailable.</main>;
  const iconStyle={display:"grid",placeItems:"center",width:44,height:44,flexShrink:0,border:"1px solid #36506d",borderRadius:12,background:"#11253b",color:"#eef6ff",textDecoration:"none"} as const;
  return <main style={{minHeight:"100vh",background:"linear-gradient(150deg,#080f1f,#0d2035 55%,#091321)",color:"#f6f9ff",fontFamily:"system-ui,sans-serif",padding:"clamp(16px,4vw,55px)"}}>
    <header style={{maxWidth:1260,margin:"0 auto",display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap",borderBottom:"1px solid #263954",paddingBottom:22}}>
      <div style={{display:"flex",alignItems:"center",gap:14,minWidth:0}}>
        <div style={{width:"clamp(50px,7vw,74px)",height:"clamp(50px,7vw,74px)",flexShrink:0,borderRadius:"50%",border:"2px solid #d8b767",background:"#fff",display:"grid",placeItems:"center",overflow:"hidden"}}>
          {logoUrl?<img src={logoUrl} alt="Metro City project logo" width={74} height={74} style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<strong style={{fontSize:20,color:"#10233e"}}>MC</strong>}
        </div>
        <div style={{minWidth:0}}><div style={{fontSize:11,letterSpacing:3,color:"#e5c474",fontWeight:700}}>WELCOME TO</div><h1 style={{fontSize:"clamp(26px,4vw,52px)",margin:"3px 0",fontWeight:800}}>METRO CITY</h1><p style={{margin:0,color:"#a8bcd5",fontSize:13}}>Gaura, Naubatpur, Patna · Explore your preferred block</p></div>
      </div>
      <nav aria-label="Metro City contact and administration" style={{display:"flex",alignItems:"center",gap:9,marginLeft:"auto"}}>
        {callingAllowed?<a href={`tel:+${callNumber}`} aria-label="Call Metro City" title="Call Metro City" style={iconStyle}><Phone size={21} strokeWidth={2}/></a>:
          <span role="img" aria-label="Calling not configured" title="Calling not configured" style={{...iconStyle,opacity:.45}}><Phone size={21} strokeWidth={2}/></span>}
        <Link href={`/projects/${METRO_BLOCK_SLUG}/admin-login`} aria-label="Open Metro City admin panel" title="Admin panel" style={iconStyle}><LayoutDashboard size={21} strokeWidth={2}/></Link>
      </nav>
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
  </main>;
}
