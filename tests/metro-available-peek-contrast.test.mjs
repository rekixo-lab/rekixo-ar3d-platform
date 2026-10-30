import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync("public/project/index.html","utf8");
const styles=html.slice(0,html.indexOf("</style>"));
const rule=(selector)=>{
 const start=styles.indexOf(selector+"{");
 assert.ok(start>=0,"Missing CSS rule for "+selector);
 const end=styles.indexOf("}",start);
 assert.ok(end>start);
 return styles.slice(start+selector.length+1,end);
};
const luminance=hex=>{
 const rgb=hex.slice(1).match(/../g).map(s=>parseInt(s,16)/255);
 const lin=rgb.map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 return .2126*lin[0]+.7152*lin[1]+.0722*lin[2];
};

test("Metro Available plot peek uses dark text on white badge with accessible contrast",()=>{
 const scope='body[data-metro-four-status="1"] .plot-peek[data-metro-visual="available"]';
 assert.match(rule(scope),/--peek-rgb:\s*255,255,255/);
 const color=rule(scope+" .plot-peek__badge").match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
 assert.ok(color,"Available badge needs explicit dark text override");
 const contrast=1.05/(luminance(color)+.05);
 assert.ok(contrast>=7,"Available badge contrast should be >= 7:1; got "+contrast.toFixed(2));
 assert.match(rule(".plot-peek__badge"),/background:\s*rgb\(var\(--peek-rgb\)\)/);
 assert.match(rule(".plot-peek__badge"),/color:\s*#fff/);
});

test("Metro Available override leaves Booked, Registered, Agreement and other projects untouched",()=>{
 assert.match(rule('body[data-metro-four-status="1"] .plot-peek[data-metro-visual="booked"]'),/--peek-rgb:255,210,26/);
 assert.match(rule('body[data-metro-four-status="1"] .plot-peek[data-metro-visual="registered"]'),/--peek-rgb:30,212,107/);
 assert.match(rule('body[data-metro-four-status="1"] .plot-peek[data-metro-visual="agreement"]'),/--peek-rgb:255,48,48/);
 assert.match(rule('body[data-metro-four-status="1"] .plot-peek[data-metro-visual="agreement"] .plot-peek__badge'),/color:#fff/);
 assert.match(html,/card\.dataset\.metroVisual=metroVisualStatus\(p\)/);
 assert.match(html,/plotPeekRefs\.badge\.textContent=statusDisplayLabel\(st\)\.toUpperCase\(\)/);
});
