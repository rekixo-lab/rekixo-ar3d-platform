import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const html=readFileSync(new URL("../public/project/index.html",import.meta.url),"utf8");
function slice(start,end){
  const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,"Missing tablet helper anchors: "+start);
  return html.slice(i,j)
}
const helperSource=slice("  function isTabletPlotPresentation(){","  function limits(){");

function scenario({width=820,height=1040,W=2400,H=1400,rotation=1,mode="plots",touch=true,points}={}){
  const plots=[{points:points||[[W*.12,H*.10],[W*.88,H*.10],[W*.88,H*.92],[W*.12,H*.92]]}];
  const size=rotation%2?{w:H,h:W}:{w:W,h:H};
  const fit=Math.min(width/size.w,height/size.h);
  const ctx={
    viewportWidth:width,viewportHeight:height,viewport:{clientWidth:width,clientHeight:height},
    publicInitialViewMode:mode,publicRotation:rotation,W,H,plots,fit,Math,Number,Infinity,Array,
    window:{matchMedia:query=>({matches:touch && (query.includes("pointer:coarse"))})},
    displaySize:()=>size,
    rotateOffset:(x,y,turns)=>turns===1?{x:-y,y:x}:turns===2?{x:-x,y:-y}:turns===3?{x:y,y:-x}:{x,y},
  };
  const result=vm.runInNewContext(helperSource+"\n({isTabletPlotPresentation,mappedDisplayBounds,tabletMappedStartScale})",ctx);
  return {...result,ctx,size,fit,plots};
}
test("Farm Villa tablet portrait: 90-degree map opens centered, full-image-safe",()=>{
  const a=scenario({width:800,height:1010,rotation:1,W:2400,H:1350});
  assert.equal(a.isTabletPlotPresentation(),true);
  const zoom=a.tabletMappedStartScale();
  assert.ok(zoom>0&&zoom<=a.fit*.9600001);
  assert.ok(zoom*a.size.w < a.ctx.viewportWidth);
  assert.ok(zoom*a.size.h < a.ctx.viewportHeight);
  // World center remains at viewport center: no right-edge crop.
  for(const point of a.plots[0].points){
    const p=a.ctx.rotateOffset(point[0]-a.ctx.W/2,point[1]-a.ctx.H/2,a.ctx.publicRotation);
    assert.ok(Math.abs(p.x*zoom)<=a.ctx.viewportWidth/2);
    assert.ok(Math.abs(p.y*zoom)<=a.ctx.viewportHeight/2);
  }
});
test("all 4 public rotations, portrait and landscape tablets remain within screen",()=>{
  for(const rotation of [0,1,2,3]){
    for(const [width,height] of [[800,1120],[1180,800],[1366,1024]]){
      const a=scenario({width,height,rotation});
      assert.equal(a.isTabletPlotPresentation(),true);
      const z=a.tabletMappedStartScale();
      assert.ok(Number.isFinite(z)&&z>0);
      assert.ok(a.size.w*z<=width&&a.size.h*z<=height,
        "clipped world "+JSON.stringify({rotation,width,height,z}));
    }
  }
});
test("phones, desktop mouse and explicit custom focus keep existing behavior",()=>{
  assert.equal(scenario({width:390,height:780,touch:true}).isTabletPlotPresentation(),false);
  assert.equal(scenario({width:1080,height:750,touch:false}).isTabletPlotPresentation(),false);
  assert.equal(scenario({width:1500,height:920,touch:true}).isTabletPlotPresentation(),false);
  assert.equal(scenario({width:800,height:1100,touch:true,mode:"custom"}).isTabletPlotPresentation(),false);
  assert.equal(scenario({width:800,height:1100,touch:true,mode:"legacy"}).isTabletPlotPresentation(),false);
  assert.match(html,/fit = mobile \? Math\.max\(fw,fh\) : containFit/);
  assert.match(html,/scale=focus\?configuredFocusScale\(focus\):fit/);
  assert.match(html,/pan=initialPanForPresentation\(\)/);
});
test("mapped geometry is read-only and invalid vertices do not distort tablet zoom",()=>{
  const a=scenario({points:[[0,0],[100,0],[100,100],[0,100],[NaN,10],[1e7,1e7]]});
  const before=structuredClone(a.plots[0].points);
  const b=a.mappedDisplayBounds();
  assert.ok(b.width>0&&b.height>0);
  assert.ok(a.tabletMappedStartScale()>0);
  assert.deepEqual(a.plots[0].points,before);
  assert.match(html,/world\.style\.transform = .*scale\(\$\{scale\}\) rotate\(\$\{publicRotation\*90\}deg\)/);
});
test("user pan and pinch override automatic tablet framing; reset and resize restore only untouched view",()=>{
  assert.match(html,/if\(isTabletPlotPresentation\(\)\)\{[\s\S]*?scale=tabletMappedStartScale\(\);[\s\S]*?pan=\{x:0,y:0\}/);
  assert.match(html,/presentationUserAdjusted=true;scale=ns/);
  assert.match(html,/presentationUserAdjusted=true;pan\.x=gesture\.pan\.x\+dx/);
  assert.match(html,/function zoomAt\(newScale,sx,sy\)\{presentationUserAdjusted=true/);
  assert.match(html,/if\(publicInitialViewMode==='plots'&&!presentationUserAdjusted\)\{reset\(\);return\}/);
  assert.match(html,/presentationUserAdjusted=false;\s*render\(\)/);
});
