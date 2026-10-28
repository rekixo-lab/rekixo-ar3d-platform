import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source=await readFile(new URL('../public/project/three-view.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/project/index.html',import.meta.url),'utf8');
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const plot=(id='33',status='available')=>({id,status,points:[[49,49],[51,49],[51,51],[49,51]]});

function fixture(plots=[plot()]){
  const events=new Map();
  const gl={createBuffer:()=>({}),bindBuffer(){},bufferData(){},deleteBuffer(){}};
  const canvas={width:400,height:600,style:{},getContext:()=>gl,addEventListener:(name,fn)=>events.set(name,fn),setPointerCapture(){}};
  const layer={children:[],classList:{toggle(){}},replaceChildren(fragment){this.children=fragment.children}};
  const loading={style:{}};
  const host={innerHTML:'',getBoundingClientRect:()=>({width:400,height:600}),querySelector:s=>s==='canvas'?canvas:s==='.three-label-layer'?layer:loading};
  const context={window:{},devicePixelRatio:1,requestAnimationFrame:()=>1,matchMedia:()=>({matches:false}),document:{
    createDocumentFragment:()=>({children:[],append(el){this.children.push(el)}}),
    createElement:()=>({dataset:{},hidden:false,className:'',textContent:'',style:{transform:'',display:'',removeProperty(name){delete this[name]}}})
  }};
  vm.runInNewContext(source,context,{filename:'three-view.js'});
  class Engine extends context.window.Tiyansh3D{init(){} texture(){}}
  const engine=new Engine(host,{plots,mapWidth:100,mapHeight:100});
  engine.active=true;engine.showAll=true;engine.P=identity();engine.V=identity();
  return{engine,layer};
}

test('author CSS cannot override hidden 3D plot labels',()=>{
  assert.match(html,/\.three-plot-label\[hidden\]\{display:none!important\}/);
});

test('labels clear stale screen transforms before every projection pass',()=>{
  const {engine,layer}=fixture();
  engine.layoutLabels();
  const el=layer.children[0];
  assert.equal(el.hidden,false);
  assert.notEqual(el.style.transform,undefined);
  engine.V[12]=3;
  engine.layoutLabels();
  assert.equal(el.hidden,true);
  assert.equal(el.style.display,'none');
  assert.equal(el.style.transform,undefined);
});

test('labels outside camera depth clip are never exposed over black sky',()=>{
  const {engine,layer}=fixture();
  engine.V[14]=2;
  engine.layoutLabels();
  assert.equal(layer.children[0].hidden,true);
  assert.equal(layer.children[0].style.display,'none');
  assert.match(source,/nz=clip\[2\]\/clip\[3\]/);
  assert.match(source,/nz< -1\|\|nz>1/);
});

test('valid ground label is restored only after passing projection checks',()=>{
  const {engine,layer}=fixture();
  engine.layoutLabels();
  const el=layer.children[0];
  assert.equal(el.hidden,false);
  assert.equal(el.style.display,'');
  assert.match(el.style.transform,/translate\(/);
});

test('status filter path remains flat and does not add external raised-prism behavior',()=>{
  assert.match(source,/if\(!this\.matchesStatusFilter\(p\)\)continue;let g=this\.flat\.get\(p\.id\)/);
  assert.doesNotMatch(source,/this\.raised=new Map\(\)/);
  assert.doesNotMatch(source,/this\.raised\.get\(p\.id\)/);
  assert.doesNotMatch(source,/build\(p,H=0\.55\)/);
});

test('canonical resolution-independent geometry and ground lock remain intact',()=>{
  assert.match(source,/this\.unit=worldUnitFor\(this\.imgW,this\.imgH\)/);
  assert.match(source,/const c=plotLabelPoint\(p\),w=this\.wp\(c,0\)/);
  assert.match(source,/inside\(px,py,p\.points\)/);
});
