import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const env = await readFile("/Users/vMac/.env", "utf8");
const token = [...env.matchAll(/^HUBSPOT_SERVICE_KEY=(.+)$/gm)]
  .map((match) => match[1].trim().replace(/^[\"']|[\"']$/g, ""))
  .at(-1);
if (!token) throw new Error("HUBSPOT_SERVICE_KEY is unavailable.");

const contacts = JSON.parse(await readFile(path.join(root, "hubspot-snapshot", "raw", "contacts.json"), "utf8"));
const freeEmails = new Set((await readFile(path.join(root, "free-import", "import.csv"), "utf8"))
  .split("\n").slice(1).filter(Boolean).map((row) => row.match(/^\"([^\"]+)\"/)?.[1]).filter(Boolean));
const selected = contacts.filter((contact) => freeEmails.has(String(contact.properties?.email ?? "").trim().toLowerCase()));
const contactById = new Map(selected.map((contact) => [String(contact.id), contact]));
const chunk = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const request = async (pathname, body) => {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HubSpot read failed for ${pathname}: ${response.status}`);
  return response.json();
};

const associationResults = [];
for (const contactsBatch of chunk(selected, 100)) {
  const result = await request("/crm/v4/associations/contacts/deals/batch/read", { inputs: contactsBatch.map((contact) => ({ id: contact.id })) });
  associationResults.push(...result.results);
}
const dealIds = [...new Set(associationResults.flatMap((association) => (association.to ?? []).map((target) => String(target.toObjectId))))];
const deals = [];
for (const dealBatch of chunk(dealIds, 100)) {
  const result = await request("/crm/v3/objects/deals/batch/read", {
    properties: ["amount", "closedate", "createdate", "dealstage", "hs_is_closed", "hs_is_closed_won"],
    inputs: dealBatch.map((id) => ({ id }))
  });
  deals.push(...result.results);
}
const dealById = new Map(deals.map((deal) => [String(deal.id), deal]));
const lowValue = (deal) => {
  const amount = Number(deal.properties?.amount);
  return amount >= 80 && amount <= 250;
};
const closedWon = (deal) => String(deal.properties?.dealstage ?? "").toLowerCase() === "closedwon" || String(deal.properties?.hs_is_closed_won ?? "").toLowerCase() === "true";
const escape = (value) => `\"${String(value ?? "").replaceAll('\"', '\"\"')}\"`;
const allLowValueRows = [];
const reviewCandidates = [];
for (const association of associationResults) {
  const contact = contactById.get(String(association.from.id));
  const linkedDeals = (association.to ?? []).map((target) => dealById.get(String(target.toObjectId))).filter(Boolean);
  const paymentSizedDeals = linkedDeals.filter(lowValue);
  if (!paymentSizedDeals.length) continue;
  const closedWonPaymentSizedDeals = paymentSizedDeals.filter(closedWon);
  const row = {
    email: contact.properties?.email ?? "",
    first_name: contact.properties?.firstname ?? "",
    last_name: contact.properties?.lastname ?? "",
    current_purchase_profile: contact.properties?.customer_purchase_profile ?? "",
    active_subscription_flag: contact.properties?.hs_has_active_subscription ?? "",
    associated_deal_count: linkedDeals.length,
    payment_sized_deal_count: paymentSizedDeals.length,
    payment_sized_closed_won_count: closedWonPaymentSizedDeals.length,
    payment_sized_amounts: paymentSizedDeals.map((deal) => deal.properties?.amount ?? "").join(";"),
    payment_sized_closed_won_amounts: closedWonPaymentSizedDeals.map((deal) => deal.properties?.amount ?? "").join(";"),
    payment_sized_deal_dates: paymentSizedDeals.map((deal) => deal.properties?.closedate || deal.properties?.createdate || "").join(";"),
    assessment: closedWonPaymentSizedDeals.length >= 2 ? "review_candidate_repeated_low_value_closed_won_deals" : "single_low_value_deal_not_sufficient"
  };
  allLowValueRows.push(row);
  if (closedWonPaymentSizedDeals.length >= 2) reviewCandidates.push(row);
}
allLowValueRows.sort((a, b) => a.email.localeCompare(b.email));
reviewCandidates.sort((a, b) => a.email.localeCompare(b.email));
const headers = Object.keys(allLowValueRows[0] ?? { email: "" });
const toCsv = (rows) => `${headers.join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}\n`;
const outputDir = path.join(root, "review");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "low-value-deal-patterns-free-contacts.csv"), toCsv(allLowValueRows), { mode: 0o600 });
await writeFile(path.join(outputDir, "suspected-recurring-plan-customers-free-contacts.csv"), toCsv(reviewCandidates), { mode: 0o600 });
const summary = {
  generatedAt: new Date().toISOString(),
  source: "Live HubSpot contact-to-deal associations and deal records; read-only",
  freeAudienceCount: selected.length,
  contactsWithAssociatedDeals: associationResults.filter((association) => (association.to ?? []).length > 0).length,
  contactsWithOneOrMore80to250Deals: allLowValueRows.length,
  contactsWithTwoOrMore80to250ClosedWonDeals: reviewCandidates.length,
  contactsWithThreeOrMore80to250ClosedWonDeals: reviewCandidates.filter((row) => Number(row.payment_sized_closed_won_count) >= 3).length,
  interpretation: "Repeated closed-won deals in this range are review signals only, not proof of a monthly plan. No audience or suppression status was changed."
};
await writeFile(path.join(outputDir, "recurring-plan-patterns-free-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, ...summary }, null, 2));
