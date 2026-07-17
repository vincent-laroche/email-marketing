import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../src/ledger.mjs";

const warehouse = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const ledgerDir = path.join(warehouse, "ledger");
const ledger = JSON.parse(await readFile(path.join(ledgerDir, "canonical-ledger.json"), "utf8"));
const now = Date.now();

function score(record) {
  let points = 0;
  const reasons = ["Eligible: current HubSpot contact with owner-attested consent and no suppression hold"];
  const clicked = record.engagement.clicked > 0;
  const opened = record.engagement.opened > 0;
  if (clicked) { points += 75; reasons.push("+75 prior email click"); }
  if (record.engagement.replied > 0) { points += 90; reasons.push("+90 prior email reply"); }
  if (/customer/i.test(record.customer_status || "")) { points += 50; reasons.push("+50 customer status"); }
  if (record.engagement.form_submissions > 0) { points += 30; reasons.push("+30 form submission history"); }
  if (record.engagement.delivered > 0) { points += 15; reasons.push("+15 prior delivery history"); }
  if (opened) { points += 8; reasons.push("+8 prior email open"); }
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

const candidates = ledger
  .filter((record) => record.eligibility_status === "eligible")
  .map((record) => ({ ...record, ranking: score(record) }))
  .sort((a, b) => b.ranking.points - a.ranking.points || String(b.engagement.last_seen_at || "").localeCompare(String(a.engagement.last_seen_at || "")) || sha256(a.email).localeCompare(sha256(b.email)));
const selected = candidates.slice(0, 1000).map((record, index) => ({
  ...record,
  selection_rank: index + 1,
  selection_score: record.ranking.points,
  selection_reasoning: `Rank ${index + 1} of ${candidates.length}; score ${record.ranking.points}. ${record.ranking.reasons.join("; ")}.`
}));
const outputDir = path.join(warehouse, "free-ranking");
await mkdir(outputDir, { recursive: true });
const manifest = { id: `free-${new Date().toISOString().replace(/[:.]/g, "-")}`, mode: "free", sourceLedger: ledgerDir, audienceCount: selected.length, audienceHash: sha256(selected.map((row) => row.email)), approvalStatus: "pending", createdAt: new Date().toISOString() };
await writeFile(path.join(outputDir, "selected.json"), `${JSON.stringify(selected, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, candidates: candidates.length, selected: selected.length, manifest }, null, 2));
