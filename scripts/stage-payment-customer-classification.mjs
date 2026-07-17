import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse";

const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const sourceFiles = {
  stripe: "/Users/vMac/Downloads/unified_payments.csv",
  goCardless: "/Users/vMac/Downloads/consolidated_payments_master_cleaned.csv"
};
const contacts = JSON.parse(await readFile(path.join(root, "hubspot-snapshot", "raw", "contacts.json"), "utf8"));
const emailKey = (value) => String(value ?? "").trim().toLowerCase();
const nameKey = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const byEmail = new Map();
const byName = new Map();
for (const contact of contacts) {
  const properties = contact.properties ?? {};
  const email = emailKey(properties.email);
  const name = nameKey(`${properties.firstname ?? ""} ${properties.lastname ?? ""}`);
  if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), contact]);
  if (name.length >= 5) byName.set(name, [...(byName.get(name) ?? []), contact]);
}
const resolve = (email, name) => {
  const emailMatches = byEmail.get(emailKey(email)) ?? [];
  if (emailMatches.length) return { contacts: emailMatches, basis: "exact_email" };
  const nameMatches = byName.get(nameKey(name)) ?? [];
  return nameMatches.length === 1 ? { contacts: nameMatches, basis: "unique_normalized_name" } : null;
};
const evidence = new Map();
const addEvidence = (resolved, source, transactionId, occurredAt) => {
  if (!resolved) return;
  for (const contact of resolved.contacts) {
    const row = evidence.get(contact.id) ?? { contact, sources: new Set(), matchBases: new Set(), transactionIds: new Set(), latestPaymentDate: "" };
    row.sources.add(source);
    row.matchBases.add(resolved.basis);
    if (transactionId) row.transactionIds.add(transactionId);
    if (occurredAt && occurredAt > row.latestPaymentDate) row.latestPaymentDate = occurredAt;
    evidence.set(contact.id, row);
  }
};

let stripeCompleted = 0;
for await (const row of createReadStream(sourceFiles.stripe).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true }))) {
  if (String(row.Status ?? "").trim().toLowerCase() !== "paid") continue;
  stripeCompleted += 1;
  addEvidence(resolve(row["Customer Email"], row["Shipping Name"] || row["Card Name"]), "stripe_paid", row.id, row["Created date (UTC)"]);
}
let goCardlessRows = 0;
for await (const row of createReadStream(sourceFiles.goCardless).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true }))) {
  if (String(row.source ?? "") !== "GoCardless") continue;
  // Owner-confirmed source: GoCardless was used only for subscriptions. Keep all rows as customer evidence,
  // including later failed/cancelled collection attempts for an established subscriber.
  goCardlessRows += 1;
  addEvidence(resolve(row.email, row.name), "gocardless_subscription", row.transaction_id, row.date_norm || row.date);
}

const records = [...evidence.values()].map(({ contact, sources, matchBases, transactionIds, latestPaymentDate }) => {
  const p = contact.properties ?? {};
  return {
    hubspot_contact_id: contact.id,
    email: p.email ?? "",
    first_name: p.firstname ?? "",
    last_name: p.lastname ?? "",
    current_contact_type: p.contact_type ?? "",
    current_lifecycle_stage: p.lifecyclestage ?? "",
    proposed_contact_type: "consumer",
    proposed_lifecycle_stage: "customer",
    match_basis: [...matchBases].sort().join(";"),
    evidence_sources: [...sources].sort().join(";"),
    payment_record_count: transactionIds.size,
    latest_payment_date: latestPaymentDate
  };
}).sort((a, b) => a.email.localeCompare(b.email));
const updates = records.filter((row) => row.current_contact_type !== "consumer" || row.current_lifecycle_stage !== "customer");
const headers = Object.keys(records[0] ?? { hubspot_contact_id: "" });
const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (rows) => `${headers.join(",")}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(",")).join("\n")}\n`;
const output = path.join(root, "review");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "payment-customer-classification-evidence.csv"), csv(records), { mode: 0o600 });
await writeFile(path.join(output, "payment-customer-classification-proposed-updates.csv"), csv(updates), { mode: 0o600 });
await writeFile(path.join(output, "payment-customer-classification-summary.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceFiles,
  matching: "Exact email (all matching current HubSpot contacts) first; then a unique normalized full-name match. Ambiguous name-only matches excluded.",
  paymentEvidence: "Completed Stripe payments plus all GoCardless subscription records; failed Stripe payment attempts excluded.",
  stripeCompleted,
  goCardlessRows,
  matchedContacts: records.length,
  contactsRequiringUpdate: updates.length,
  alreadyCorrect: records.length - updates.length
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ matchedContacts: records.length, contactsRequiringUpdate: updates.length }, null, 2));
