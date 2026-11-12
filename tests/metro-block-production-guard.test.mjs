import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const root=new URL("../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
test("production deploy performs private backup before D1 migration and post-check before Workers",()=>{
 const workflow=read(".github/workflows/deploy-cloudflare.yml");
 const first=workflow.indexOf("run: bash scripts/metro-block-production-backup.sh");
 const migrate=workflow.indexOf("run: npx wrangler d1 migrations apply");
 const after=workflow.indexOf("run: bash scripts/metro-block-production-postflight.sh");
 const workers=workflow.indexOf("run: npx wrangler deploy");
 assert.ok(first>0 && migrate>first && after>migrate && workers>after);
 assert.match(workflow,/contains\(github\.event\.head_commit\.message, 'METRO CITY multi-block deploy'\)/);
 assert.doesNotMatch(workflow,/upload-artifact.*metro/i);
 const backup=read("scripts/metro-block-production-backup.sh");
 const post=read("scripts/metro-block-production-postflight.sh");
 assert.match(backup,/d1 export/);
 assert.match(backup,/r2 object put/);
 assert.match(backup,/r2 object get/);
 assert.match(backup,/cmp -s/);
 assert.match(post,/fingerprint/);
 assert.match(post,/cmp -s/);
 assert.match(backup,/block-fingerprint\.sha/);
 assert.match(backup,/metro-blocks\\/published\\/\\$block_version\\/\\$block/);
 assert.match(backup,/published-block-\\$block-readback/);
 assert.match(post,/after-block-fingerprint\.sha/);
});
test("Metro DB guard validates exact identity, 702 statuses and unmodified fingerprint",()=>{
 const dir=mkdtempSync(join(tmpdir(),"metro-guard-test-"));
 const script=new URL("scripts/metro-block-production-guard.mjs",root).pathname;
 function run(mode,obj,before=obj){
   const p=join(dir,mode+".json");
   const reference=join(dir,mode+"-before.json");
   writeFileSync(p,JSON.stringify([{results:[obj]}]));
   if(mode==="postflight")writeFileSync(reference,JSON.stringify([{results:[before]}]));
   return spawnSync(process.execPath,[script,mode,p,...(mode==="postflight"?[reference]:[])],{encoding:"utf8"});
 }
 try{
   const healthy={id:"c024a562-634d-4e49-b647-43209f6e450b",name:"Metro City",slug:"metro-city-c024a5",status:"active",publicStatus:"published",publishVersion:8,snapshotVersion:8,activePlots:702,publishedPlots:702,available:577,booked:33,sold:92};
   assert.equal(run("preflight",healthy).status,0);
   assert.equal(run("preflight",{...healthy,activePlots:703}).status,1);
   assert.equal(run("preflight",{...healthy,snapshotVersion:7}).status,1);
   assert.equal(run("fingerprint",{id:"1",status:"sold",polygon:"[]"}).status,0);
   const disabled={...healthy,blockEnabled:0,blockVersion:0,blockPublishedMaps:0,blockDraftMaps:0,blockPublishedAssets:0,tableCount:4,invalidRotations:0};
   const live={...healthy,blockEnabled:1,blockVersion:4,blockPublishedMaps:702,blockDraftMaps:702,blockPublishedAssets:3,tableCount:4,invalidRotations:0};
   assert.equal(run("postflight",disabled).status,0);
   assert.equal(run("postflight",live).status,0,"already-live 3-block projects must not be rejected");
   assert.equal(run("postflight",{...live,blockEnabled:0},live).status,1,"unexpected rollback of live status is unsafe");
   assert.equal(run("postflight",{...live,blockPublishedMaps:701},live).status,1,"missing published plot must block deploy");
   assert.equal(run("postflight",{...live,blockDraftMaps:701},live).status,1,"missing draft plot must block deploy");
   assert.equal(run("postflight",{...live,invalidRotations:1},live).status,1,"invalid public rotation must block deploy");
   assert.equal(run("postflight",{...live,blockVersion:5},live).status,1,"unexpected published version must block deploy");
 }finally{rmSync(dir,{recursive:true,force:true})}
});
