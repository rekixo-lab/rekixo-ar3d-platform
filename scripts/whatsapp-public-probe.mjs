// Read-only comparison of public WhatsApp metadata and image responses.
const projects = [
  ["Gajalakshmi published", "https://ar3dstudio.in/projects/gajalakshmi-nagar-satharai-170baa?share=1792996143540"],
  ["Gajalakshmi newer", "https://ar3dstudio.in/projects/gajalakshmi-nagar-satharai-170baa?share=1792997781613"],
  ["Aravalli formerly working", "https://ar3dstudio.in/projects/aravalli-green-farms-8e81e7?share=1792490294142"]
];
const agents = [
  ["WhatsApp", "WhatsApp/2.26.0.0 A"],
  ["Facebook", "facebookexternalhit/1.1"],
  ["Chrome", "Mozilla/5.0 Chrome/130.0 Safari/537.36"]
];
const attr = (tag, name) => {
 const m = tag.match(new RegExp("\\b" + name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
 return m ? m[1].replace(/&amp;/g, "&") : "";
};
function headTags(html) {
 const h = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
 const t = {};
 for(const match of h.matchAll(/<meta\b[^>]*>/gi)) {
   const name = attr(match[0],"property") || attr(match[0],"name");
   if (["og:title","og:description","og:image","og:url","og:image:width","og:image:height","twitter:card"].includes(name))t[name] = attr(match[0],"content");
 }
 return {headLength:h.length, tags:t, afterHeadOg:html.slice(html.indexOf("</head>")).includes('property="og:image"')};
}
function dimensions(buffer) {
 if(buffer.length < 24)return null;
 if(buffer[0]===0x89 && buffer.subarray(1,4).toString()==="PNG")
  return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)];
 if(buffer[0]!==0xff||buffer[1]!==0xd8)return null;
 let i=2;
 while(i<buffer.length-10) {
  if(buffer[i]!==0xff){i++;continue}
  while(buffer[i]===0xff)i++;
  const marker=buffer[i++];
  if(marker===0xd9||marker===0xda)break;
  if((marker>=0xd0&&marker<=0xd7)||marker===0x01)continue;
  const len=buffer.readUInt16BE(i);
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb].includes(marker))
    return [buffer.readUInt16BE(i+5),buffer.readUInt16BE(i+3)];
  i+=len;
 }
 return null;
}
for(const [label,url] of projects){
 for(const [uaName,ua] of agents){
 try{
 const started=Date.now();
 const response=await fetch(url,{headers:{"user-agent":ua,accept:"text/html"},redirect:"follow",signal:AbortSignal.timeout(15000)});
 const html=await response.text();
 const {tags,headLength,afterHeadOg}=headTags(html);
 const record={project:label,ua:uaName,pageStatus:response.status,ms:Date.now()-started,final:response.url,contentType:response.headers.get("content-type"),cache:response.headers.get("cache-control"),headLength,bodyMetadata:afterHeadOg,ogTitle:tags["og:title"],ogImage:tags["og:image"],ogUrl:tags["og:url"],imageWidth:tags["og:image:width"],imageHeight:tags["og:image:height"]};
 if(tags["og:image"]){
  const imageStart=Date.now();
  const [img,head] = await Promise.all([
    fetch(tags["og:image"],{headers:{"user-agent":ua,accept:"image/jpeg,image/png,image/*"},signal:AbortSignal.timeout(15000)}),
    fetch(tags["og:image"],{method:"HEAD",headers:{"user-agent":ua},signal:AbortSignal.timeout(15000)})
  ]);
  const bytes=Buffer.from(await img.arrayBuffer());
  record.image={status:img.status,bytes:bytes.length,shape:dimensions(bytes),type:img.headers.get("content-type"),lengthHeader:img.headers.get("content-length"),headStatus:head.status,headType:head.headers.get("content-type"),headLength:head.headers.get("content-length"),timeMs:Date.now()-imageStart,startsLikeJpeg:bytes[0]===255&&bytes[1]===216};
 }
 console.log(JSON.stringify(record));
 }catch(err){console.log(JSON.stringify({project:label,ua:uaName,error:String(err)}))}
 }
}
