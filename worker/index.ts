/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import publicProjectRuntimeHtml from "../public/project/index.html?raw";
import {
  isPrefixedFrameworkAssetPath,
  isSharedAssetPath,
  sharedPublicRuntimeAssetPath,
  rewriteAssetBodyStream,
  rewriteAssetReferences,
  shouldRewriteAssetBody,
  stripSharedAssetPath,
} from "./shared-assets.mjs";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CLIENT_PLATFORM_HOST?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function normalizedHost(value: string | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

function isSharedPlatformRequest(url: URL, env: Env) {
  const configured = normalizedHost(env.CLIENT_PLATFORM_HOST);
  return Boolean(configured && normalizedHost(url.hostname) === configured);
}

function stripSharedAssetPrefix(request: Request) {
  const url = new URL(request.url);
  const strippedPath = stripSharedAssetPath(url.pathname);
  if (strippedPath === url.pathname) return request;
  url.pathname = strippedPath;
  return new Request(url.toString(), request);
}

async function rewriteSharedAssets(response: Response) {
  const headers = new Headers(response.headers);
  let headerChanged = false;

  // React/Vinext can advertise CSS/JS through HTTP Link preload headers.
  const link = headers.get("link");
  if (link) {
    const rewrittenLink = rewriteAssetReferences(link);
    if (rewrittenLink !== link) {
      headers.set("link", rewrittenLink);
      headerChanged = true;
    }
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !shouldRewriteAssetBody(contentType)) {
    if (!headerChanged) return response;
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");

  return new Response(rewriteAssetBodyStream(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function frameworkAssetUsable(response: Response, pathname: string) {
  if (response.status === 404) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return type.includes("javascript");
  if (lower.endsWith(".css")) return type.includes("text/css");
  // Never let an HTML app fallback masquerade as a framework asset.
  return !type.includes("text/html");
}

async function fetchAssetCandidate(request: Request, env: Env) {
  try {
    return await env.ASSETS.fetch(request);
  } catch {
    return null;
  }
}

function publicRuntimeAssetUsable(response: Response, pathname: string) {
  if (response.status === 404) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".html")) return type.includes("text/html");
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return type.includes("javascript");
  return true;
}

async function fetchPrefixedPublicRuntimeAsset(request: Request, env: Env) {
  const externalUrl = new URL(request.url);
  const assetPath = sharedPublicRuntimeAssetPath(externalUrl.pathname);
  if (!assetPath) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  // The HTML shell is embedded into the Worker bundle at build time. This is
  // intentionally NOT fetched from the Static Assets binding: Cloudflare HTML
  // canonicalization can redirect /project/index.html to /project and escape
  // the reserved /__rekixo namespace on a shared domain.
  if (assetPath === "/project/index.html") {
    return new Response(request.method === "HEAD" ? null : publicProjectRuntimeHtml, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  // Runtime helper scripts are non-HTML static assets, so exact ASSETS binding
  // reads are safe and keep the Worker bundle smaller.
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  const response = await fetchAssetCandidate(
    new Request(assetUrl.toString(), request),
    env,
  );
  if (response && publicRuntimeAssetUsable(response, assetPath)) return response;
  return null;
}

async function fetchPrefixedFrameworkAsset(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!isPrefixedFrameworkAssetPath(url.pathname)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const exact = await fetchAssetCandidate(request, env);
  if (exact && frameworkAssetUsable(exact, url.pathname)) return exact;

  // assetPrefix changes browser URLs, but Cloudflare's static bundle may still
  // store the physical file at /_next, /_vinext or /assets. Try that exact
  // static object before allowing the application router to see the request.
  const strippedRequest=stripSharedAssetPrefix(request);
  const strippedUrl=new URL(strippedRequest.url);
  const fallback=await fetchAssetCandidate(strippedRequest,env);
  if (fallback && frameworkAssetUsable(fallback,strippedUrl.pathname)) return fallback;

  return null;
}

function isSensitiveClientPath(pathname: string) {
  if (
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/client")
  ) return true;
  return (
    pathname.startsWith("/projects/") &&
    /\/(?:admin(?:-login)?|change-password)(?:\/|$)/.test(pathname)
  );
}

function canonicalRuntimePath(pathname: string) {
  const sharedRuntimeAsset = sharedPublicRuntimeAssetPath(pathname);
  if (sharedRuntimeAsset) return sharedRuntimeAsset;
  return pathname.startsWith("/__rekixo/")
    ? pathname.slice("/__rekixo".length)
    : pathname;
}

// The dynamic Next.js wrapper contains the current publish/data revision.
// Do not let a browser or edge persist the old iframe URL after metadata edits.
function isPublicProjectEntry(pathname: string) {
  return /^\\/projects\\/[^/]+\\/?$/.test(pathname);
}

function isPublicProjectRuntimeAsset(pathname: string) {
  const canonical = canonicalRuntimePath(pathname);
  return (
    canonical === "/project/index.html" ||
    canonical === "/project/project-geometry.js" ||
    canonical === "/project/three-view.js" ||
    canonical === "/project/plots-data.js"
  );
}

function isPublicProjectIndex(pathname: string) {
  return canonicalRuntimePath(pathname) === "/project/index.html";
}

async function publicRuntimeProjectId(url: URL, env: Env) {
  const explicitProjectId = String(url.searchParams.get("projectId") || "").trim();
  if (explicitProjectId) return explicitProjectId;

  const slug = String(url.searchParams.get("projectSlug") || "").trim();
  if (slug) {
    const project = await env.DB.prepare(
      "SELECT id FROM projects WHERE slug=? AND status='active' LIMIT 1",
    )
      .bind(slug)
      .first<{ id: string }>();
    if (project?.id) return project.id;
  }

  const host = normalizedHost(url.hostname);
  if (!host) return null;

  const domain = await env.DB.prepare(
    "SELECT project_id AS projectId FROM project_domains WHERE host=? AND status='active' AND kind IN ('public','both') LIMIT 1",
  )
    .bind(host)
    .first<{ projectId: string }>();
  if (domain?.projectId) return domain.projectId;

  const legacy = await env.DB.prepare(
    "SELECT id FROM projects WHERE public_host=? AND status='active' LIMIT 1",
  )
    .bind(host)
    .first<{ id: string }>();
  return legacy?.id || null;
}

async function applyPublicCustomerActionPolicy(
  response: Response,
  request: Request,
  env: Env,
) {
  if (request.method !== "GET") return response;
  const url = new URL(request.url);
  if (!isPublicProjectIndex(url.pathname)) return response;
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/html"))
    return response;

  const projectId = await publicRuntimeProjectId(url, env);
  if (!projectId) return response;

  const setting = await env.DB.prepare(
    "SELECT value FROM settings WHERE project_id=? AND key='customerCallEnabled' LIMIT 1",
  )
    .bind(projectId)
    .first<{ value: string }>();

  // Backward-compatible default is ON. Only an explicit project value of 0
  // removes public calling. WhatsApp remains available and expands full-width.
  if (setting?.value !== "0" || !response.body) return response;

  const policyStyle =
    '<style id="rekixo-customer-call-disabled">#callTop,#callBtn{display:none!important}.actions{grid-template-columns:minmax(0,1fr)!important}</style>';
  const source = await response.text();
  const body = source.includes("</head>")
    ? source.replace("</head>", `${policyStyle}</head>`)
    : `${policyStyle}${source}`;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.set("cache-control", "no-cache");

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const externalUrl = new URL(request.url);
    const sharedPlatform = isSharedPlatformRequest(externalUrl, env);
    const isolatedAssetRequest = isSharedAssetPath(externalUrl.pathname);
    const directPublicRuntimeAsset = isolatedAssetRequest
      ? await fetchPrefixedPublicRuntimeAsset(request, env)
      : null;
    const directPrefixedAsset = isolatedAssetRequest && !directPublicRuntimeAsset
      ? await fetchPrefixedFrameworkAsset(request, env)
      : null;

    const internalRequest =
      isolatedAssetRequest && !directPublicRuntimeAsset && !directPrefixedAsset
        ? stripSharedAssetPrefix(request)
        : request;
    const internalUrl = new URL(internalRequest.url);

    let response: Response;

    if (directPublicRuntimeAsset) {
      response = directPublicRuntimeAsset;
    } else if (directPrefixedAsset) {
      response = directPrefixedAsset;
    } else if (internalUrl.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(
        internalRequest,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, internalRequest.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    } else {
      response = await handler.fetch(internalRequest, env, ctx);
    }

    // On the shared boss domain, only Rekixo pages/assets are rewritten.
    // The boss/Vercel root site never enters this Worker because no broad /* route exists.
    if (
      sharedPlatform &&
      (externalUrl.pathname.startsWith("/projects/") || isolatedAssetRequest)
    ) {
      // Direct /__rekixo/assets JS/CSS can contain nested root-relative
      // /assets, /_next or /_vinext references. Rewrite those too so the
      // browser never escapes to the boss/Vercel asset namespace.
      response = await rewriteSharedAssets(response);
    }

    response = await applyPublicCustomerActionPolicy(response, request, env);

    const secured = new Response(response.body, response);
    secured.headers.set("x-content-type-options", "nosniff");
    secured.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    secured.headers.set("x-frame-options", "SAMEORIGIN");
    secured.headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );

    if (
      externalUrl.pathname.startsWith("/admin") ||
      isSensitiveClientPath(externalUrl.pathname)
    ) {
      secured.headers.set("cache-control", "no-store");
    } else if (isPublicProjectEntry(externalUrl.pathname)) {
      secured.headers.set("cache-control", "no-store");
    } else if (isPublicProjectRuntimeAsset(externalUrl.pathname)) {
      // Runtime shell/scripts are tiny but behavior-critical. Revalidate them so
      // a browser never pins an old 3D engine after a safe deploy. Heavy images
      // remain cacheable through their own asset endpoints.
      secured.headers.set("cache-control", "no-cache");
    }

    return secured;
  },
};

export default worker;
