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
});
test("Metro DB guard validates exact identity, 702 statuses and unmodified fingerprint",()=>{
 const dir=mkdtempSync(join(tmpdir(),"metro-guard-test-"));
 const script=new URL("scripts/metro-block-production-guard.mjs",root).pathname;
 function run(mode,obj){
   const p=join(dir,mode+".json");
   writeFileSync(p,JSON.stringify([{results:[obj]}]));
   return spawnSync(process.execPath,[script,mode,p],{encoding:"utf8"});
 }
 try{
   const healthy={id:"c024a562-634d-4e49-b647-43209f6e450b",name:"Metro City",slug:"metro-city-c024a5",status:"active",publicStatus:"published",publishVersion:8,snapshotVersion:8,activePlots:702,publishedPlots:702,available:577,booked:33,sold:92};
   assert.equal(run("preflight",healthy).status,0);
   assert.equal(run("preflight",{...healthy,activePlots:703}).status,1);
   assert.equal(run("preflight",{...healthy,snapshotVersion:7}).status,1);
   assert.equal(run("fingerprint",{id:"1",status:"sold",polygon:"[]"}).status,0);
   assert.equal(run("postflight",{...healthy,blockEnabled:0,blockPublishedMaps:0,tableCount:4}).status,0);
   assert.equal(run("postflight",{...healthy,blockEnabled:-1,blockPublishedMaps:0,tableCount:4}).status,0);
   assert.equal(run("postflight",{...healthy,blockEnabled:1,blockPublishedMaps:1,tableCount:4}).status,1);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
