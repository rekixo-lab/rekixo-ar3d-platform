import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const page=readFileSync("public/project/index.html","utf8");
const renderer=page.slice(page.indexOf("  function metroPlotPaintCache(){"),
  page.indexOf("  let publicInitialViewMode='legacy'"));

function viewer(){
  const plots=[
    {id:"A",status:"available",points:[[1,1],[3,1],[3,3]]},
    {id:"B",status:"booked",points:[[11,1],[13,1],[13,3]]},
    {id:"R",status:"sold",points:[[21,1],[23,1],[23,3]]},
    {id:"D",status:"sold",agreementDone:true,points:[[31,1],[33,1],[33,3]]},
  ];
  const nodes=plots.map(p=>({tagName:"polygon",dataset:{plotId:p.id}}));
  class FakePath{
    moveTo(x){this.id=x}
    lineTo(){}
    closePath(){}
  }
  const scope={
    plots,metroPaintCache:null,metroCanvasPaint:true,
    showAll:true,selected:null,statusFilter:null,scale:2,
    svg:{querySelectorAll:()=>nodes},Path2D:FakePath,
    metroVisualStatus:p=>p.agreementDone===true?"agreement":
      p.status==="sold"?"registered":p.status,
    matchesStatusFilter:(p,filter)=>filter==="agreement"?
      p.agreementDone===true:filter==="sold"?
      p.status==="sold":p.status===filter,
    getComputedStyle:()=>{throw Error("Canvas must not read hidden SVG computed styles")},
  };
  vm.runInNewContext(renderer,scope);
  return scope;
}

function canvas(supportsColor=true){
  let blend="source-over";
  const draws=[];
  const context={
    draws,fillStyle:"",strokeStyle:"",lineWidth:0,
    setTransform(){},save(){},restore(){blend="source-over"},
    fill(path){draws.push({type:"fill",id:path.id,style:this.fillStyle,blend})},
    stroke(path){draws.push({type:"stroke",id:path.id,style:this.strokeStyle,width:this.lineWidth,blend})},
  };
  Object.defineProperty(context,"globalCompositeOperation",{
    get(){return blend},
    set(value){if(value!=="color"||supportsColor)blend=value},
  });
  return context;
}

test("Metro color fill reads the plot's semantic live status, not stale SVG computed styles",()=>{
  const scope=viewer(),context=canvas();
  scope.paintMetroPolygons(context,1,1,0,0,0);
  const fills=context.draws.filter(draw=>draw.type==="fill");
  assert.deepEqual(fills.map(f=>f.id),[1,11,21,31]);
  assert.deepEqual(fills.map(f=>f.style),[
    "rgba(255,255,255,.33)","rgb(255,210,26)",
    "rgb(30,212,107)","rgb(255,48,48)",
  ]);
  assert.deepEqual(fills.map(f=>f.blend),["source-over","color","color","color"]);
  assert.ok(context.draws.filter(draw=>draw.type==="stroke").every(draw=>draw.blend==="source-over"));
});

test("Metro canvas reflects live Agreement Done updates even when Path2D geometry is cached",()=>{
  const scope=viewer(),first=canvas();
  scope.paintMetroPolygons(first,1,1,0,0,0);
  scope.plots[3].agreementDone=false;
  const second=canvas();
  scope.paintMetroPolygons(second,1,1,0,0,0);
  const fill=second.draws.find(draw=>draw.type==="fill"&&draw.id===31);
  assert.equal(fill.style,"rgb(30,212,107)");
  assert.equal(scope.metroPlotPaintCache().length,4);
});

test("Metro status filters and selection paint only eligible polygons",()=>{
  const scope=viewer(),filtered=canvas();
  scope.statusFilter="agreement";
  scope.paintMetroPolygons(filtered,1,1,0,0,0);
  assert.deepEqual(filtered.draws.filter(draw=>draw.type==="fill").map(draw=>draw.id),[31]);

  scope.statusFilter=null;
  scope.showAll=false;
  scope.selected=scope.plots[0];
  const selected=canvas();
  scope.paintMetroPolygons(selected,1,1,0,0,0);
  assert.deepEqual(selected.draws.filter(draw=>draw.type==="fill").map(draw=>draw.id),[1]);
  assert.equal(selected.draws.find(draw=>draw.type==="stroke").style,"#ffffff");
});

test("older canvas backends keep a visible red fallback instead of losing fills",()=>{
  const scope=viewer(),context=canvas(false);
  scope.paintMetroPolygons(context,1,1,0,0,0);
  const red=context.draws.find(draw=>draw.type==="fill"&&draw.id===31);
  assert.equal(red.style,"rgba(255,48,48,.78)");
  assert.equal(red.blend,"source-over");
});

test("Metro SVG fallback uses luminance-preserving status colors and rescale invalidates geometry",()=>{
  for(const [status,color] of Object.entries({
    booked:"#ffd21a",registered:"#1ed46b",agreement:"#ff3030",
  })){
    assert.match(page,new RegExp("show-all \\.plot\\[data-metro-visual=\\\""+
      status+"\\\"\\]\\{fill:"+color+"!important;mix-blend-mode:color"));
  }
  assert.match(page,/function rescaleNormalizedPlots\(\)\{[\s\S]*?invalidateMetroPaint\(\);\s*\}/);
  assert.match(page,/ACTIVE_PROJECT_ID===METRO_RASTER_PROJECT&&touch/);
  assert.doesNotMatch(renderer,/getComputedStyle/);
});
