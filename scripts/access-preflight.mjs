import { loadNamedEnv } from "../src/env.mjs";

const env = await loadNamedEnv(["HUBSPOT_SERVICE_KEY", "RESEND_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN", "CLOUDFLARE_API_KEY"]);
const checks = [];
for (const name of ["HUBSPOT_SERVICE_KEY", "RESEND_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN", "CLOUDFLARE_API_KEY"]) checks.push({ name, present: Boolean(env[name]) });

async function cloudflare(path, token) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  return { httpStatus: response.status, success: payload.success === true, errors: (payload.errors ?? []).map((error) => error.message) };
}
if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN) {
  checks.push({ name: "cloudflare_account_token", ...(await cloudflare(`/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens/verify`, env.CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN)) });
  checks.push({ name: "cloudflare_workers_read", ...(await cloudflare(`/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`, env.CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN)) });
  checks.push({ name: "cloudflare_d1_read", ...(await cloudflare(`/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database`, env.CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN)) });
}
if (env.CLOUDFLARE_API_KEY) checks.push({ name: "cloudflare_dns_read", ...(await cloudflare("/zones?name=hairsolutions.co", env.CLOUDFLARE_API_KEY)) });
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
if (checks.some((check) => check.success === false && check.name !== "RESEND_API_KEY")) process.exitCode = 1;
