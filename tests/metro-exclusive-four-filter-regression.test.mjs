import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const html=readFileSync("public/project/index.html","utf8");
const three=readFileSync("public/project/three-view.js","utf8");

const source=html.slice(html.indexOf("  function plotStatus(p){"),
  html.indexOf("  // Metro-only public touch/hit-testing",html.indexOf("  function plotStatus(p){")));
assert.ok(source.includes("function matchesStatusFilter(p,filter)"));
function viewer(metroAgreementMode){
  const ctx={metroAgreementMode};
  vm.runInNewContext(source+";this.statusFns={plotStatus,metroVisualStatus,publicPlotStatus,matchesStatusFilter}",ctx);
  return ctx.statusFns;
}
const cases=[
  {id:"available",status:"available",agreementDone:false,expected:"available"},
  {id:"booked",status:"booked",agreementDone:false,expected:"booked"},
  {id:"registered",status:"sold",agreementDone:false,expected:"registered"},
  {id:"booked-agreement-3",status:"booked",agreementDone:true,expected:"agreement"},
  {id:"sold-agreement",status:"sold",agreementDone:true,expected:"agreement"},
  {id:"available-agreement",status:"available",agreementDone:true,expected:"agreement"},
];
const filters=["available","booked","sold","agreement"];
const visibleFilter=key=>key==="registered"?"sold":key;

test("Metro four filters partition plot inventory: no Booked red #3 and no Registered Agreement",()=>{
  const f=viewer(true);
  for(const plot of cases){
    assert.equal(f.metroVisualStatus(plot),plot.expected,plot.id);
    assert.equal(f.publicPlotStatus(plot),plot.expected,plot.id);
    const matches=filters.filter(filter=>f.matchesStatusFilter(plot,filter));
    assert.deepEqual(matches,[visibleFilter(plot.expected)],plot.id);
  }
  for(const category of filters){
    const matching=cases.filter(p=>f.matchesStatusFilter(p,category));
    assert.ok(matching.every(p=>p.expected=== (category==="sold"?"registered":category)));
  }
});

test("non-Metro preserves original three status filters and canonical classification",()=>{
  const f=viewer(false);
  for(const p of cases){
    assert.equal(f.publicPlotStatus(p),p.status);
    assert.equal(f.matchesStatusFilter(p,p.status),true);
    assert.equal(f.matchesStatusFilter(p,"agreement"),false);
  }
});

test("SVG hides wrong categories including selected booked-agreement and sold-agreement",()=>{
  for(const [key,visual] of [
    ["available","available"],["booked","booked"],
    ["sold","registered"],["agreement","agreement"]]){
    for(const selected of ["",".selected"]){
      const selector='.show-all.status-filter-'+key+' .plot'+selected+
        ':not([data-metro-visual="'+visual+'"])';
      assert.ok(html.includes(selector),"Missing exclusive selector "+selector);
    }
  }
  assert.match(html,/body\[data-metro-four-status="1"\] \.show-all\.status-filter-booked/);
  assert.match(html,/body\[data-metro-four-status="1"\] \.show-all\.status-filter-sold/);
});

test("mobile Canvas uses the same exclusive filter, independent of native data-status",()=>{
  assert.match(html,/if\(showAll&&statusFilter&&!matchesStatusFilter\(plot,statusFilter\)\)continue/);
  assert.match(html,/function metroFilterAllowsPlot\(p\)/);
  assert.match(html,/clearMismatchedSelection\(st\)/);
  assert.match(html,/freshPeek&&metroFilterAllowsPlot\(freshPeek\)/);
});

test("3D draw, hit test and labels use same visible status precedence",()=>{
  assert.match(three,/matchesStatusFilter\(p\)\{return !this\.statusFilter\|\|\(this\.metroFourStatus\?this\.visualStatusOf\(p\)===\(this\.statusFilter==='sold'\?'registered':this\.statusFilter\)/);
  assert.match(three,/if\(!this\.matchesStatusFilter\(p\)\)continue/);
  assert.match(three,/!this\.showAll\|\|this\.matchesStatusFilter\(p\)/);
  const m=three.match(/\bvisualStatusOf\(p\)\{[^\n]*\}/)?.[0];
  const n=three.match(/\bmatchesStatusFilter\(p\)\{[^\n]*\}/)?.[0];
  assert.ok(m&&n);
  const testView=vm.runInNewContext("({metroFourStatus:true,statusFilter:null,"+m+","+n+"})",
    {statusOf:p=>p.status});
  for(const p of cases){
    for(const filter of filters){
      testView.statusFilter=filter;
      assert.equal(testView.matchesStatusFilter(p),viewer(true).matchesStatusFilter(p,filter),
        p.id+"/"+filter);
    }
  }
});

test("Metro public STATUS counts partition, while Total stays canonical",()=>{
  const start=html.indexOf("  function updateStatusCounts(){");
  const end=html.indexOf("  function applyLiveState(data){",start);
  assert.ok(start>=0&&end>start);
  const nodes=Object.fromEntries(["countAvailable","countBooked","countSold",
    "countAgreement","countTotal"].map(id=>["#"+id,{textContent:""}]));
  const ctx={plots:cases,metroAgreementMode:true,
    plotStatus:p=>p.status,q:id=>nodes[id]};
  vm.runInNewContext(html.slice(start,end)+";updateStatusCounts()",ctx);
  const counts={available:1,booked:1,sold:1,agreement:3,total:6};
  for(const [key,value] of Object.entries(counts))
    assert.equal(Number(nodes["#count"+key[0].toUpperCase()+key.slice(1)].textContent),value,key);
  assert.equal(Object.values(counts).slice(0,4).reduce((a,b)=>a+b,0),counts.total);
});

test("plot details, peek card and live updates show Agreement Done, not canonical Booked",()=>{
  assert.match(html,/function publicPlotStatus\(p\)/);
  assert.match(html,/label==='agreement'\)return 'Agreement Done'/);
  assert.match(html,/const st=publicPlotStatus\(p\),statusLabel=statusDisplayLabel\(st\)/);
  assert.match(html,/const card=ensurePlotPeek\(\),st=publicPlotStatus\(p\)/);
  assert.match(html,/const st=publicPlotStatus\(fresh\),statusEl=q\('#plotStatusValue'\)/);
  assert.match(html,/engine3D\?\.clear\?\.\(\);close\(\);hidePlotPeek\(\)/);
  for(const key of ["registered","agreement"])
    assert.ok(html.includes('.drawer[data-status="'+key+'"] .chip'),
      "status detail chip missing "+key);
  for(const key of ["available","booked","registered","agreement"])
    assert.ok(html.includes('.plot-peek[data-metro-visual="'+key+'"]{--peek-rgb:'),
      "peek card tint missing "+key);
});
