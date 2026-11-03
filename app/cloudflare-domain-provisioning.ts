import { env } from "cloudflare:workers";

/**
 * Only the Super Admin Worker may hold these optional API secrets.
 * Without them the DB mapping is saved as pending manual Cloudflare attachment.
 */
type CloudflareDomainState = "attached" | "manual_required";
type CloudflareDomainRecord = { hostname: string; service: string; enabled: boolean };
type CloudflareResponse<T> = { success?: boolean; result?: T; errors?: Array<{ message?: string }> };

export async function attachCustomerWorkerDomain(host: string): Promise<{
  state: CloudflareDomainState;
  message: string;
}> {
  const config = env as unknown as Record<string, string | undefined>;
  const token = String(config.CLOUDFLARE_DOMAIN_API_TOKEN || "").trim();
  const accountId = String(config.CLOUDFLARE_DOMAIN_ACCOUNT_ID || "").trim();
  if (!token || !/^[0-9a-f]{32}$/i.test(accountId))
    return {
      state: "manual_required",
      message: "Cloudflare auto-attach credentials not configured. Add this hostname to rekixo-client-sites > Settings > Domains & Routes > Custom Domain.",
    };

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const listUrl = `${endpoint}?hostname=${encodeURIComponent(host)}`;
  const currentResponse = await fetch(listUrl, { headers, signal: AbortSignal.timeout(12000) });
  const current = await currentResponse.json() as CloudflareResponse<CloudflareDomainRecord[]>;
  if (!currentResponse.ok || !current.success || !Array.isArray(current.result))
    throw new Error("Cloudflare domain list unavailable. Domain mapping was not changed.");
  const matches = current.result.filter((item) => item.hostname.toLowerCase() === host);
  if (matches.some((item) => item.service !== "rekixo-client-sites"))
    throw new Error("This Cloudflare hostname already belongs to another Worker.");

  if (matches.some((item) => item.enabled && item.service === "rekixo-client-sites"))
    return { state: "attached", message: "Hostname already attached to rekixo-client-sites." };

  const response = await fetch(endpoint, {
    method: "PUT",
    headers,
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      hostname: host,
      service: "rekixo-client-sites",
      enabled: true,
    }),
  });
  const data = await response.json() as CloudflareResponse<CloudflareDomainRecord>;
  if (!response.ok || !data.success || data.result?.hostname !== host ||
      data.result?.service !== "rekixo-client-sites") {
    const reason = data.errors?.[0]?.message || "Cloudflare rejected the hostname.";
    throw new Error(`Cloudflare attachment failed: ${reason}`);
  }
  return {
    state: "attached",
    message: "Cloudflare Worker domain attached. DNS and SSL issuance may still be provisioning.",
  };
}
