import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (!process.argv.includes("--apply")) throw new Error("Refusing to create or modify a HubSpot list. Re-run with --apply after approval.");
const currentRoot = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const env = await readFile("/Users/vMac/.env", "utf8");
const token = [...env.matchAll(/^HUBSPOT_SERVICE_KEY=(.+)$/gm)]
  .map((match) => match[1].trim().replace(/^[\"']|[\"']$/g, ""))
  .at(-1);
if (!token) throw new Error("HUBSPOT_SERVICE_KEY is unavailable.");
const request = async (pathname, { method = "GET", body } = {}) => {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`HubSpot request failed for ${pathname}: ${response.status}`);
  return response.json();
};
const contacts = JSON.parse(await readFile(path.join(currentRoot, "hubspot-snapshot", "raw", "contacts.json"), "utf8"));
const planCustomers = contacts.filter((contact) => {
  const p = contact.properties ?? {};
  return String(p.hs_has_active_subscription ?? "") === "1" || /plan_customer/i.test(String(p.customer_purchase_profile ?? ""));
});
const listName = "Marketing Email Exclusion — Plan Customers";
const listIdArgument = process.argv.find((argument) => argument.startsWith("--list-id="))?.split("=", 2)[1];
const listResponse = await request("/crm/v3/lists?limit=250");
let list = (listResponse.lists ?? listResponse.results ?? []).find((item) => item.name === listName);
if (!list && !listIdArgument) {
  const created = await request("/crm/v3/lists", { method: "POST", body: { name: listName, objectTypeId: "0-1", processingType: "MANUAL" } });
  list = created.list ?? created;
}
const listId = String(listIdArgument ?? list?.listId ?? list?.id);
if (!listId) throw new Error("HubSpot did not return the plan-customer list ID.");
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
for (const batch of chunks(planCustomers, 10)) {
  await request(`/crm/v3/lists/${listId}/memberships/add`, { method: "PUT", body: batch.map((contact) => String(contact.id)) });
}
const membershipIds = new Set();
let after;
do {
  const page = await request(`/crm/v3/lists/${listId}/memberships?limit=250${after ? `&after=${encodeURIComponent(after)}` : ""}`);
  for (const member of page.results ?? []) membershipIds.add(String(member.id ?? member.recordId ?? member));
  after = page.paging?.next?.after;
} while (after);
const missing = planCustomers.filter((contact) => !membershipIds.has(String(contact.id)));
if (missing.length) throw new Error(`Membership verification failed: ${missing.length} plan customers are absent from list ${listId}.`);
const rows = planCustomers.map((contact) => {
  const p = contact.properties ?? {};
  return {
    hubspot_contact_id: contact.id,
    email: p.email ?? "",
    first_name: p.firstname ?? "",
    last_name: p.lastname ?? "",
    customer_purchase_profile: p.customer_purchase_profile ?? "",
    hs_has_active_subscription: p.hs_has_active_subscription ?? "",
    suppression_reason: "plan_customer_hold",
    hubspot_suppression_list: listName,
    hubspot_suppression_list_id: listId
  };
}).sort((a, b) => a.email.localeCompare(b.email));
const headers = Object.keys(rows[0] ?? { hubspot_contact_id: "" });
const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = `${headers.join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}\n`;
const reviewDir = path.join(currentRoot, "review");
const auditDir = path.join(currentRoot, "..", "audits");
await mkdir(reviewDir, { recursive: true });
await mkdir(auditDir, { recursive: true });
await writeFile(path.join(reviewDir, "plan-customer-suppression.csv"), csv, { mode: 0o600 });
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
await writeFile(path.join(auditDir, `plan-customer-suppression-list-${timestamp}.json`), `${JSON.stringify({
  appliedAt: new Date().toISOString(), portalId: 50966981, listName, listId,
  currentPlanCustomerCount: planCustomers.length, verifiedMembershipCount: membershipIds.size
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ listName, listId, addedOrConfirmed: planCustomers.length, verifiedMembershipCount: membershipIds.size, localExport: path.join(reviewDir, "plan-customer-suppression.csv") }, null, 2));
