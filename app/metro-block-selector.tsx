import {env} from "cloudflare:workers";
import Link from "next/link";
import styles from "./metro-block-selector.module.css";
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
  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.logo}>
          {logoUrl?<img src={logoUrl} alt="Metro City project logo" width={74} height={74} className={styles.logoImage}/>:<strong className={styles.fallbackLogo}>MC</strong>}
        </div>
        <div className={styles.brandHeading}>
          <div className={styles.welcome}>WELCOME TO</div>
          <h1 className={styles.projectName}>METRO CITY</h1>
          <p className={styles.subtitleFull}>Gaura, Naubatpur, Patna · Explore your preferred block</p>
        </div>
      </div>
      <p className={styles.subtitleCompact}>Gaura, Naubatpur, Patna</p>
      <nav aria-label="Metro City contact and administration" className={styles.actions}>
        {callingAllowed?<a href={`tel:+${callNumber}`} aria-label="Call Metro City" title="Call Metro City" className={styles.iconButton}><Phone size={21} strokeWidth={2}/></a>:
          <span role="img" aria-label="Calling not configured" title="Calling not configured" className={styles.iconDisabled}><Phone size={21} strokeWidth={2}/></span>}
        <Link href={`/projects/${METRO_BLOCK_SLUG}/admin-login`} aria-label="Open Metro City admin panel" title="Admin panel" className={styles.iconButton}><LayoutDashboard size={21} strokeWidth={2}/></Link>
      </nav>
    </header>
    <section className={styles.section} aria-labelledby="metro-blocks-heading">
      <h2 id="metro-blocks-heading" className={styles.sectionTitle}>Explore a Block</h2>
      <p className={styles.description}>
        <span className={styles.descriptionFull}>Choose a block to open its full interactive 2D and 3D plot layout.</span>
        <span className={styles.descriptionCompact}>Choose a block to explore plots in 2D and 3D.</span>
      </p>
      <div className={styles.cards}>
        {METRO_BLOCK_KEYS.map(b=>{
          const v=byBlock.get(b);
          const asset=assets[METRO_BLOCK_KEYS.indexOf(b)]!;
          return <Link key={b} href={"/projects/metro-city-c024a5/block/"+b} className={styles.card} aria-label={"Explore Metro City Block "+b.toUpperCase()}>
            <div className={styles.preview}>
              <img loading="lazy" decoding="async" alt={"Block "+b.toUpperCase()+" masterplan preview"} src={"/api/project-asset/masterplan?projectSlug=metro-city-c024a5&block="+b+"&variant=public&bv="+asset.state.version} className={styles.previewImage}/>
              <span className={styles.previewBadge}>BLOCK {b.toUpperCase()}</span>
            </div>
            <div className={styles.cardContent}>
              <div className={styles.cardHeading}><strong className={styles.cardTitle}>Block {b.toUpperCase()}</strong><span className={styles.viewLink}>View Site <span aria-hidden="true">↗</span></span></div>
              <div className={styles.status}>{v?.total||0} Plots · {v?.available||0} Available · {v?.booked||0} Booked</div>
              <div className={styles.note}>Live status, plot search, 2D/3D and site amenities</div>
            </div>
          </Link>;
        })}
      </div>
    </section>
  </main>;
}
