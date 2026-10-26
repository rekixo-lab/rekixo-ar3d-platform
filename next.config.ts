import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force dynamic project metadata into the initial HTML <head> for all
  // user agents. WhatsApp/Meta preview fetchers are not consistent about
  // their UA string, and Vinext otherwise streams tags inside <body>.
  // This is the documented Next/Vinext crawler-safe blocking mode.
  htmlLimitedBots: /.*/,
  // Keep every framework-emitted JS/CSS/static URL inside Rekixo-owned isolated
  // shared-domain namespace. This prevents boss-site/Vercel asset collisions.
  assetPrefix: "/__rekixo",
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
};

export default nextConfig;
