import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const contacts = JSON.parse(await readFile(path.join(root, "hubspot-snapshot", "raw", "contacts.json"), "utf8"));
const freeEmails = new Set((await readFile(path.join(root, "free-import", "import.csv"), "utf8"))
  .split("\n").slice(1).filter(Boolean).map((row) => row.match(/^"([^"]+)"/)?.[1]).filter(Boolean));
const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const rows = [];
for (const contact of contacts) {
  const p = contact.properties ?? {};
  const email = String(p.email ?? "").trim().toLowerCase();
  if (!freeEmails.has(email)) continue;
  const evidence = [];
  if (p.hs_first_closed_order_id || p.hs_first_order_closed_date || p.hs_recent_closed_order_date) evidence.push("closed_order");
  if (p.order_last_payment_status) evidence.push("payment_status");
  if (p.recent_deal_amount || p.recent_deal_close_date || p.num_associated_deals) evidence.push("deal_history");
  if (p.stripe_customer_id || p.stripe_created_date || p.stripe_delinquent) evidence.push("stripe_record");
  if (p.legacy_commerce_last_date) evidence.push("legacy_commerce_history");
  if (!evidence.length) continue;
  rows.push({
    email,
    first_name: p.firstname ?? "",
    last_name: p.lastname ?? "",
    evidence: evidence.join(";"),
    customer_purchase_profile: p.customer_purchase_profile ?? "",
    last_commerce_date: p.legacy_commerce_last_date ?? "",
    last_payment_status: p.order_last_payment_status ?? "",
    first_order_date: p.hs_first_order_closed_date ?? "",
    recent_order_date: p.hs_recent_closed_order_date ?? "",
    associated_deals: p.num_associated_deals ?? "",
    recent_deal_amount: p.recent_deal_amount ?? "",
    stripe_record: p.stripe_customer_id ? "yes" : ""
  });
}
rows.sort((a, b) => a.email.localeCompare(b.email));
const outputDir = path.join(root, "review");
await mkdir(outputDir, { recursive: true });
const headers = Object.keys(rows[0] ?? { email: "" });
const csv = `${headers.join(",")}\n${rows.map((row) => headers.map((key) => escape(row[key])).join(",")).join("\n")}\n`;
const summary = {
  generatedAt: new Date().toISOString(),
  freeAudienceCount: freeEmails.size,
  paymentAssociatedCount: rows.length,
  evidenceCounts: Object.fromEntries(["closed_order", "payment_status", "deal_history", "stripe_record", "legacy_commerce_history"].map((type) => [type, rows.filter((row) => row.evidence.split(";").includes(type)).length]))
};
await writeFile(path.join(outputDir, "payment-associated-free-contacts.csv"), csv, { mode: 0o600 });
await writeFile(path.join(outputDir, "payment-associated-free-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, ...summary }, null, 2));
