import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const contacts = JSON.parse(await readFile(path.join(root, "hubspot-snapshot", "raw", "contacts.json"), "utf8"));
const freeEmails = new Set((await readFile(path.join(root, "free-import", "import.csv"), "utf8"))
  .split("\n").slice(1).filter(Boolean).map((row) => row.match(/^"([^"]+)"/)?.[1]).filter(Boolean));
const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const verifiedRows = [];
const legacyOnlyRows = [];
for (const contact of contacts) {
  const p = contact.properties ?? {};
  const email = String(p.email ?? "").trim().toLowerCase();
  if (!freeEmails.has(email)) continue;
  const closedOrder = Boolean(p.hs_first_closed_order_id || p.hs_first_order_closed_date || p.hs_recent_closed_order_date);
  const paymentStatus = Boolean(p.order_last_payment_status);
  const dealHistory = Boolean(p.recent_deal_amount || p.recent_deal_close_date || Number(p.num_associated_deals) > 0);
  const stripeRecord = Boolean(p.stripe_customer_id || p.stripe_created_date || p.stripe_delinquent);
  const legacyCommerceDate = Boolean(p.legacy_commerce_last_date);
  const evidence = [
    closedOrder && "closed_order",
    paymentStatus && "payment_status",
    dealHistory && "deal_history",
    stripeRecord && "stripe_record"
  ].filter(Boolean);
  const row = {
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
    stripe_record: stripeRecord ? "yes" : ""
  };
  // A legacy date alone is excluded: 771 records share one date, showing it was
  // bulk backfilled/migrated rather than being a transaction-level record.
  if (evidence.length) verifiedRows.push(row);
  else if (legacyCommerceDate) legacyOnlyRows.push(row);
}
verifiedRows.sort((a, b) => a.email.localeCompare(b.email));
legacyOnlyRows.sort((a, b) => a.email.localeCompare(b.email));
const outputDir = path.join(root, "review");
await mkdir(outputDir, { recursive: true });
const headers = Object.keys(verifiedRows[0] ?? legacyOnlyRows[0] ?? { email: "" });
const toCsv = (rows) => `${headers.join(",")}\n${rows.map((row) => headers.map((key) => escape(row[key])).join(",")).join("\n")}\n`;
const summary = {
  generatedAt: new Date().toISOString(),
  freeAudienceCount: freeEmails.size,
  verifiedOrderOrPaymentCount: verifiedRows.filter((row) => /closed_order|payment_status|stripe_record/.test(row.evidence)).length,
  verifiedOrderPaymentOrDealCount: verifiedRows.length,
  legacyCommerceDateOnlyCount: legacyOnlyRows.length,
  legacyCommerceDateInterpretation: "Not transaction evidence; excluded from verified counts because it appears bulk backfilled/migrated.",
  evidenceCounts: Object.fromEntries(["closed_order", "payment_status", "deal_history", "stripe_record"].map((type) => [type, verifiedRows.filter((row) => row.evidence.split(";").includes(type)).length]))
};
await writeFile(path.join(outputDir, "payment-associated-free-contacts.csv"), toCsv(verifiedRows), { mode: 0o600 });
await writeFile(path.join(outputDir, "legacy-commerce-date-only-free-contacts.csv"), toCsv(legacyOnlyRows), { mode: 0o600 });
await writeFile(path.join(outputDir, "payment-associated-free-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, ...summary }, null, 2));
