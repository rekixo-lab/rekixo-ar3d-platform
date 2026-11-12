import {env} from "cloudflare:workers";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {notFound} from "next/navigation";
import {panelMode} from "@/modules/auth";
import {isPlatformAccessHost,projectBySlug} from "@/modules/public-project";
import {publicSiteEnabled} from "@/modules/public-site-access";
import {METRO_BLOCK_PROJECT_ID,METRO_BLOCK_SLUG,metroBlockKey,publishedMetroBlock} from "@/app/metro-blocks";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{slug:string;block:string}>}):Promise<Metadata>{
  const {slug,block}=await params;
  return {title:slug===METRO_BLOCK_SLUG&&metroBlockKey(block)?`METRO CITY — Block ${block.toUpperCase()}`:"Project unavailable",robots:{index:false}};
}
export default async function BlockPage({params}:{params:Promise<{slug:string;block:string}>}){
  if(panelMode()==="super")notFound();
  const host=(await headers()).get("host")||"";
  if(!isPlatformAccessHost(host))notFound();
  const {slug,block:raw}=await params;
  const block=metroBlockKey(raw);
  if(slug!==METRO_BLOCK_SLUG||!block)notFound();
  const project=await projectBySlug(slug);
  if(!project||project.id!==METRO_BLOCK_PROJECT_ID||!(await publicSiteEnabled(project.id)))notFound();
  const published=await publishedMetroBlock(project.id,block);
  if(!published)notFound();
  const snapshot=await env.DB.prepare("SELECT s.publish_version AS snapshotVersion,p.publish_version AS publishVersion, (SELECT value FROM published_settings WHERE project_id=p.id AND key='publicDataRevision' LIMIT 1) AS revision FROM projects p LEFT JOIN project_public_snapshots s ON s.project_id=p.id WHERE p.id=?").bind(project.id).first<{snapshotVersion:number;publishVersion:number;revision:string|null}>();
  if(!snapshot||snapshot.snapshotVersion!==snapshot.publishVersion)notFound();
  return <main style={{position:"fixed",inset:0,background:"#050914"}}>
    <iframe title={`METRO CITY Block ${block.toUpperCase()} interactive map`} src={`/__rekixo/project/?projectSlug=${METRO_BLOCK_SLUG}&block=${block}&bv=${published.state.version}&pv=${snapshot.publishVersion}&v=69${snapshot.revision?`&dataRevision=${encodeURIComponent(snapshot.revision)}`:""}`} loading="eager" style={{width:"100%",height:"100%",border:0,display:"block"}}/>
  </main>;
}
