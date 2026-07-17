import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { sha256 } from "../src/ledger.mjs";

const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const ledgerDir = path.join(root, "ledger");
const ledger = JSON.parse(await readFile(path.join(ledgerDir, "canonical-ledger.json"), "utf8"));
const paymentEvidence = parse(await readFile(path.join(root, "review", "payment-customer-classification-evidence.csv"), "utf8"), { columns: true, skip_empty_lines: true });
const paymentBackedContactIds = new Set(paymentEvidence.map((row) => row.hubspot_contact_id));
const now = Date.now();
const hasPaymentEvidence = (record) => record.source_records.some((source) => source.source === "hubspot_50966981" && paymentBackedContactIds.has(source.record_id));
const customerExclusion = (record) => {
  if (record.lifecycle_stage === "customer") return "HubSpot lifecycle stage is Customer";
  if (/customer/i.test(record.customer_status ?? "")) return "HubSpot customer status identifies a customer";
  if (/customer|plan/i.test(record.customer_purchase_profile ?? "")) return "HubSpot purchase profile identifies a customer";
  if (String(record.has_active_subscription ?? "") === "1") return "HubSpot active-subscription flag";
  if (hasPaymentEvidence(record)) return "matched Stripe or GoCardless payment evidence";
  return null;
};
function score(record) {
  let points = 0;
  const reasons = ["Eligible current HubSpot contact with owner-attested consent, no suppression hold, and no customer evidence"];
  if (record.engagement.clicked > 0) { points += 75; reasons.push("+75 prior email click"); }
  if (record.engagement.replied > 0) { points += 90; reasons.push("+90 prior email reply"); }
  if (record.engagement.form_submissions > 0) { points += 30; reasons.push("+30 form submission history"); }
  if (record.engagement.delivered > 0) { points += 15; reasons.push("+15 prior delivery history"); }
  if (record.engagement.opened > 0) { points += 8; reasons.push("+8 prior email open"); }
  const last = record.engagement.last_click_at || record.engagement.last_open_at || record.engagement.last_seen_at;
  if (last) {
    const days = (now - new Date(last).valueOf()) / 86_400_000;
    if (days <= 30) { points += 30; reasons.push("+30 meaningful activity within 30 days"); }
    else if (days <= 90) { points += 20; reasons.push("+20 meaningful activity within 90 days"); }
    else if (days <= 180) { points += 10; reasons.push("+10 meaningful activity within 180 days"); }
    else if (days > 365) { points -= 10; reasons.push("-10 last meaningful activity over one year ago"); }
  }
  return { points, reasons };
}
const eligible = ledger.filter((record) => record.eligibility_status === "eligible");
const exclusions = new Map();
for (const record of eligible) {
  const reason = customerExclusion(record);
  if (reason) exclusions.set(record.record_key, reason);
}
const candidates = eligible.filter((record) => !exclusions.has(record.record_key)).map((record) => ({ ...record, ranking: score(record) }))
  .sort((a, b) => b.ranking.points - a.ranking.points || String(b.engagement.last_seen_at || "").localeCompare(String(a.engagement.last_seen_at || "")) || sha256(a.email).localeCompare(sha256(b.email)));
const selected = candidates.slice(0, 1000).map((record, index) => ({ ...record, selection_rank: index + 1, selection_score: record.ranking.points, selection_reasoning: `Rank ${index + 1} of ${candidates.length}; score ${record.ranking.points}. ${record.ranking.reasons.join("; ")}.` }));
if (selected.length !== 1000) throw new Error(`Expected 1,000 eligible non-customer contacts; found ${selected.length}.`);
if (selected.some((record) => customerExclusion(record))) throw new Error("Safety invariant failed: a current customer was selected.");
const output = path.join(root, "free-prospect-ranking");
await mkdir(output, { recursive: true });
const manifest = { id: `free-prospects-${new Date().toISOString().replace(/[:.]/g, "-")}`, mode: "free_prospects", sourceLedger: ledgerDir, customerEvidenceSource: path.join(root, "review", "payment-customer-classification-evidence.csv"), audienceCount: selected.length, eligibleNonCustomerCandidates: candidates.length, excludedCurrentCustomers: exclusions.size, audienceHash: sha256(selected.map((row) => row.email)), approvalStatus: "pending", createdAt: new Date().toISOString() };
await writeFile(path.join(output, "selected.json"), `${JSON.stringify(selected, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, ...manifest }, null, 2));
