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
    a.push([Number(x.toFixed(12)),Number(y.toFixed(12))]);
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
  const semantics=r.edgeSemantics==null?"":r.edgeSemantics;
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

/** Publishing must never expose a clickable plot without complete logical
 * side bindings. Irregular boundaries may assign multiple edges to one role. */
export function blockPublishSideCoverage(polygon:unknown,rawBindings:string|null|undefined):boolean{
  const normalized=safeBlockPolygon(polygon);
  if(!normalized)return false;
  const count=(JSON.parse(normalized) as NormalizedPoint[]).length;
  const bindings=readBlockSides(rawBindings);
  const roles=["front","back","depthA","depthB"] as const;
  const edgeSets:Record<string,number[]>={front:[],back:[],depthA:[],depthB:[]};
  if(bindings.edgeSemantics){
    try{
      const semantics=JSON.parse(bindings.edgeSemantics) as {
        version?:number;pointCount?:number;roles?:Record<string,number[]>;
      };
      if(semantics?.version!==1||semantics.pointCount!==count||!semantics.roles)return false;
      for(const role of roles){
        const indices=semantics.roles[role]||[];
        if(!Array.isArray(indices))return false;
        edgeSets[role]=indices;
      }
    }catch{return false}
  }else{
    if(count>4)return false;
    edgeSets.front=bindings.frontEdgeIndex==null?[]:[bindings.frontEdgeIndex];
    edgeSets.back=bindings.backEdgeIndex==null?[]:[bindings.backEdgeIndex];
    edgeSets.depthA=bindings.depthEdgeIndex==null?[]:[bindings.depthEdgeIndex];
    edgeSets.depthB=bindings.depth2EdgeIndex==null?[]:[bindings.depth2EdgeIndex];
  }
  if(!edgeSets.front.length||!edgeSets.back.length||!edgeSets.depthA.length)return false;
  if(count!==3&&!edgeSets.depthB.length)return false;
  const assigned=roles.flatMap(role=>edgeSets[role]);
  if(assigned.length!==count||new Set(assigned).size!==count)return false;
  return assigned.every(index=>Number.isInteger(index)&&index>=0&&index<count);
}
