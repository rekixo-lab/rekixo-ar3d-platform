import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const viewer=readFileSync("public/project/index.html","utf8");
const renderer=viewer.slice(viewer.indexOf("function prepareOriginalMasterplan("),
  viewer.indexOf("function displaySize(){"));

test("client websites use one original source and one viewport canvas, including Metro",()=>{
  assert.match(viewer,/REKIXO_ORIGINAL_ONLY_2D_VIEWPORT_V1/);
  assert.match(viewer,/\.master-original-canvas\{position:absolute/);
  assert.doesNotMatch(viewer,/className='master-native-tiles'/);
  assert.doesNotMatch(viewer,/className='master-native-tile'/);
  assert.match(renderer,/const pixelRatio=Math.min/);
  assert.match(renderer,/Math\.sqrt\(8000000\/\(vw\*vh\)\)/);
  assert.match(renderer,/context\.drawImage\(master,sx,sy,ex-sx,ey-sy,sx,sy,ex-sx,ey-sy\)/);
  assert.match(renderer,/refreshNativeMasterplan=draw/);
  assert.doesNotMatch(renderer,/new Image\(|new Map\(|createDocumentFragment/);
});

test("boot screen remains until the original is verified, decoded, and drawn",()=>{
  assert.match(viewer,/id="rekixoLoadingScreen"/);
  assert.match(viewer,/id="rekixoLoadingTrack"/);
  assert.doesNotMatch(viewer,/Loading original masterplan…/);
  assert.match(viewer,/prepareOriginalMasterplan\(\s*master,originalMasterUrl/);
  assert.match(renderer,/probe\.searchParams\.set\('inspect','1'\)/);
  assert.match(renderer,/if\(metadata\.original!==true\)\{unavailable\(\);return;\}/);
  assert.match(renderer,/await master\.decode\(\)/);
  assert.match(viewer,/\/\/ Reset draws the original canvas BEFORE exposing the customer page/);
  assert.match(renderer,/master\.style\.visibility='hidden'/);
});

test("original crop and plot transform use the unchanged canonical geometry",()=>{
  assert.match(renderer,/rotateOffset\(\(x-vw\/2-pan\.x\)\/scale/);
  assert.match(renderer,/context\.setTransform\(pixelRatio\*a\*cos,pixelRatio\*a\*sin/);
  assert.match(viewer,/svg\.setAttribute\('viewBox',`0 0 \$\{W\} \$\{H\}`\)/);
  assert.match(viewer,/const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
  assert.match(viewer,/const ctm=svg\.getScreenCTM\?\.\(\)/);
  assert.match(viewer,/world\.style\.transform = `translate3d\(/);
});
