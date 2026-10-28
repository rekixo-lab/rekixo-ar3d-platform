import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const viewer=readFileSync("public/project/index.html","utf8");
const tileCode=viewer.slice(viewer.indexOf("function upgradeMasterplanImage("),viewer.indexOf("function displaySize(){"));
test("Metro Samsung mobile safety only: other projects keep existing original tiling",()=>{
 assert.match(viewer,/metroMobileTileSafety=data\.projectId==='c024a562-634d-4e49-b647-43209f6e450b'/);
 assert.match(tileCode,/safeMobileTiles=typeof metroMobileTileSafety!==\x27undefined\x27&&metroMobileTileSafety&&window\.matchMedia/);
 assert.match(tileCode,/const tileStep=safeMobileTiles\?1024:tileSize/);
 assert.match(tileCode,/const tiles=new Map\(\),tileSize=1536/);
 assert.match(tileCode,/else\{\s*ctx\.drawImage\(image,x,y,width,height,0,0,canvas\.width,canvas\.height\)/);
});
test("Original HD pixel gutters overlap source crops in same coordinate plane without preview rewrites",()=>{
 assert.match(tileCode,/mobileGutter=safeMobileTiles/);
 assert.match(tileCode,/Math\.min\(64,Math\.max\(2,/);
 assert.match(tileCode,/srcX=safeMobileTiles\?Math\.max\(0,x-mobileGutter\):x/);
 assert.match(tileCode,/srcRight=safeMobileTiles\?Math\.min\(image\.naturalWidth,x\+width\+mobileGutter\)/);
 assert.match(tileCode,/ctx\.drawImage\(image,srcX,srcY,srcWidth,srcHeight,0,0,canvas\.width,canvas\.height\)/);
 assert.match(tileCode,/canvas\.style\.left=\(100\*srcX\/image\.naturalWidth\)/);
 assert.match(tileCode,/canvas\.style\.width=\(100\*srcWidth\/image\.naturalWidth\)/);
 assert.doesNotMatch(tileCode,/master\.src\s*=/);
});
test("Only fully prepared mobile tiles are committed; GPU failure removes HD overlay, not plots",()=>{
 assert.match(tileCode,/const needed=new Set\(\),staged=\[\]/);
 assert.match(tileCode,/if\(safeMobileTiles\)staged\.push\(\[key,canvas\]\)/);
 assert.match(tileCode,/document\.createDocumentFragment\(\)/);
 assert.match(tileCode,/fullVisibleCoverage=\[\.\.\.needed\]\.every\(key=>tiles\.has\(key\)\)/);
 assert.match(tileCode,/setMetroSourceVisibility\(fullVisibleCoverage&&tiles\.size>0\)/);
 assert.match(tileCode,/master\.style\.visibility=ready\?'hidden':'visible'/);
 assert.match(tileCode,/setMetroSourceVisibility\(false\)/);
 assert.match(tileCode,/safeTileFailed=true/);
 assert.match(tileCode,/layer\.style\.visibility='hidden'/);
 assert.match(tileCode,/setMasterplanQuality\('preview','Preview only'/);
});
test("canonical polygons, SVG alignment and mobile hit-testing remain unchanged",()=>{
 assert.match(viewer,/svg\.setAttribute\('viewBox',\`0 0 \$\{W\} \$\{H\}\`\)/);
 assert.match(viewer,/const mapped=normalized\.map\(\(\[x,y\]\)=>\[x\*W,y\*H\]\)/);
 assert.match(viewer,/const ctm=svg\.getScreenCTM\?\.\(\)/);
 assert.match(viewer,/local=point\.matrixTransform\(ctm\.inverse\(\)\)/);
 assert.match(viewer,/world\.style\.transform = \`translate3d\(/);
 assert.match(viewer,/REKIXO_NATIVE_2D_MASTERPLAN_TILES_V1/);
});