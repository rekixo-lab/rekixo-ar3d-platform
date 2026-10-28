import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const page=readFileSync("public/project/index.html","utf8");
const projectId="c024a562-634d-4e49-b647-43209f6e450b";

test("Metro touch and coarse tablets only use one canvas for original and polygon paints",()=>{
  assert.match(page,/const METRO_RASTER_PROJECT='c024a562-634d-4e49-b647-43209f6e450b'/);
  assert.match(page,/ACTIVE_PROJECT_ID===METRO_RASTER_PROJECT&&touch&&/);
  assert.match(page,/viewport\.clientWidth<=1400&&typeof Path2D!=='undefined'/);
  assert.match(page,/\.map\[data-metro-raster-plots="1"\] \.hotspots\{opacity:0\}/);
  assert.match(page,/\.map\.gesture-active:not\(\[data-metro-raster-plots="1"\]\) \.hotspots\{visibility:hidden\}/);
  assert.match(page,/context\.drawImage\(master,sx,sy,ex-sx,ey-sy,sx,sy,ex-sx,ey-sy\);[\s\S]*?paintMetroPolygons\(context,pixelRatio,cos,sin,tx,ty\);/);
  assert.match(page,/context\.setTransform\(pixelRatio\*scale\*cos,pixelRatio\*scale\*sin/);
  assert.match(page,/context\.lineWidth=shape\.width\/Math\.max\(\.0001,scale\)/);
});

test("Metro gate cannot apply to non-Metro sites or to desktop/fine-pointer",()=>{
  const source=page.slice(page.indexOf("  function updateMetroCanvasMode(){"),
    page.indexOf("  function invalidateMetroPaint(){"));
  assert.ok(source.startsWith("  function updateMetroCanvasMode(){"));
  const checks=[
    [projectId,390,true,true],
    [projectId,820,true,true],
    [projectId,1350,true,true],
    [projectId,1440,true,false],
    [projectId,390,false,false],
    ["different-project",390,true,false],
    ["different-project",820,true,false],
  ];
  for(const [id,width,touch,expected] of checks){
    const viewport={clientWidth:width,dataset:{}};
    const ctx={
      window:{matchMedia:()=>({matches:touch})},
      ACTIVE_PROJECT_ID:id,METRO_RASTER_PROJECT:projectId,metroCanvasPaint:false,metroPaintCache:{},viewport,Path2D:class{},
    };
    vm.runInNewContext(source,ctx);
    assert.equal(ctx.updateMetroCanvasMode(),expected,id+"/"+width+"/"+touch);
    assert.equal(viewport.dataset.metroRasterPlots,expected?"1":"0");
  }
});

test("status, selected, live state and viewport changes invalidate the synchronized canvas",()=>{
  assert.match(page,/function setSelected\(id\)\{[^\n]*invalidateMetroPaint\(\)/);
  assert.match(page,/function setStatusFilter\(st\)\{[^\n]*invalidateMetroPaint\(\)/);
  assert.match(page,/function toggleBoundaries\(\)\{[^\n]*invalidateMetroPaint\(\)/);
  assert.match(page,/function clearStatusFilter\(silent=false\)\{[^\n]*invalidateMetroPaint\(\)/);
  assert.match(page,/if\(statusFilter&&\(metroAgreementMode\|\|statusFilter==='agreement'\)\)clearMismatchedSelection\(statusFilter\);\s*invalidateMetroPaint\(\)/);
  assert.match(page,/resizeRaf=0;updateMetroCanvasMode\(\)/);
  assert.match(page,/metroCanvasPaint=false;\s*viewport\.dataset\.metroRasterPlots='0';/);
  assert.match(page,/if\(refreshNativeMasterplan===draw\)refreshNativeMasterplan=\(\)=>\{\}/);
});

test("all script blocks still parse as JavaScript",()=>{
  for(const m of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
    if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
  }
});
