(() => {
'use strict';
const DEFAULT_IMG_W=1200,DEFAULT_IMG_H=2133,BASE_UNIT=.01;
const REFERENCE_WORLD_DIAGONAL=Math.hypot(DEFAULT_IMG_W,DEFAULT_IMG_H)*BASE_UNIT,LABEL_SCREEN_LIFT_PX=7;
function worldUnitFor(imgW,imgH){const w=Math.max(1,Number(imgW)||DEFAULT_IMG_W),h=Math.max(1,Number(imgH)||DEFAULT_IMG_H),diag=Math.hypot(w,h);return REFERENCE_WORLD_DIAGONAL/diag}
function cameraMetrics(worldW,worldH){const diag=Math.max(.001,Math.hypot(worldW,worldH)),baseDistance=diag*1.2;return{diag,baseDistance,minDistance:diag*(7/REFERENCE_WORLD_DIAGONAL),maxDistance:diag*(46/REFERENCE_WORLD_DIAGONAL),nearPlane:Math.max(.02,diag*.004),farPlane:Math.max(100,diag*4.5)}}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// REKIXO_REFERENCE_STATUS_PARITY_V1
const statusOf=p=>{const s=String(p?.status||'available').trim().toLowerCase();return s==='enquire'?'available':(s==='booked'?'booked':(s==='sold'?'sold':'available'))};
const STATUS_OVERLAY_DARKEN=.80;
const dimStatus=c=>[c[0]*STATUS_OVERLAY_DARKEN,c[1]*STATUS_OVERLAY_DARKEN,c[2]*STATUS_OVERLAY_DARKEN,c[3]];
const statusPalette=st=>st==='sold'?{top:dimStatus([.94,.08,.15,.52]),side:dimStatus([.72,.035,.09,.76]),edge:dimStatus([1,.22,.30,.98])}:st==='booked'?{top:dimStatus([.98,.68,.04,.48]),side:dimStatus([.72,.46,.02,.74]),edge:dimStatus([1,.79,.20,.98])}:{top:dimStatus([.02,.82,.37,.46]),side:dimStatus([.01,.62,.27,.72]),edge:dimStatus([.17,1,.55,.98])};
/* REKIXO_SELECTED_3D_FOCUS_FX_V1_1\n   REKIXO_SELECTED_FOCUS_BRIGHTNESS_V2\n   Selected-only luminance boost; palette and geometry stay unchanged. */
const lightenStatus=(c,m)=>[c[0]+(1-c[0])*m,c[1]+(1-c[1])*m,c[2]+(1-c[2])*m,Math.min(1,c[3]+m*.08)];
const animationNow=()=>globalThis.performance&&typeof globalThis.performance.now==='function'?globalThis.performance.now():Date.now();
function mul4v(m,v){return[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]*v[3],m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3]]}
const V={add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len:a=>Math.hypot(a[0],a[1],a[2]),norm:a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]}};
function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,(2*far*near)*nf,0])}
function lookAt(eye,center,up){const z=V.norm(V.sub(eye,center)),x=V.norm(V.cross(up,z)),y=V.cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-V.dot(x,eye),-V.dot(y,eye),-V.dot(z,eye),1])}
function area(p){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1]}return a/2}
const c2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function inTri(p,a,b,c){const x=c2(a,b,p),y=c2(b,c,p),z=c2(c,a,p),neg=x<0||y<0||z<0,pos=x>0||y>0||z>0;return!(neg&&pos)}
function triangulate(points){if(points.length<3)return[];let v=points.map(p=>[+p[0],+p[1]]);if(area(v)<0)v.reverse();const out=[];let guard=0;while(v.length>3&&guard++<100){let found=false;for(let i=0;i<v.length;i++){const a=v[(i-1+v.length)%v.length],b=v[i],c=v[(i+1)%v.length];if(c2(a,b,c)<=1e-8)continue;let has=false;for(let j=0;j<v.length;j++){if(j===i||j===(i-1+v.length)%v.length||j===(i+1)%v.length)continue;if(inTri(v[j],a,b,c)){has=true;break}}if(has)continue;out.push([a,b,c]);v.splice(i,1);found=true;break}if(!found)break}if(v.length===3)out.push([v[0],v[1],v[2]]);if(!out.length)for(let i=1;i<points.length-1;i++)out.push([points[0],points[i],points[i+1]]);return out}
function inside(x,y,p){let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if(((a[1]>y)!=(b[1]>y))&&(x<(b[0]-a[0])*(y-a[1])/((b[1]-a[1])||1e-9)+a[0]))yes=!yes}return yes}
function plotLabelPoint(p){const pts=Array.isArray(p?.points)?p.points:[];const shared=globalThis.RekixoProjectGeometry?.labelPoint;if(typeof shared==='function'){const c=shared(pts);if(Array.isArray(c)&&c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1]))return c}if(p&&Array.isArray(p.center)&&p.center.length>=2&&Number.isFinite(p.center[0])&&Number.isFinite(p.center[1]))return p.center;if(pts.length)return[pts.reduce((sum,v)=>sum+Number(v[0]||0),0)/pts.length,pts.reduce((sum,v)=>sum+Number(v[1]||0),0)/pts.length];return[0,0]}
function shader(gl,t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(o));return o}
function prog(gl,v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p}
function buf(gl,a){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);return b}
// One-pixel gutters preserve linear filtering at native-resolution tile boundaries.
function textureTiles(width,height,maxSize){
 const edge=Math.max(1,Math.min(2048,Math.floor(maxSize))-2),tiles=[];
 for(let y=0;y<height;y+=edge)for(let x=0;x<width;x+=edge){
  const w=Math.min(edge,width-x),h=Math.min(edge,height-y),sx=Math.max(0,x-1),sy=Math.max(0,y-1),sw=Math.min(width,x+w+1)-sx,sh=Math.min(height,y+h+1)-sy;
  tiles.push({x,y,w,h,sx,sy,sw,sh,pixels:sw*sh,tex:null,b:null});
 }
 return tiles;
}
class RekixoPlot3D{
 constructor(host,opt={}){this.host=host;this.plots=opt.plots||[];this.onSelect=opt.onSelect||(()=>{});this.onPreview=opt.onPreview||(()=>{});this.onPreviewEnd=opt.onPreviewEnd||(()=>{});this.onCamera=opt.onCamera||(()=>{});this.previewPlotId=null;this.longPressTimer=0;this.longPressPointerId=null;this.longPressShown=false;this.imageSrc=opt.imageSrc||'masterplan.jpg';this.previewImageSrc=opt.previewImageSrc||'';this.textureGeneration=0;this.texturePlan=null;this.textureFailed=false;this.imgW=Math.max(100,Number(opt.mapWidth)||DEFAULT_IMG_W);this.imgH=Math.max(100,Number(opt.mapHeight)||DEFAULT_IMG_H);this.unit=worldUnitFor(this.imgW,this.imgH);this.worldW=this.imgW*this.unit;this.worldH=this.imgH*this.unit;this.byId=new Map(this.plots.map(p=>[p.id,p]));this.active=false;this.showAll=false;this.statusFilter=null;this.selected=null;this.sel=null;this.flat=new Map();const camera=cameraMetrics(this.worldW,this.worldH);this.worldDiag=camera.diag;this.baseDistance=camera.baseDistance;this.minDistance=camera.minDistance;this.maxDistance=camera.maxDistance;this.nearPlane=camera.nearPlane;this.farPlane=camera.farPlane;this.cam={yaw:-.38,polar:.76,distance:this.baseDistance,target:[0,0,0]};this.def=JSON.parse(JSON.stringify(this.cam));this.fov=44*Math.PI/180;this.ptr=new Map();this.g=null;this.dpr=Math.min(devicePixelRatio||1,1.5);this.raf=0;this.motionReduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.selectionFxStart=animationNow();this.fxLast=0;host.innerHTML='<canvas class="three-canvas" aria-label="3D masterplan"></canvas><div class="three-label-layer" aria-hidden="true"></div><div class="three-loading">Preparing 3D view…</div>';this.canvas=host.querySelector('canvas');this.labelLayer=host.querySelector('.three-label-layer');this.loading=host.querySelector('.three-loading');this.gl=this.canvas.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});if(!this.gl)throw Error('WebGL unavailable');this.rebuildLabels();this.init();this.bind();this.texture()}
 init(){const gl=this.gl,vs='attribute vec3 aPos;uniform mat4 uProj,uView;varying vec3 vPos;void main(){vPos=aPos;gl_Position=uProj*uView*vec4(aPos,1.0);}';this.cp=prog(gl,vs,'precision mediump float;uniform vec4 uColor;uniform float uFxTime,uFxMix;varying vec3 vPos;void main(){float wave=.5+.5*sin((vPos.x+vPos.z)*1.15-uFxTime*3.8);float sweep=smoothstep(.72,1.0,wave)*uFxMix;float glow=min(1.0,sweep*1.65);vec3 lit=mix(uColor.rgb,vec3(1.0),glow);gl_FragColor=vec4(lit,uColor.a);}');this.cl={p:gl.getAttribLocation(this.cp,'aPos'),P:gl.getUniformLocation(this.cp,'uProj'),V:gl.getUniformLocation(this.cp,'uView'),c:gl.getUniformLocation(this.cp,'uColor'),t:gl.getUniformLocation(this.cp,'uFxTime'),m:gl.getUniformLocation(this.cp,'uFxMix')};this.tp=prog(gl,'attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uProj,uView;varying vec2 uv;void main(){uv=aUV;gl_Position=uProj*uView*vec4(aPos,1.0);}','precision mediump float;uniform sampler2D uTex;varying vec2 uv;void main(){vec4 c=texture2D(uTex,uv);c.rgb=pow(c.rgb,vec3(.97));gl_FragColor=c;}');this.tl={p:gl.getAttribLocation(this.tp,'aPos'),u:gl.getAttribLocation(this.tp,'aUV'),P:gl.getUniformLocation(this.tp,'uProj'),V:gl.getUniformLocation(this.tp,'uView'),t:gl.getUniformLocation(this.tp,'uTex')};const w=this.worldW/2,h=this.worldH/2;this.gbuf=buf(gl,[-w,0,-h,0,1,w,0,-h,1,1,w,0,h,1,0,-w,0,-h,0,1,w,0,h,1,0,-w,0,h,0,0]);const c=[[-w,-h],[w,-h],[w,h],[-w,h]],s=[];for(let i=0;i<4;i++){const a=c[i],b=c[(i+1)%4];s.push(a[0],-.18,a[1],b[0],-.18,b[1],b[0],0,b[1],a[0],-.18,a[1],b[0],0,b[1],a[0],0,a[1])}this.side=buf(gl,s);this.sideN=s.length/3;gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(.008,.015,.032,1)}
 texture(){
  const gl=this.gl,generation=++this.textureGeneration,desired=this.imageSrc;
  const maxSize=Math.max(1,Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))||2048);
  const constrained=matchMedia('(any-pointer: coarse)').matches||(Number(navigator.deviceMemory)>0&&Number(navigator.deviceMemory)<=4);
  this.texturePixelBudget=(constrained?8:32)*1024*1024;
  const ready=()=>{this.loading.style.opacity='0';setTimeout(()=>{if(generation===this.textureGeneration)this.loading.style.display='none'},200);this.request()};
  const failed=()=>{if(generation!==this.textureGeneration)return;this.loading.textContent=this.tex?'Original plan is available in 2D':'3D image load nahi hui';this.loading.style.display='block';this.loading.style.opacity='1'};
  const load=(src,preview=false)=>{
   const image=new Image();image.decoding='async';
   image.onload=()=>{
    if(generation!==this.textureGeneration)return;
    try{
     if(preview){
      // A small base remains visible while original tiles arrive or leave the cache.
      const factor=Math.min(1,maxSize/Math.max(image.naturalWidth,image.naturalHeight),Math.sqrt(this.texturePixelBudget/(image.naturalWidth*image.naturalHeight)));
      let source=image;
      if(factor<1){source=document.createElement('canvas');source.width=Math.max(1,Math.floor(image.naturalWidth*factor));source.height=Math.max(1,Math.floor(image.naturalHeight*factor));source.getContext('2d').drawImage(image,0,0,source.width,source.height)}
      const tex=this.uploadTexture(source);if(this.tex)gl.deleteTexture(this.tex);this.tex=tex;ready();load(desired);return;
     }
     this.clearTextureTiles();this.textureFailed=false;
     if(image.naturalWidth<=maxSize&&image.naturalHeight<=maxSize&&image.naturalWidth*image.naturalHeight<=this.texturePixelBudget){
      const tex=this.uploadTexture(image);if(this.tex)gl.deleteTexture(this.tex);this.tex=tex;
     }else{
      if(!this.tex){
       // Even when a legacy preview is missing, cover the full plan under the detail cache.
       const base=document.createElement('canvas'),factor=Math.min(1,Math.min(1024,maxSize)/Math.max(image.naturalWidth,image.naturalHeight));
       base.width=Math.max(1,Math.floor(image.naturalWidth*factor));base.height=Math.max(1,Math.floor(image.naturalHeight*factor));
       base.getContext('2d').drawImage(image,0,0,base.width,base.height);this.tex=this.uploadTexture(base);base.width=1;base.height=1;
      }
      this.texturePlan={image,tiles:textureTiles(image.naturalWidth,image.naturalHeight,maxSize)};
     }
     ready();
    }catch(_error){failed()}
   };
   image.onerror=()=>{if(generation!==this.textureGeneration)return;if(preview)load(desired);else failed()};
   image.src=src;
  };
  if(!this.tex&&this.previewImageSrc&&this.previewImageSrc!==desired)load(this.previewImageSrc,true);else load(desired);
 }
 uploadTexture(source){
  const gl=this.gl,tex=gl.createTexture();if(!tex)throw Error('Texture allocation failed');
  try{
   gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
   // Check the upload itself, without reporting an unrelated earlier WebGL error.
   for(let n=0;n<8&&gl.getError()!==gl.NO_ERROR;n++){}
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
   if(gl.getError()!==gl.NO_ERROR)throw Error('Texture upload failed');
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   return tex;
  }catch(error){gl.deleteTexture(tex);throw error}
 }
 clearTextureTiles(){
  if(!this.texturePlan)return;
  for(const tile of this.texturePlan.tiles){if(tile.tex)this.gl.deleteTexture(tile.tex);if(tile.b)this.gl.deleteBuffer(tile.b)}
  this.texturePlan=null;
 }
 drawPlanTexture(tex,b){
  const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,tex);gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.enableVertexAttribArray(this.tl.p);gl.vertexAttribPointer(this.tl.p,3,gl.FLOAT,false,20,0);
  gl.enableVertexAttribArray(this.tl.u);gl.vertexAttribPointer(this.tl.u,2,gl.FLOAT,false,20,12);gl.drawArrays(gl.TRIANGLES,0,6);
 }
 renderTextureTiles(){
  const plan=this.texturePlan;if(!plan||this.textureFailed)return;
  const gl=this.gl,image=plan.image,visible=[];
  for(const tile of plan.tiles){
   const left=(tile.x/image.naturalWidth-.5)*this.worldW,right=((tile.x+tile.w)/image.naturalWidth-.5)*this.worldW;
   const top=(tile.y/image.naturalHeight-.5)*this.worldH,bottom=((tile.y+tile.h)/image.naturalHeight-.5)*this.worldH;
   const projected=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,z])=>{const view=mul4v(this.V,[x,0,z,1]),clip=mul4v(this.P,view);return[clip[0]/clip[3],clip[1]/clip[3],clip[3]]});
   if(projected.every(p=>p[2]<=0))continue;
   const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]);
   if(Math.max(...xs)<-1||Math.min(...xs)>1||Math.max(...ys)<-1||Math.min(...ys)>1)continue;
   tile.left=left;tile.right=right;tile.top=top;tile.bottom=bottom;
   tile.priority=Math.hypot((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2);visible.push(tile);
  }
  visible.sort((a,b)=>a.priority-b.priority);
  let pixels=0;const wanted=new Set();
  for(const tile of visible){if(pixels+tile.pixels>this.texturePixelBudget)continue;pixels+=tile.pixels;wanted.add(tile)}
  for(const tile of plan.tiles)if(tile.tex&&!wanted.has(tile)){gl.deleteTexture(tile.tex);tile.tex=null}
  let uploaded=false,pending=false;
  for(const tile of visible){
   if(!wanted.has(tile))continue;
   if(!tile.tex){
    if(uploaded){pending=true;continue}
    try{
     const crop=document.createElement('canvas');crop.width=tile.sw;crop.height=tile.sh;
     crop.getContext('2d').drawImage(image,tile.sx,tile.sy,tile.sw,tile.sh,0,0,tile.sw,tile.sh);
     tile.tex=this.uploadTexture(crop);crop.width=1;crop.height=1;uploaded=true;
     if(!tile.b){const l=tile.left,r=tile.right,t=tile.top,b=tile.bottom,u0=(tile.x-tile.sx)/tile.sw,u1=(tile.x+tile.w-tile.sx)/tile.sw,v0=1-(tile.y-tile.sy)/tile.sh,v1=1-(tile.y+tile.h-tile.sy)/tile.sh;tile.b=buf(gl,[l,0,t,u0,v0,r,0,t,u1,v0,r,0,b,u1,v1,l,0,t,u0,v0,r,0,b,u1,v1,l,0,b,u0,v1])}
    }catch(_error){this.textureFailed=true;this.loading.textContent='Original plan is available in 2D';this.loading.style.display='block';this.loading.style.opacity='1';break}
   }
   this.drawPlanTexture(tile.tex,tile.b);
  }
  if(pending)this.request();
 }
 bind(){const c=this.canvas;c.addEventListener('contextmenu',e=>e.preventDefault());c.addEventListener('pointerdown',e=>this.down(e));c.addEventListener('pointermove',e=>this.move(e));c.addEventListener('pointerup',e=>this.up(e,false));c.addEventListener('pointercancel',e=>this.up(e,true));c.addEventListener('pointerleave',e=>{if(!this.ptr.size&&e.pointerType==='mouse')this.endPreview()});c.addEventListener('wheel',e=>{e.preventDefault();this.endPreview();this.cam.distance=clamp(this.cam.distance*(e.deltaY<0?.9:1.1),this.minDistance,this.maxDistance);this.changed()},{passive:false})}
 activate(){this.active=true;this.syncLabelVisibility();this.resize();this.request()} deactivate(){this.cancelLongPress(true);this.endPreview();this.active=false;this.syncLabelVisibility()}
 resize(skipRender=false){const r=this.host.getBoundingClientRect(),w=Math.max(1,Math.round(r.width*this.dpr)),h=Math.max(1,Math.round(r.height*this.dpr));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px'}if(!skipRender)this.request()}
 eye(){const c=this.cam,s=Math.sin(c.polar);return[c.target[0]+c.distance*s*Math.sin(c.yaw),c.target[1]+c.distance*Math.cos(c.polar),c.target[2]+c.distance*s*Math.cos(c.yaw)]}
 changed(){this.onCamera({yaw:this.cam.yaw,zoomPercent:clamp(Math.round(34*this.baseDistance/this.cam.distance),18,100)});this.request()}
 reset(){this.cam=JSON.parse(JSON.stringify(this.def));this.changed()} zoom(f){this.cam.distance=clamp(this.cam.distance*f,this.minDistance,this.maxDistance);this.changed()}
 cancelLongPress(hide=true){if(this.longPressTimer){clearTimeout(this.longPressTimer);this.longPressTimer=0}const shown=this.longPressShown;this.longPressPointerId=null;this.longPressShown=false;if(hide&&shown)this.endPreview();return shown}
 startLongPress(e,p){if(e.pointerType!=='touch'||!p)return;this.cancelLongPress(false);const id=e.pointerId,x=e.clientX,y=e.clientY;this.longPressPointerId=id;this.longPressTimer=setTimeout(()=>{this.longPressTimer=0;if(this.longPressPointerId!==id||!this.ptr.has(id)||this.g?.t!=='orbit'||this.g.id!==id||this.g.m)return;this.longPressShown=true;this.previewPlotId=String(p.id);this.onPreview(p,x,y)},460)}
 endPreview(){if(this.previewPlotId!==null||this.longPressShown)this.onPreviewEnd();this.previewPlotId=null}
 previewAt(x,y){const p=this.hitTest(x,y);if(!p){this.endPreview();return}this.previewPlotId=String(p.id);this.onPreview(p,x,y)}
 down(e){this.canvas.setPointerCapture?.(e.pointerId);this.ptr.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});if(this.ptr.size===1){this.g={t:'orbit',id:e.pointerId,x:e.clientX,y:e.clientY,yaw:this.cam.yaw,pol:this.cam.polar,m:false,slop:(e.pointerType==='touch'||matchMedia('(pointer:coarse)').matches)?12:6};this.startLongPress(e,this.hitTest(e.clientX,e.clientY))}else if(this.ptr.size===2){this.cancelLongPress(true);const[a,b]=[...this.ptr.values()];this.g={t:'pinch',d:Math.hypot(a.x-b.x,a.y-b.y),mid:[(a.x+b.x)/2,(a.y+b.y)/2],dist:this.cam.distance,target:[...this.cam.target],m:true}}}
 move(e){if(!this.ptr.has(e.pointerId)){if(e.pointerType==='mouse'&&e.buttons===0)this.previewAt(e.clientX,e.clientY);return}this.ptr.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});if(this.ptr.size===2){this.cancelLongPress(true);const[a,b]=[...this.ptr.values()],d=Math.max(10,Math.hypot(a.x-b.x,a.y-b.y)),m=[(a.x+b.x)/2,(a.y+b.y)/2];if(!this.g||this.g.t!=='pinch')this.g={t:'pinch',d,mid:m,dist:this.cam.distance,target:[...this.cam.target],m:true};this.cam.distance=clamp(this.g.dist*this.g.d/d,this.minDistance,this.maxDistance);const dx=m[0]-this.g.mid[0],dy=m[1]-this.g.mid[1],k=this.cam.distance*.003,right=[Math.cos(this.cam.yaw),0,-Math.sin(this.cam.yaw)],fw=[-Math.sin(this.cam.yaw),0,-Math.cos(this.cam.yaw)];this.cam.target[0]=clamp(this.g.target[0]-dx*k*right[0]+dy*k*fw[0],-this.worldW*.7,this.worldW*.7);this.cam.target[2]=clamp(this.g.target[2]-dx*k*right[2]+dy*k*fw[2],-this.worldH*.7,this.worldH*.7);this.changed();return}if(this.ptr.size===1&&this.g?.t==='orbit'&&this.g.id===e.pointerId){const dx=e.clientX-this.g.x,dy=e.clientY-this.g.y;if(Math.hypot(dx,dy)>12)this.cancelLongPress(true);if(Math.hypot(dx,dy)>(this.g.slop||6))this.g.m=true;if(!this.g.m)return;this.endPreview();this.cam.yaw=this.g.yaw-dx*.008;this.cam.polar=clamp(this.g.pol+dy*.006,.18,1.46);this.changed()}}
 up(e,cancelled=false){const suppressPick=this.longPressShown&&this.longPressPointerId===e.pointerId;const pick=!cancelled&&!suppressPick&&this.g?.t==='orbit'&&this.g.id===e.pointerId&&!this.g.m&&this.ptr.size===1;if(this.longPressPointerId===e.pointerId)this.cancelLongPress(true);this.ptr.delete(e.pointerId);if(pick)this.pick(e.clientX,e.clientY);if(this.ptr.size===1){const[id,p]=[...this.ptr.entries()][0];this.g={t:'orbit',id,x:p.x,y:p.y,yaw:this.cam.yaw,pol:this.cam.polar,m:true}}else if(!this.ptr.size){this.g=null;this.request()}}
 hitTest(x,y){const r=this.canvas.getBoundingClientRect(),nx=2*(x-r.left)/r.width-1,ny=1-2*(y-r.top)/r.height,eye=this.eye(),fw=V.norm(V.sub(this.cam.target,eye)),right=V.norm(V.cross(fw,[0,1,0])),up=V.norm(V.cross(right,fw)),t=Math.tan(this.fov/2),dir=V.norm(V.add(fw,V.add(V.mul(right,nx*(r.width/r.height)*t),V.mul(up,ny*t))));if(Math.abs(dir[1])<1e-6)return null;const k=-eye[1]/dir[1];if(k<=0)return null;const hit=V.add(eye,V.mul(dir,k)),px=hit[0]/this.unit+this.imgW/2,py=hit[2]/this.unit+this.imgH/2,p=this.plots.find(p=>(!this.showAll||!this.statusFilter||statusOf(p)===this.statusFilter)&&inside(px,py,p.points));return p||null}
 pick(x,y){const p=this.hitTest(x,y);if(p)this.select(p.id,false,true)}
 wp(p,y=.02){return[(p[0]-this.imgW/2)*this.unit,y,(p[1]-this.imgH/2)*this.unit]}
 flatGeom(p){const a=[];for(const t of triangulate(p.points))for(const x of t)a.push(...this.wp(x,.025));return{b:buf(this.gl,a),n:a.length/3}}
 build(p){const gl=this.gl,H=0.55,top=[],sh=[],side=[],loop=[],vert=[];for(const t of triangulate(p.points))for(const x of t){top.push(...this.wp(x,H));const w=this.wp(x,.011);sh.push(w[0]+.12,w[1],w[2]+.1)}for(let i=0;i<p.points.length;i++){const a=this.wp(p.points[i],.026),b=this.wp(p.points[(i+1)%p.points.length],.026),at=[a[0],H,a[2]],bt=[b[0],H,b[2]];side.push(...a,...b,...bt,...a,...bt,...at);loop.push(...at);vert.push(...a,...at)}return{top:{b:buf(gl,top),n:top.length/3},sh:{b:buf(gl,sh),n:sh.length/3},side:{b:buf(gl,side),n:side.length/3},loop:{b:buf(gl,loop),n:loop.length/3},vert:{b:buf(gl,vert),n:vert.length/3}}}
 clearSel(){if(this.sel){for(const k in this.sel)this.gl.deleteBuffer(this.sel[k].b)}this.sel=null}
 select(id,focus=false,notify=false){const p=this.byId.get(id);if(!p)return;this.clearSel();this.selected=p;this.sel=this.build(p);this.selectionFxStart=animationNow();this.fxLast=0;if(focus)this.focus(p);else this.request();if(notify)this.onSelect(p)}
 clear(){this.clearSel();this.selected=null;this.request()} setPlots(plots){for(const g of this.flat.values())this.gl.deleteBuffer(g.b);this.flat.clear();this.clearSel();this.plots=plots||[];this.byId=new Map(this.plots.map(p=>[p.id,p]));this.selected=null;this.rebuildLabels();this.syncLabelVisibility();this.request()} setImageSrc(src,previewSrc){if(previewSrc)this.previewImageSrc=previewSrc;if(!src||src===this.imageSrc)return;this.imageSrc=src;this.clearTextureTiles();this.loading.style.display='block';this.loading.style.opacity='1';this.loading.textContent='Preparing 3D view…';this.texture()} setShowAll(v){this.showAll=!!v;this.syncLabelVisibility();this.request()} setStatusFilter(v){this.statusFilter=v||null;if(this.selected&&this.statusFilter&&statusOf(this.selected)!==this.statusFilter){this.clearSel();this.selected=null}this.syncLabelVisibility();this.request()}
 rebuildLabels(){if(!this.labelLayer)return;const f=document.createDocumentFragment();for(const p of this.plots){const el=document.createElement('span');el.className='three-plot-label '+statusOf(p);el.dataset.plotId=p.id;el.textContent=p.id;el.hidden=true;f.append(el)}this.labelLayer.replaceChildren(f)}
 syncLabelVisibility(){if(!this.labelLayer)return;const visible=this.active&&this.showAll;this.labelLayer.classList.toggle('visible',visible);for(const el of this.labelLayer.children){const p=this.byId.get(el.dataset.plotId);if(!p||!visible||(this.statusFilter&&statusOf(p)!==this.statusFilter))el.hidden=true}}
 layoutLabels(){if(!this.labelLayer)return;const visible=this.active&&this.showAll;this.labelLayer.classList.toggle('visible',visible);const children=[...this.labelLayer.children];for(const el of children){el.hidden=true;el.style.display='none';el.style.removeProperty('transform')}if(!visible)return;const r=this.host.getBoundingClientRect();if(!r.width||!r.height)return;const candidates=[];for(const el of children){const p=this.byId.get(el.dataset.plotId);if(!p)continue;const st=statusOf(p);el.className='three-plot-label '+st;if(this.statusFilter&&st!==this.statusFilter)continue;const c=plotLabelPoint(p),w=this.wp(c,0),view=mul4v(this.V,[w[0],w[1],w[2],1]),clip=mul4v(this.P,view);if(!Number.isFinite(clip[3])||clip[3]<=0)continue;const nx=clip[0]/clip[3],ny=clip[1]/clip[3],nz=clip[2]/clip[3];if(!Number.isFinite(nx)||!Number.isFinite(ny)||!Number.isFinite(nz)||nz< -1||nz>1||nx< -1.08||nx>1.08||ny< -1.08||ny>1.08)continue;const x=(nx*.5+.5)*r.width,y=(1-(ny*.5+.5))*r.height-LABEL_SCREEN_LIFT_PX;candidates.push({el,p,x,y,selected:this.selected?.id===p.id})}candidates.sort((a,b)=>(b.selected?1:0)-(a.selected?1:0)||a.y-b.y||String(a.p.id).localeCompare(String(b.p.id),undefined,{numeric:true,sensitivity:'base'}));const cellW=34,cellH=24,buckets=new Map();const collision=(x,y)=>{const gx=Math.floor(x/cellW),gy=Math.floor(y/cellH);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const list=buckets.get((gx+dx)+':'+(gy+dy));if(!list)continue;for(const other of list)if(Math.abs(other.x-x)<30&&Math.abs(other.y-y)<20)return true}return false};const remember=(x,y)=>{const key=Math.floor(x/cellW)+':'+Math.floor(y/cellH),list=buckets.get(key)||[];list.push({x,y});buckets.set(key,list)};for(const item of candidates){if(!item.selected&&collision(item.x,item.y))continue;item.el.hidden=false;item.el.style.display='';item.el.style.transform='translate('+item.x.toFixed(1)+'px,'+item.y.toFixed(1)+'px) translate(-50%,-50%)';remember(item.x,item.y)}}
 focus(p){const c=plotLabelPoint(p);this.cam.target=[(c[0]-this.imgW/2)*this.unit,0,(c[1]-this.imgH/2)*this.unit];this.cam.distance=clamp(this.baseDistance*.48,this.minDistance,this.maxDistance);this.cam.polar=.98;this.changed()}
 color(b,n,c,mode,fxMix=0,fxTime=0){const gl=this.gl,l=this.cl;gl.useProgram(this.cp);gl.uniformMatrix4fv(l.P,false,this.P);gl.uniformMatrix4fv(l.V,false,this.V);gl.uniform4fv(l.c,c);gl.uniform1f(l.t,fxTime);gl.uniform1f(l.m,fxMix);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(l.p);gl.vertexAttribPointer(l.p,3,gl.FLOAT,false,0,0);gl.drawArrays(mode||gl.TRIANGLES,0,n)}
 render(now=animationNow()){this.raf=0;if(!this.active)return;const animateFx=Boolean(this.selected&&!this.motionReduced&&!this.ptr.size);if(animateFx&&this.fxLast&&now-this.fxLast<32){this.raf=requestAnimationFrame(t=>this.render(t));return}this.fxLast=animateFx?now:0;this.resize(true);const gl=this.gl;this.P=perspective(this.fov,this.canvas.width/this.canvas.height,this.nearPlane,this.farPlane);this.V=lookAt(this.eye(),this.cam.target,[0,1,0]);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);this.color(this.side,this.sideN,new Float32Array([.04,.055,.07,1]));if(this.tex||this.texturePlan){gl.useProgram(this.tp);gl.uniformMatrix4fv(this.tl.P,false,this.P);gl.uniformMatrix4fv(this.tl.V,false,this.V);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(this.tl.t,0);if(this.tex)this.drawPlanTexture(this.tex,this.gbuf);this.renderTextureTiles()}if(this.showAll){gl.depthMask(false);for(const p of this.plots){const st=statusOf(p);if(this.statusFilter&&st!==this.statusFilter)continue;let g=this.flat.get(p.id);if(!g){g=this.flatGeom(p);this.flat.set(p.id,g)}const c=dimStatus(st==='sold'?[.94,.08,.15,.20]:st==='booked'?[.98,.68,.04,.20]:[.02,.82,.37,.16]);this.color(g.b,g.n,new Float32Array(c))}gl.depthMask(true)}if(this.sel){const pal=statusPalette(statusOf(this.selected)),fxTime=Math.max(0,(now-this.selectionFxStart)/1000),pulse=animateFx?.5+.5*Math.sin(fxTime*3.05):.35,top=lightenStatus(pal.top,.10+.25*pulse),side=lightenStatus(pal.side,.08+.19*pulse),edge=lightenStatus(pal.edge,.18+.30*pulse);gl.depthMask(false);this.color(this.sel.sh.b,this.sel.sh.n,new Float32Array([0,0,0,.22]));gl.depthMask(true);this.color(this.sel.side.b,this.sel.side.n,new Float32Array(side),undefined,animateFx ? .30 : 0,fxTime);this.color(this.sel.top.b,this.sel.top.n,new Float32Array(top),undefined,animateFx ? .50 : 0,fxTime);gl.depthMask(false);this.color(this.sel.loop.b,this.sel.loop.n,new Float32Array(edge),gl.LINE_LOOP);this.color(this.sel.vert.b,this.sel.vert.n,new Float32Array(edge),gl.LINES);gl.depthMask(true)}this.layoutLabels();if(animateFx&&this.active&&!this.raf)this.raf=requestAnimationFrame(t=>this.render(t))}
 request(){if(this.active&&!this.raf)this.raf=requestAnimationFrame(t=>this.render(t))}
}
window.RekixoThreeViewMetrics=Object.freeze({worldUnitFor,cameraMetrics,textureTiles,referenceWorldDiagonal:REFERENCE_WORLD_DIAGONAL});
window.RekixoPlot3D=RekixoPlot3D;
// Backward alias for old cached project shells during the rollout.
window.Tiyansh3D=RekixoPlot3D;
})();
