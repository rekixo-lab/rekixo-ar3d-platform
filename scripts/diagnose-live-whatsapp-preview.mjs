// Read-only public crawler diagnostics. No cookies, credentials, or edits.
const slug = "gajalakshmi-nagar-satharai-170baa";
const links = [
  `https://ar3dstudio.in/projects/${slug}?share=1792996040407`,
  `https://rekixo-client-sites.ai-8f3.workers.dev/projects/${slug}?share=1792996040407`,
];
const agents = [
  ["whatsapp", "WhatsApp/2.23.20.0 A"],
  ["facebook", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
  ["meta-agent", "meta-externalagent/1.1"],
  ["browser", "Mozilla/5.0 (compatible; Chrome/130.0.0.0)"],
];
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m?.[1] || "";
}
function meta(html) {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
  const all = [...head.matchAll(/<meta\b[^>]*>/gi)].map(x => x[0]);
  const tags = {};
  for (const tag of all) {
    const key = attr(tag,"property") || attr(tag,"name");
    if (["og:title","og:image","og:description","og:url","description","twitter:card"].includes(key)) {
      tags[key]=attr(tag,"content").slice(0,400);
    }
  }
  return {headBytes:head.length, headTitle:head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.slice(0,150)||"", headTags:tags, bodyOgTag: /<body[\s\S]*?<meta[^>]*property=["']og:image/i.test(html)};
}
for (const url of links) {
  for (const [name,agent] of agents) {
    try {
      const response=await fetch(url,{headers:{"user-agent":agent,"accept":"text/html"},redirect:"follow",signal:AbortSignal.timeout(18000)});
      const html=await response.text();
      const parsed=meta(html);
      console.log(JSON.stringify({url,agent:name,status:response.status,finalUrl:response.url,contentType:response.headers.get("content-type"),cfRay:response.headers.get("cf-ray"),server:response.headers.get("server"),size:html.length, ...parsed}));
      if (parsed.headTags["og:image"]) {
        const imageUrl=parsed.headTags["og:image"].replaceAll("&amp;","&");
        const imageRes=await fetch(imageUrl,{headers:{"user-agent":agent,range:"bytes=0-2047"},signal:AbortSignal.timeout(12000)});
        console.log(JSON.stringify({assetFor:name,status:imageRes.status,finalUrl:imageRes.url,contentType:imageRes.headers.get("content-type"),contentLength:imageRes.headers.get("content-length"),cache:imageRes.headers.get("cache-control"),cors:imageRes.headers.get("access-control-allow-origin")}));
        await imageRes.body?.cancel();
      }
    } catch(e) { console.log(JSON.stringify({url,agent:name,error:String(e)})); }
  }
}
