import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

if (!process.argv.includes("--apply")) throw new Error("Refusing to write HubSpot. Re-run with --apply after approving the staged CSV.");
const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const env = await readFile("/Users/vMac/.env", "utf8");
const token = [...env.matchAll(/^HUBSPOT_SERVICE_KEY=(.+)$/gm)]
  .map((match) => match[1].trim().replace(/^[\"']|[\"']$/g, ""))
  .at(-1);
if (!token) throw new Error("HUBSPOT_SERVICE_KEY is unavailable.");
const stagedCsv = await readFile(path.join(root, "review", "legacy-plan-customer-proposed-hubspot-updates.csv"), "utf8");
const staged = parse(stagedCsv, { columns: true, skip_empty_lines: true });
if (!staged.length) throw new Error("The staged update CSV is empty.");
const request = async (pathname, body) => {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HubSpot request failed for ${pathname}: ${response.status}`);
  return response.json();
};
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const preflight = await request("/crm/v3/objects/contacts/batch/read", {
  properties: ["customer_purchase_profile", "hs_has_active_subscription"],
  inputs: staged.map((row) => ({ id: row.hubspot_contact_id }))
});
const live = new Map(preflight.results.map((contact) => [contact.id, contact.properties]));
const unsafe = staged.filter((row) => {
  const properties = live.get(row.hubspot_contact_id) ?? {};
  return properties.customer_purchase_profile !== "single_purchase_customer" || String(properties.hs_has_active_subscription ?? "") === "1";
});
if (unsafe.length) throw new Error(`Preflight stopped: ${unsafe.length} contacts no longer match the approved before-state.`);
for (const batch of chunks(staged, 10)) {
  await request("/crm/v3/objects/contacts/batch/update", {
    inputs: batch.map((row) => ({ id: row.hubspot_contact_id, properties: { customer_purchase_profile: "former_plan_customer" } }))
  });
}
const verification = await request("/crm/v3/objects/contacts/batch/read", {
  properties: ["customer_purchase_profile", "hs_has_active_subscription"],
  inputs: staged.map((row) => ({ id: row.hubspot_contact_id }))
});
const failed = verification.results.filter((contact) => contact.properties.customer_purchase_profile !== "former_plan_customer");
if (failed.length) throw new Error(`Post-write verification failed for ${failed.length} contacts.`);
const auditDir = path.join(root, "..", "audits");
await mkdir(auditDir, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
await writeFile(path.join(auditDir, `legacy-plan-customer-update-${timestamp}.json`), `${JSON.stringify({
  appliedAt: new Date().toISOString(),
  portalId: 50966981,
  property: "customer_purchase_profile",
  before: "single_purchase_customer",
  after: "former_plan_customer",
  approvedStagedCount: staged.length,
  verifiedCount: verification.results.length,
  contactIds: staged.map((row) => row.hubspot_contact_id)
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ applied: staged.length, verified: verification.results.length, auditDirectory: auditDir }, null, 2));
