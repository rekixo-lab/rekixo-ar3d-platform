import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html=readFileSync(new URL("../public/project/index.html",import.meta.url),"utf8");
const begin=html.indexOf("function cleanDimensionLabel(value)");
const end=html.indexOf("function parseSideDimensionFacts(value)",begin);
assert.ok(begin>=0&&end>begin,"compact measurement helper must be defined before parser");

function customerHelpers(projectId){
  const context=vm.createContext({ACTIVE_PROJECT_ID:projectId});
  vm.runInContext(html.slice(begin,end),context);
  return context;
}
const active="ec6b45b5-7232-475a-bba8-468caccfe568";

test("Future Invest compact formatting drops source commentary but retains exact numeric label and feet",()=>{
  const ctx=customerHelpers(active);
  assert.equal(ctx.futureInvestCompactFacts(),true);
  assert.equal(ctx.compactFutureInvestMeasurement("19.2 m (63 ft; PDF DRAIN boundary 6.1+4.5+8.6 m, 3 segments)"),"19.2 m (63 ft)");
  assert.equal(ctx.compactFutureInvestMeasurement("7.6 m (25 ft; CAD PDF 3.0+4.6 m opposite segments)"),"7.6 m (25 ft)");
  assert.equal(ctx.compactFutureInvestMeasurement("≈ 8.5 m (Measured from CAD outline through fitted paper scale)"),"≈8.5 m");
  assert.equal(ctx.compactFutureInvestMeasurement("5.3 m (18 ft)"),"5.3 m (18 ft)");
});

test("Compact irregular edge list removes redundant source commentary while keeping all six distinct edge values",()=>{
  const ctx=customerHelpers(active);
  const raw="CAD Edge 1: 18.3 m (60 ft); CAD Edge 2: 10 m (33 ft); CAD Edge 3: 6.1 m (20 ft); CAD Edge 4: 4.5 m (15 ft); CAD Edge 5: 8.6 m (28 ft); CAD Edge 6: 5.3 m (18 ft)";
  assert.equal(ctx.compactFutureInvestEdgeList(raw),"1: 18.3 m · 2: 10 m · 3: 6.1 m · 4: 4.5 m · 5: 8.6 m · 6: 5.3 m");
  assert.equal(ctx.compactFutureInvestEdgeList("CAD Edge 1: source measurement unclear; CAD Edge 2: 7.6 m (25 ft)"),"2: 7.6 m");
});

test("Visual cleanup is restricted to Future Invest Realty and never mutates source or database",()=>{
  const ctx=customerHelpers("another-project-id");
  assert.equal(ctx.futureInvestCompactFacts(),false);
  assert.match(html,/if\(futureInvestCompactFacts\(\)\)\{/);
  assert.match(html,/if\(dimsRow\)dimsRow\.style\.display=compact\?'none':''/);
  assert.match(html,/const compactSideText=compact&&p\.points\.length>4\?compactFutureInvestEdgeList\(semantic\.sides\):''/);
  assert.match(html,/const sideText=compact\?compactSideText:semantic\.sides/);
  assert.match(html,/if\(sideValue\)sideValue\.textContent=threeSide\?'—':sideText\|\|'—'/);
  assert.match(html,/dimensions=futureInvestCompactFacts\(\)\?'':String\(p\.dimensions\|\|''\)\.trim\(\)/);
});
