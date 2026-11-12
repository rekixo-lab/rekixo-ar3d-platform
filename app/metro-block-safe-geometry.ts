/**
 * METRO CITY block-only polygon and side-binding checks.
 * No canonical plot mutations are allowed from this module.
 */
export type NormalizedPoint = [number,number];
export function safeBlockPolygon(value:unknown): string | null {
  let points: unknown=value;
  if(typeof points==="string"){try{points=JSON.parse(points)}catch{return null}}
  if(!Array.isArray(points)||points.length<3||points.length>80)return null;
  const a:NormalizedPoint[]=[];
  for(const point of points) {
    if(!Array.isArray(point)||point.length!==2)return null;
    const x=Number(point[0]),y=Number(point[1]);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return null;
    a.push([Number(x.toFixed(7)),Number(y.toFixed(7))]);
  }
  const cross=(p:NormalizedPoint,q:NormalizedPoint,r:NormalizedPoint)=>
    (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  let area=0;
  const n=a.length;
  for(let i=0;i<n;i++){
    const p=a[i],q=a[(i+1)%n];
    if(Math.hypot(p[0]-q[0],p[1]-q[1])<1e-7)return null;
    area+=p[0]*q[1]-q[0]*p[1];
    for(let j=i+1;j<n;j++){
      if(j===i+1||(i===0&&j===n-1))continue;
      const r=a[j],s=a[(j+1)%n];
      if(cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0)return null;
    }
  }
  if(Math.abs(area)<1e-7)return null;
  return JSON.stringify(a);
}
const indices=["frontEdgeIndex","depthEdgeIndex","backEdgeIndex","depth2EdgeIndex"] as const;
export type BlockSideBindings = {
  frontEdgeIndex:number|null;depthEdgeIndex:number|null;backEdgeIndex:number|null;depth2EdgeIndex:number|null;edgeSemantics:string;
};
const empty:BlockSideBindings={frontEdgeIndex:null,depthEdgeIndex:null,backEdgeIndex:null,depth2EdgeIndex:null,edgeSemantics:""};
export function readBlockSides(raw:string|null|undefined):BlockSideBindings {
  if(!raw)return {...empty};
  try{
    const v=JSON.parse(raw);
    if(!v||typeof v!=="object")return {...empty};
    return {frontEdgeIndex:Number.isInteger(v.frontEdgeIndex)?v.frontEdgeIndex:null,
      depthEdgeIndex:Number.isInteger(v.depthEdgeIndex)?v.depthEdgeIndex:null,
      backEdgeIndex:Number.isInteger(v.backEdgeIndex)?v.backEdgeIndex:null,
      depth2EdgeIndex:Number.isInteger(v.depth2EdgeIndex)?v.depth2EdgeIndex:null,
      edgeSemantics:typeof v.edgeSemantics==="string"?v.edgeSemantics:""};
  }catch{return {...empty}}
}
export function encodeBlockSides(raw:unknown,vertices:number):string|null{
  if(!raw||typeof raw!=="object"||vertices<3||vertices>80)return null;
  const r=raw as Record<string,unknown>;
  const result:Record<string,unknown>={};
  for(const field of indices){
    const n=r[field];
    if(n!=null&&n!==""&&(!Number.isInteger(n)||Number(n)<0||Number(n)>=vertices))return null;
    result[field]=n==null||n===""?null:Number(n);
  }
  const semantics=r.edgeSemantics;
  if(typeof semantics!=="string"||semantics.length>6000)return null;
  if(semantics){
    let parsed:unknown;
    try{parsed=JSON.parse(semantics)}catch{return null}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;
    const doc=parsed as Record<string,unknown>;
    if(doc.roles!=null){
      if(!doc.roles||typeof doc.roles!=="object"||Array.isArray(doc.roles))return null;
      for(const indexes of Object.values(doc.roles as object)){
        if(!Array.isArray(indexes)||indexes.some(i=>!Number.isInteger(i)||i<0||i>=vertices))return null;
      }
    }
  }
  result.edgeSemantics=semantics;
  return JSON.stringify(result);
}
