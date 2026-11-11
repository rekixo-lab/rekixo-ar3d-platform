// Real Chromium layout regression against the project's actual static customer HTML.
// Uses an exact slug; does not need production credentials or change any tenant data.
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";

const {chromium}=await import(pathToFileURL(process.env.PLOT_PLAYWRIGHT_MODULE).href);
const source=pathToFileURL(path.resolve("public/project/index.html")).href;
const address="WARD NO. 43 NAGARPALIKA CHIRAWA, DISTRICT JHUNJHUNU, RAJASTHAN, INDIA — SHREE DUNGAR RESIDENCY PROJECT";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
  for(const width of [320,360,390,560,700,768,900,901,1024,1366]){
    const page=await browser.newPage({viewport:{width,height:780},reducedMotion:"no-preference"});
    try{
      await page.goto(source+"?projectSlug=hree-dungar-residency-9176ee",{waitUntil:"domcontentloaded"});
      await page.evaluate((text)=>{
        document.documentElement.classList.remove("rekixo-project-loading","rekixo-project-error");
        document.querySelector(".brand b").textContent="SHREE DUNGAR RESIDENCY";
        document.getElementById("brandSubtitleTrack").textContent=text;
        window.dispatchEvent(new Event("resize"));
      },address);
      await page.waitForTimeout(180);
      const result=await page.evaluate(()=>{
        const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}};
        const viewport=window.visualViewport?.width||innerWidth;
        const subtitle=rect("#brandSubtitle"),track=rect("#brandSubtitleTrack"),actions=rect(".head-actions");
        const buttons=["callTop","outlineTop",...(viewport>900?["waTop"]:[])].map(id=>{
          const el=document.getElementById(id),r=el.getBoundingClientRect();
          return {id,visible:getComputedStyle(el).display!=="none",left:r.left,right:r.right,width:r.width};
        });
        const animation=getComputedStyle(document.getElementById("brandSubtitleTrack")).animationName;
        const webAnimations=document.getElementById("brandSubtitleTrack").getAnimations().length;
        return {viewport,hasClass:document.body.classList.contains("dungar-compact-header"),subtitle,track,actions,buttons,animation,webAnimations};
      });
      assert.equal(result.hasClass,true,"exact tenant marker missing at "+width);
      assert.ok(result.subtitle.width>10,"subtitle lane collapsed at "+width+": "+JSON.stringify(result));
      assert.ok(result.subtitle.right<=result.viewport*.5+2,
        "subtitle exceeds viewport left half at "+width+": "+JSON.stringify(result));
      assert.ok(result.subtitle.right<=result.actions.left-8,
        "subtitle collides with header actions at "+width+": "+JSON.stringify(result));
      assert.ok(result.actions.right<=result.viewport+2,
        "header actions overflow screen at "+width+": "+JSON.stringify(result));
      for(const button of result.buttons){
        assert.ok(button.visible&&button.width>=30&&button.left>=-1&&button.right<=result.viewport+2,
          "header action clipped or hidden at "+width+": "+JSON.stringify(button));
      }
      assert.ok(result.track.width>result.subtitle.width,
        "long address does not overflow clipped lane at "+width);
      assert.ok(result.animation!=="none"||result.webAnimations>0,
        "address has no running pan animation at "+width+": "+JSON.stringify(result));
      console.log("Dungar header safe at "+width+"px",JSON.stringify({
        right:Math.round(result.subtitle.right),mid:Math.round(result.viewport/2),actionLeft:Math.round(result.actions.left)}));
    }finally{await page.close()}
  }
  const other=await browser.newPage({viewport:{width:375,height:780}});
  try{
    await other.goto(source+"?projectSlug=another-client",{waitUntil:"domcontentloaded"});
    assert.equal(await other.evaluate(()=>document.body.classList.contains("dungar-compact-header")),false,
      "other customer projects must not opt into Dungar layout");
    console.log("Other client unaffected.");
  }finally{await other.close()}
}finally{await browser.close()}
