import { mkdir, writeFile } from "node:fs/promises";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";

const env = await loadNamedEnv(["CLOUDFLARE_API_KEY"]);
const token = requireEnv(env, "CLOUDFLARE_API_KEY");
async function get(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare API failed for ${path}: ${(body.errors ?? []).map((error) => error.message).join("; ")}`);
  return body.result;
}
const [zone] = await get("/zones?name=hairsolutions.co");
if (!zone?.id) throw new Error("hairsolutions.co zone not found");
const records = await get(`/zones/${zone.id}/dns_records?per_page=5000`);
const summary = records.map((record) => ({ type: record.type, name: record.name, content: record.content, proxied: record.proxied ?? false, ttl: record.ttl })).sort((a, b) => a.name.localeCompare(b.name));
const report = { auditedAt: new Date().toISOString(), zone: zone.name, candidateMarketingSubdomains: summary.filter((record) => /(^|\.)(email|mail|news|updates)\.hairsolutions\.co$/i.test(record.name)), records: summary };
const destination = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/audits/dns-audit-2026-07-17.json";
await mkdir("/Users/vMac/01_projects/Email Marketing/resend-takeover/data/audits", { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ destination, candidateMarketingSubdomains: report.candidateMarketingSubdomains }, null, 2));
