import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html=await readFile(new URL("../public/project/index.html",import.meta.url),"utf8");
const functionStart=html.indexOf("function upgradeMasterplanImage(");
const functionEnd=html.indexOf("function displaySize(){",functionStart);
const upgrade=html.slice(functionStart,functionEnd);

test("customer masterplan always retains a visible preview during original upgrade",()=>{
  assert.match(html,/REKIXO_NATIVE_2D_MASTERPLAN_TILES_V1/);
  assert.match(upgrade,/master\.parentNode\.insertBefore\(layer,svg\)/);
  assert.match(upgrade,/layer\.className='master-native-tiles'/);
  assert.doesNotMatch(upgrade,/master\.src\s*=/);
  assert.match(upgrade,/master\.dataset\.originalSrc=src/);
});

test("original pixels are cropped into bounded transparent canvases",()=>{
  assert.match(upgrade,/tileSize=1536/);
  assert.match(upgrade,/ctx\.drawImage\(image,x,y,width,height,0,0,canvas\.width,canvas\.height\)/);
  assert.match(upgrade,/canvas\.className='master-native-tile'/);
  assert.match(upgrade,/density=Math\.min\(1,Math\.pow\(2,Math\.ceil\(Math\.log2\(required\)\)\)\)/);
  assert.match(upgrade,/canvas\.style\.width=\(100\*width\/image\.naturalWidth\)/);
});

test("original overlay follows pan zoom rotation without changing logical geometry",()=>{
  assert.match(html,/refreshNativeMasterplan\(\);/);
  assert.match(upgrade,/const pt=rotateOffset\(dx,dy,\(4-publicRotation\)%4\)/);
  assert.match(upgrade,/scale\*W\/image\.naturalWidth/);
  assert.match(upgrade,/for\(const \[key,canvas\] of tiles\)/);
  assert.match(html,/svg\.setAttribute\('viewBox',`0 0 \$\{W\} \$\{H\}`\)/);
});

test("missing original or failure keeps preview, and 3D uses original when available",()=>{
  assert.match(upgrade,/if\(result\.original!==true\)/);
  assert.match(upgrade,/Preview is retained/);
  assert.match(upgrade,/Native masterplan tile render failed; keeping preview/);
  assert.match(html,/imageSrc:q\('\.master'\)\.dataset\.originalSrc\|\|q\('\.master'\)\.src/);
  assert.match(html,/onUpgrade\?\.\(src\)/);
});
