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
    "rgba(255,255,255,0.33)","rgba(255,210,26,0.38)",
    "rgba(30,212,107,0.38)","rgba(255,48,48,0.44)",
  ]);
  assert.deepEqual(fills.map(f=>f.blend),["source-over","source-over","source-over","source-over"]);
  assert.ok(context.draws.filter(draw=>draw.type==="stroke").every(draw=>draw.blend==="source-over"));
});

test("Metro canvas reflects live Agreement Done updates even when Path2D geometry is cached",()=>{
  const scope=viewer(),first=canvas();
  scope.paintMetroPolygons(first,1,1,0,0,0);
  scope.plots[3].agreementDone=false;
  const second=canvas();
  scope.paintMetroPolygons(second,1,1,0,0,0);
  const fill=second.draws.find(draw=>draw.type==="fill"&&draw.id===31);
  assert.equal(fill.style,"rgba(30,212,107,0.38)");
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

test("Canvas backends without color-blend support retain translucent red and plot numbers",()=>{
  const scope=viewer(),context=canvas(false);
  scope.paintMetroPolygons(context,1,1,0,0,0);
  const red=context.draws.find(draw=>draw.type==="fill"&&draw.id===31);
  assert.equal(red.style,"rgba(255,48,48,0.44)");
  assert.equal(red.blend,"source-over");
});

test("Metro SVG and Canvas use matching translucent tint without covering plot labels",()=>{
  const palette={
    available:{rgb:"255,255,255",alpha:.33},
    booked:{rgb:"255,210,26",alpha:.38},
    registered:{rgb:"30,212,107",alpha:.38},
    agreement:{rgb:"255,48,48",alpha:.44},
  };
  for(const [status,{rgb,alpha}] of Object.entries(palette)){
    const cssAlpha=String(alpha).replace(/^0/,"");
    const literal="fill:rgba("+rgb+","+cssAlpha+")!important";
    assert.ok(page.includes('.show-all .plot[data-metro-visual="'+status+'"]{'+literal),
      "All-status SVG tint must be translucent for "+status);
    assert.ok(page.includes('.plot.selected[data-metro-visual="'+status+'"]{'+literal),
      "Selected SVG tint must not hide plot number for "+status);
    assert.ok(alpha>=.25&&alpha<=.45,"Alpha too high and would conceal number");
  }
  assert.match(page,/body\[data-metro-four-status="1"\] \.plot\[data-metro-visual\]\{mix-blend-mode:normal!important/);
  assert.match(renderer,/context\.globalCompositeOperation='source-over'/);
  assert.doesNotMatch(renderer,/globalCompositeOperation='color'|colorBlend/);
  assert.doesNotMatch(page,/fill:#ff3030!important;mix-blend-mode:color/);
  assert.match(page,/function rescaleNormalizedPlots\(\)\{[\s\S]*?invalidateMetroPaint\(\);\s*\}/);
  assert.match(page,/ACTIVE_PROJECT_ID===METRO_RASTER_PROJECT&&touch/);
  assert.doesNotMatch(renderer,/getComputedStyle/);
});

test("Red status overlay maintains meaningful contrast between embedded number and plot background",()=>{
  const tint=[255,48,48],alpha=.44;
  const over=base=>base.map((channel,i)=>Math.round((1-alpha)*channel+alpha*tint[i]));
  const number=over([255,255,255]),plot=over([100,96,48]);
  assert.ok(number.every((channel,i)=>channel>plot[i]+80),
    "Original white plot number must remain visibly lighter than colored plot");
});
