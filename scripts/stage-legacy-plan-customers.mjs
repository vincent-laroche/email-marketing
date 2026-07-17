import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse";

const currentRoot = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const sourceFiles = {
  stripeRaw: "/Users/vMac/Downloads/unified_payments.csv",
  stripeCharges: "/Users/vMac/Downloads/Stripe Charges 22af4e0d84e08025ace4e579193d30e4_all.csv",
  consolidated: "/Users/vMac/Downloads/consolidated_payments_master_cleaned.csv"
};
const contacts = JSON.parse(await readFile(path.join(currentRoot, "hubspot-snapshot", "raw", "contacts.json"), "utf8"));
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const normalizeName = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const byEmail = new Map();
const byName = new Map();
for (const contact of contacts) {
  const properties = contact.properties ?? {};
  const email = normalizeEmail(properties.email);
  if (email) byEmail.set(email, contact);
  const name = normalizeName(`${properties.firstname ?? ""} ${properties.lastname ?? ""}`);
  if (name.length >= 5) byName.set(name, [...(byName.get(name) ?? []), contact]);
}
const resolve = (email, name) => {
  const emailMatch = byEmail.get(normalizeEmail(email));
  if (emailMatch) return { contact: emailMatch, basis: "exact_email" };
  const nameMatches = byName.get(normalizeName(name)) ?? [];
  return nameMatches.length === 1 ? { contact: nameMatches[0], basis: "unique_normalized_name" } : null;
};
const evidence = new Map();
const addEvidence = (resolved, source, detail) => {
  if (!resolved) return;
  const item = evidence.get(resolved.contact.id) ?? { contact: resolved.contact, sources: [], matchBases: new Set(), recurringStripePayments: 0 };
  item.sources.push({ source, detail });
  item.matchBases.add(resolved.basis);
  evidence.set(resolved.contact.id, item);
};
const stripePaymentGroups = new Map();

for await (const row of createReadStream(sourceFiles.consolidated).pipe(parse({ columns: true, skip_empty_lines: true }))) {
  const resolved = resolve(row.email, row.name);
  if (row.source === "GoCardless") {
    // Vincent confirmed GoCardless was used only for subscriptions.
    addEvidence(resolved, "gocardless_subscription", `status=${row.status || "unknown"}`);
  }
  if (row.source === "Stripe" && String(row.status).toLowerCase() === "paid") {
    const amount = Number(row.amount);
    const email = normalizeEmail(row.email);
    if (email && amount >= 80 && amount <= 250) {
      const key = `${email}|${String(row.currency ?? "").toLowerCase()}|${amount.toFixed(2)}`;
      const group = stripePaymentGroups.get(key) ?? { count: 0, resolved };
      group.count += 1;
      stripePaymentGroups.set(key, group);
    }
  }
}
for await (const row of createReadStream(sourceFiles.stripeRaw).pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true }))) {
  if (String(row.Status).toLowerCase() !== "paid") continue;
  const signalText = [row.Description, row["plan_id (metadata)"], row["plan_number (metadata)"], row["Invoice Number"], row["Checkout Line Item Summary"]].join(" ");
  if (row["plan_id (metadata)"] || /subscription|partial\.ly|scheduled installment|\bplan\b/i.test(signalText)) {
    addEvidence(resolve(row["Customer Email"], row["Shipping Name"]), "stripe_plan_or_subscription_metadata", "paid Stripe record with explicit plan/subscription signal");
  }
}
for await (const row of createReadStream(sourceFiles.stripeCharges).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true }))) {
  if (row.subscription_id) addEvidence(resolve(row.customer_email, row["Customer Name"]), "stripe_subscription_id", "Stripe subscription ID present");
}
for (const [key, group] of stripePaymentGroups) {
  // Three paid charges at the same $80–$250 amount is the minimum recurring-payment pattern.
  if (group.count >= 3) {
    addEvidence(group.resolved, "stripe_repeated_low_value_paid_charges", `${group.count} paid charges at ${key.split("|").slice(1).join(" ")}`);
    const item = evidence.get(group.resolved?.contact.id);
    if (item) item.recurringStripePayments = Math.max(item.recurringStripePayments, group.count);
  }
}
const outputRows = [...evidence.values()].map(({ contact, sources, matchBases, recurringStripePayments }) => {
  const p = contact.properties ?? {};
  const activeSubscription = String(p.hs_has_active_subscription ?? "") === "1";
  const alreadyFormer = p.customer_purchase_profile === "former_plan_customer";
  const proposed = activeSubscription || alreadyFormer ? "" : "former_plan_customer";
  const action = activeSubscription ? "review_no_change_active_subscription_flag" : alreadyFormer ? "already_classified_no_change" : "proposed_update";
  return {
    hubspot_contact_id: contact.id,
    email: p.email ?? "",
    first_name: p.firstname ?? "",
    last_name: p.lastname ?? "",
    current_customer_purchase_profile: p.customer_purchase_profile ?? "",
    hs_has_active_subscription: p.hs_has_active_subscription ?? "",
    proposed_customer_purchase_profile: proposed,
    action,
    match_basis: [...matchBases].sort().join(";"),
    evidence_sources: [...new Set(sources.map((source) => source.source))].sort().join(";"),
    evidence_details: sources.map((source) => source.detail).join(" | "),
    recurring_stripe_payment_count: recurringStripePayments || ""
  };
}).sort((a, b) => a.email.localeCompare(b.email));
const proposedRows = outputRows.filter((row) => row.action === "proposed_update");
const headers = Object.keys(outputRows[0] ?? { hubspot_contact_id: "" });
const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const toCsv = (rows) => `${headers.join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}\n`;
const outputDir = path.join(currentRoot, "review");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "legacy-plan-customer-evidence.csv"), toCsv(outputRows), { mode: 0o600 });
await writeFile(path.join(outputDir, "legacy-plan-customer-proposed-hubspot-updates.csv"), toCsv(proposedRows), { mode: 0o600 });
const summary = {
  generatedAt: new Date().toISOString(),
  sources: sourceFiles,
  matching: "exact email first; unique normalized full-name only when no exact email match; ambiguous names excluded",
  candidateCount: outputRows.length,
  proposedFormerPlanCustomerUpdates: proposedRows.length,
  alreadyFormerPlanCustomer: outputRows.filter((row) => row.action === "already_classified_no_change").length,
  activeSubscriptionFlagReview: outputRows.filter((row) => row.action === "review_no_change_active_subscription_flag").length,
  rule: "GoCardless rows are subscription evidence by owner confirmation. Stripe requires explicit subscription/plan metadata, a Stripe subscription ID, or at least three paid $80–$250 charges at the same amount.",
  nextStep: "Requires explicit approval of the staged proposed-update CSV before HubSpot contact-property writes and local artifact rebuild."
};
await writeFile(path.join(outputDir, "legacy-plan-customer-staging-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, ...summary }, null, 2));
