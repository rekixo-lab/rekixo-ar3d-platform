import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html=await readFile(new URL("../public/project/index.html",import.meta.url),"utf8");
const begin=html.indexOf("function prepareOriginalMasterplan(");
const end=html.indexOf("function displaySize(){",begin);
const render=html.slice(begin,end);

test("every customer 2D original uses a single decoded source and canvas",()=>{
  assert.match(html,/REKIXO_ORIGINAL_ONLY_2D_VIEWPORT_V1/);
  assert.match(render,/master\.src=src/);
  assert.match(render,/canvas\.className='master-original-canvas'/);
  assert.match(render,/viewport\.insertBefore\(canvas,world\)/);
  assert.match(render,/master\.style\.visibility='hidden'/);
  assert.doesNotMatch(html,/master-native-tiles|master-native-tile/);
  assert.doesNotMatch(render,/new Image\(|createDocumentFragment|tiles=new Map/);
});

test("source pixels are drawn at the physical viewport resolution with no intermediate preview",()=>{
  assert.match(render,/pixelRatio=Math\.min/);
  assert.match(render,/Math\.sqrt\(8000000\/\(vw\*vh\)\)/);
  assert.match(render,/context\.drawImage\(master,sx,sy,ex-sx,ey-sy,sx,sy,ex-sx,ey-sy\)/);
  assert.match(render,/canvas\.getContext\('2d',\{alpha:true\}\)/);
  assert.doesNotMatch(render,/imageSmoothingQuality\s*=|source\.width\s*=|preview\.src=/);
});

test("plot coordinate plane and pan/zoom/rotation remain unchanged",()=>{
  assert.match(html,/refreshNativeMasterplan\(\);/);
  assert.match(render,/rotateOffset\(\(x-vw\/2-pan\.x\)\/scale/);
  assert.match(render,/context\.setTransform\(pixelRatio\*a\*cos/);
  assert.match(html,/svg\.setAttribute\('viewBox',`0 0 \$\{W\} \$\{H\}`\)/);
  assert.match(html,/world\.style\.transform = `translate3d\(/);
});

test("only missing published originals use canonical fallback; 3D starts with the original",()=>{
  assert.match(render,/if\(metadata\.original!==true\)\{unavailable\(\);return;\}/);
  assert.match(html,/const legacyOnly=\(\)=>\{/);
  assert.match(html,/loadMaster\(true,false\)/);
  assert.match(html,/imageSrc:q\('\.master'\)\.dataset\.originalSrc\|\|q\('\.master'\)\.src/);
  assert.match(html,/previewImageSrc:''/);
});
