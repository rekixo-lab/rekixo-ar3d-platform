import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const html = await readFile(new URL("../public/project/index.html", import.meta.url), "utf8");
const three = await readFile(new URL("../public/project/three-view.js", import.meta.url), "utf8");
const mapSource = html.slice(html.indexOf("  function setMapDimensions("), html.indexOf("  // The metadata probe is tiny."));
const originalSource = html.slice(html.indexOf("  function prepareOriginalMasterplan("), html.indexOf("  function displaySize("));

function originalHarness({ available=true,drawFailure=false }={}) {
  const requests=[],draws=[],canvases=[],boot=[],source={value:available};
  const context={
    setTransform(){},clearRect(){},
    drawImage(...args){if(drawFailure)throw Error("canvas display failed");draws.push(args)},
  };
  const master={
    dataset:{},style:{visibility:"hidden"},naturalWidth:12000,naturalHeight:6000,
    decoding:"async",decode:async()=>{},src:"",onload:null,onerror:null,
  };
  const sandbox={
    AbortController,URL,Math,Number,
    location:{href:"https://example.test/project/index.html"},
    fetch:async()=>{requests.push("inspect");return {ok:true,json:async()=>({original:source.value})}},
    window:{devicePixelRatio:2},master,mode3D:false,refreshNativeMasterplan:()=>{},
    viewport:{
      clientWidth:390,clientHeight:844,
      insertBefore:(element)=>canvases.push(element),
    },
    world:{},W:1200,H:600,scale:1,pan:{x:0,y:0},publicRotation:0,
    rotateOffset:(x,y)=>({x,y}),
    rekixoBootState:(...args)=>boot.push(args),
    paintMetroPolygons:()=>{},
    document:{createElement:()=>({
      width:0,height:0,className:"",setAttribute(){},remove(){},addEventListener(){},
      getContext:()=>context,
    })},
  };
  vm.runInNewContext(originalSource,sandbox);
  return {sandbox,master,source,requests,draws,canvases,boot};
}

test("giant raster dimensions preserve aspect and normalized plot positions", () => {
  const writes=[],master={};
  const sandbox={W:1200,H:2133,
    document:{documentElement:{style:{setProperty:(...args)=>writes.push(args)}}},
    world:{style:{}},q:()=>master,svg:{setAttribute:(...args)=>writes.push(args)},
  };
  vm.runInNewContext(mapSource,sandbox);
  sandbox.setMapDimensions(16000,8000);
  assert.equal(sandbox.W,10000);
  assert.equal(sandbox.H,5000);
  assert.equal(sandbox.W/sandbox.H,2);
  assert.equal(master.width/master.height,2);
  assert.deepEqual([.25*sandbox.W,.75*sandbox.H],[2500,3750]);
  sandbox.setMapDimensions(Infinity,NaN);
  assert.equal(sandbox.W,1200);
  assert.equal(sandbox.H,2133);
});

test("published original is decoded before reveal and raster comes from one canvas",async()=>{
  const h=originalHarness(),ready=[],fallback=[];
  h.sandbox.prepareOriginalMasterplan(h.master,"original.png",2,
    ()=>ready.push(true),()=>fallback.push(true));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.master.src,"original.png");
  assert.equal(h.canvases.length,0,"boot remains until decoding");
  await h.master.onload();
  assert.equal(h.canvases.length,1,"one canvas rather than many native canvas tiles");
  assert.equal(h.master.style.visibility,"hidden");
  assert.equal(h.master.dataset.originalSrc,"original.png");
  assert.equal(h.master.dataset.previewSrc,"");
  assert.deepEqual(ready,[true]);
  assert.deepEqual(fallback,[]);
  assert.equal(h.sandbox.refreshNativeMasterplan(),true);
  assert.equal(h.draws.length,1);
  assert.equal(h.draws[0][0],h.master,"always sample from the same original");
  assert.equal(h.draws[0][1],h.draws[0][5],
    "source crop and destination use the same unmodified coordinates");
  assert.equal(h.draws[0][2],h.draws[0][6]);
  assert.ok(h.canvases[0].width*h.canvases[0].height<=8000000+20000);
  assert.doesNotMatch(originalSource,/setMapDimensions|rescaleNormalizedPlots|reset\(/);
});

test("unavailable or mismatched originals use an explicit legacy fallback",async()=>{
  const h=originalHarness({available:false}),fallback=[];
  h.sandbox.prepareOriginalMasterplan(h.master,"original.png",2,()=>assert.fail(),()=>fallback.push(true));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fallback,[true]);
  assert.equal(h.master.src,"");
  assert.equal(h.canvases.length,0);
  const wrong=originalHarness(),other=[];
  wrong.sandbox.prepareOriginalMasterplan(wrong.master,"original.png",1,()=>assert.fail(),()=>other.push(true));
  await new Promise(resolve=>setImmediate(resolve));
  await wrong.master.onload();
  assert.deepEqual(other,[true]);
  assert.equal(wrong.canvases.length,0);
});

test("render failure does not show corrupted original pixels",async()=>{
  const h=originalHarness({drawFailure:true});
  h.sandbox.prepareOriginalMasterplan(h.master,"original.png",2,()=>{},()=>assert.fail());
  await new Promise(resolve=>setImmediate(resolve));
  await h.master.onload();
  assert.equal(h.sandbox.refreshNativeMasterplan(),false);
  assert.ok(h.boot.some(([state])=>state==="error"));
});

function threeHarness() {
  const requests = [], uploads = [], crops = [], deletes = [];
  const gl = {
    MAX_TEXTURE_SIZE: 1, NO_ERROR: 0, TEXTURE_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4,
    getParameter: () => 2048, getError: () => 0,
    createTexture: () => ({}), deleteTexture: t => deletes.push(t), deleteBuffer() {},
    bindTexture() {}, pixelStorei() {}, texParameteri() {},
    texImage2D: (...args) => uploads.push(args.at(-1)),
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
  };
  const sandbox = {
    window: {}, navigator: { deviceMemory: 4 }, matchMedia: () => ({ matches: true }), setTimeout: f => f(),
    Image: class { constructor() { requests.push(this); } },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (...args) => crops.push(args) }) }) },
  };
  vm.runInNewContext(three, sandbox);
  const engine = Object.create(sandbox.window.RekixoPlot3D.prototype);
  Object.assign(engine, {
    gl, imageSrc: "original.png", previewImageSrc: "", textureGeneration: 0,
    texturePlan: null, textureFailed: false, loading: { style: {} }, request() {},
  });
  return { sandbox, engine, gl, requests, uploads, crops, deletes };
}

test("giant originals are divided into native-resolution GPU-safe tiles", () => {
  const h = threeHarness();
  h.engine.texture();
  const image = h.requests[0];
  image.naturalWidth = 16000; image.naturalHeight = 8000; image.onload();
  assert.equal(h.uploads.length, 1, "a missing legacy preview gets a small full-plan base");
  assert.ok(h.uploads.every(source => source !== image), "the giant original must never enter texImage2D as a single image");
  const tiles = h.engine.texturePlan.tiles;
  assert.equal(tiles.reduce((n, t) => n + t.w * t.h, 0), 16000 * 8000);
  assert.ok(tiles.every(t => t.sw <= 2048 && t.sh <= 2048));
  assert.ok(tiles.every(t => t.sw >= t.w && t.sh >= t.h));
  assert.equal(h.engine.texturePixelBudget, 8 * 1024 * 1024);
});

test("visible original tiles upload one per frame at one source pixel per texture pixel", () => {
  const h = threeHarness();
  Object.assign(h.engine, {
    worldW: 2, worldH: 1,
    P: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
    V: [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1],
    drawPlanTexture() {},
  });
  h.engine.texture();
  const image = h.requests[0]; image.naturalWidth = 12000; image.naturalHeight = 6000; image.onload();
  const uploadsBefore = h.uploads.length, cropsBefore = h.crops.length;
  h.engine.renderTextureTiles();
  assert.equal(h.uploads.length, uploadsBefore + 1);
  const first = h.crops[cropsBefore];
  assert.equal(first[3], first[7]); assert.equal(first[4], first[8]);
  for (let i = 0; i < 10; i++) h.engine.renderTextureTiles();
  const residentPixels = h.engine.texturePlan.tiles.filter(t => t.tex).reduce((n, t) => n + t.pixels, 0);
  assert.ok(residentPixels <= h.engine.texturePixelBudget);
  assert.ok(h.uploads.length >= uploadsBefore + 2);
  assert.ok(h.uploads.every(source => source !== image));
});

test("stale image loads cannot overwrite a newer 3D source", () => {
  const h = threeHarness();
  h.engine.texture();
  h.engine.imageSrc = "new-original.png"; h.engine.texture();
  const stale = h.requests[0]; stale.naturalWidth = 1200; stale.naturalHeight = 600; stale.onload();
  assert.equal(h.uploads.length, 0);
  const fresh = h.requests[1]; fresh.naturalWidth = 1200; fresh.naturalHeight = 600; fresh.onload();
  assert.equal(h.uploads.length, 1);
});


test("a thrown native texture upload releases its allocation exactly once", () => {
  const h = threeHarness();
  h.gl.texImage2D = () => { throw new Error("GPU memory exhausted"); };
  assert.throws(() => h.engine.uploadTexture({}), /GPU memory exhausted/);
  assert.equal(h.deletes.length, 1);
});
