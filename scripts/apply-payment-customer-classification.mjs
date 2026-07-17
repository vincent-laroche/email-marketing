import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

if (!process.argv.includes("--apply")) throw new Error("Refusing to write HubSpot. Re-run with --apply after explicit approval.");
const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const env = await readFile("/Users/vMac/.env", "utf8");
const token = [...env.matchAll(/^HUBSPOT_SERVICE_KEY=(.+)$/gm)].map((match) => match[1].trim().replace(/^["']|["']$/g, "")).at(-1);
if (!token) throw new Error("HUBSPOT_SERVICE_KEY is unavailable.");
const staged = parse(await readFile(path.join(root, "review", "payment-customer-classification-proposed-updates.csv"), "utf8"), { columns: true, skip_empty_lines: true });
const batch = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const request = async (pathname, body) => {
  const response = await fetch(`https://api.hubapi.com${pathname}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`HubSpot ${pathname} failed: ${response.status} ${await response.text()}`);
  return response.json();
};
const reads = [];
for (const ids of batch(staged.map((row) => row.hubspot_contact_id), 100)) reads.push(...(await request("/crm/v3/objects/contacts/batch/read", { properties: ["contact_type", "lifecyclestage"], inputs: ids.map((id) => ({ id })) })).results);
const live = new Map(reads.map((contact) => [contact.id, contact.properties ?? {}]));
const missing = staged.filter((row) => !live.has(row.hubspot_contact_id));
if (missing.length) throw new Error(`Preflight stopped: ${missing.length} staged contacts no longer exist.`);
const needsUpdate = staged.filter((row) => {
  const properties = live.get(row.hubspot_contact_id);
  return properties.contact_type !== "consumer" || properties.lifecyclestage !== "customer";
});
// HubSpot will not move a lifecycle stage backwards from Other to Customer in one write.
// Clear the value first, then set Customer; this is limited to the exact approved target rows.
const resetLifecycle = needsUpdate.filter((row) => live.get(row.hubspot_contact_id).lifecyclestage === "other");
for (const rows of batch(resetLifecycle, 10)) {
  await request("/crm/v3/objects/contacts/batch/update", { inputs: rows.map((row) => ({ id: row.hubspot_contact_id, properties: { lifecyclestage: "" } })) });
}
for (const rows of batch(needsUpdate, 10)) {
  await request("/crm/v3/objects/contacts/batch/update", { inputs: rows.map((row) => ({ id: row.hubspot_contact_id, properties: { contact_type: "consumer", lifecyclestage: "customer" } })) });
}
const verification = [];
for (const ids of batch(staged.map((row) => row.hubspot_contact_id), 100)) verification.push(...(await request("/crm/v3/objects/contacts/batch/read", { properties: ["contact_type", "lifecyclestage"], inputs: ids.map((id) => ({ id })) })).results);
const failed = verification.filter((contact) => contact.properties?.contact_type !== "consumer" || contact.properties?.lifecyclestage !== "customer");
if (failed.length) throw new Error(`Post-write verification failed for ${failed.length} contacts.`);
const auditDir = path.join(root, "..", "audits");
await mkdir(auditDir, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
await writeFile(path.join(auditDir, `payment-customer-classification-${timestamp}.json`), `${JSON.stringify({
  appliedAt: new Date().toISOString(), portalId: 50966981, source: "Stripe completed payments + GoCardless subscription records",
  requestedUpdateCount: staged.length, appliedNowCount: needsUpdate.length, lifecycleResetCount: resetLifecycle.length, verifiedCount: verification.length,
  recoveryContext: "The initial write pass set both target values on 39 contacts and contact_type on two Other-stage contacts. This recovery pass cleared then set those two lifecycle stages and verified all 41 targets.",
  updates: staged.map((row) => ({ hubspotContactId: row.hubspot_contact_id, before: { contact_type: live.get(row.hubspot_contact_id).contact_type ?? "", lifecyclestage: live.get(row.hubspot_contact_id).lifecyclestage ?? "" }, after: { contact_type: "consumer", lifecyclestage: "customer" }, matchBasis: row.match_basis, evidenceSources: row.evidence_sources }))
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ requested: staged.length, updatedNow: needsUpdate.length, verified: verification.length, auditDir }, null, 2));
