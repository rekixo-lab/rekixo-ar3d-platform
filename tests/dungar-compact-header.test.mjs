import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const html=readFileSync("public/project/index.html","utf8");

test("Dungar header geometry is gated by exact existing published project slug",()=>{
  assert.match(html,/DUNGAR_COMPACT_HEADER_SUBTITLE_V1/);
  assert.match(html,/if\(REKIXO_PROJECT_SLUG==='hree-dungar-residency-9176ee'\)document\.body\.classList\.add\('dungar-compact-header'\)/);
  assert.match(html,/document\.body\.classList\.toggle\('dungar-compact-header',[\s\S]*?String\(data\.slug\|\|REKIXO_PROJECT_SLUG\|\|''\)\.trim\(\)==='hree-dungar-residency-9176ee'/);
  assert.match(html,/body\.dungar-compact-header \.app\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(html,/body\.dungar-compact-header \.header\{box-sizing:border-box;min-width:0;max-width:100%;width:100%\}/);
  assert.match(html,/body\.dungar-compact-header \.brandrow\{min-width:0;max-width:100%;overflow:visible\}/);
  assert.match(html,/body\.dungar-compact-header \.brand\{min-width:0;flex:1 1 0;max-width:100%;overflow:hidden\}/);
  assert.match(html,/body\.dungar-compact-header \.head-actions\{flex:0 0 auto;flex-shrink:0;z-index:3\}/);
});

test("Dungar subtitle remains clipped, half-viewport at every breakpoint and action-safe",()=>{
  assert.match(html,/body\.dungar-compact-header \.brand-subtitle\{[\s\S]*?width:var\(--rekixo-subtitle-lane-width,50vw\);max-width:100%/);
  assert.match(html,/const dungarCompact=document\.body\.classList\.contains\('dungar-compact-header'\)/);
  assert.match(html,/if\(viewportWidth>700&&!dungarCompact\)/);
  assert.match(html,/const halfScreenRight=viewportLeft\+\(viewportWidth\*\.5\)/);
  assert.match(html,/const actionsLeft=dungarCompact\?document\.querySelector\('\.head-actions'\)\?\.getBoundingClientRect\(\)\.left:null/);
  assert.match(html,/const laneWidth=Math\.max\(0,Math\.min\(parentWidth,leftHalfSpace,actionSafeSpace\)\)/);
  assert.match(html,/subtitleLane\.style\.setProperty\('--rekixo-subtitle-lane-width',laneWidth\+'px'\)/);
  assert.match(html,/\.brand-subtitle\.is-overflowing \.brand-subtitle-track\{animation:rekixo-subtitle-pan/);
  assert.match(html,/subtitleDesktopAnimation=subtitleTrack\.animate\(/);
});

test("Only header rendering is modified; plot mapping, phone and WhatsApp remain unchanged",()=>{
  assert.match(html,/function setMapDimensions\(width,height\)/);
  assert.match(html,/const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
  assert.match(html,/id="callTop"/);
  assert.match(html,/id="outlineTop"/);
  assert.match(html,/id="waTop"/);
  assert.match(html,/function setBrandSubtitle\(value\)/);
});
