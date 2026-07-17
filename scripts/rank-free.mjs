import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../src/ledger.mjs";

const warehouse = "/Users/vMac/07_warehouse/email_marketing/resend_takeover";
const dirs = (await readdir(warehouse, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith("ledger-")).map((entry) => entry.name).sort();
if (!dirs.length) throw new Error("No ledger found. Run npm run build:ledger first.");
const ledgerDir = path.join(warehouse, dirs.at(-1));
const ledger = JSON.parse(await readFile(path.join(ledgerDir, "canonical-ledger.json"), "utf8"));
const now = Date.now();

function score(record) {
  let points = 0;
  const clicked = record.engagement.clicked > 0;
  const opened = record.engagement.opened > 0;
  if (clicked) points += 75;
  if (record.engagement.replied > 0) points += 90;
  if (/customer/i.test(record.customer_status || "")) points += 50;
  if (record.engagement.form_submissions > 0) points += 30;
  if (record.engagement.delivered > 0) points += 15;
  if (opened) points += 8;
  const last = record.engagement.last_click_at || record.engagement.last_open_at || record.engagement.last_seen_at;
  if (last) {
    const days = (now - new Date(last).valueOf()) / 86_400_000;
    if (days <= 30) points += 30;
    else if (days <= 90) points += 20;
    else if (days <= 180) points += 10;
    else if (days > 365) points -= 10;
  }
  return points;
}

const candidates = ledger
  .filter((record) => record.eligibility_status === "eligible")
  .map((record) => ({ ...record, score: score(record) }))
  .sort((a, b) => b.score - a.score || String(b.engagement.last_seen_at || "").localeCompare(String(a.engagement.last_seen_at || "")) || sha256(a.email).localeCompare(sha256(b.email)));
const selected = candidates.slice(0, 1000);
const outputDir = path.join(ledgerDir, "free-ranking");
await mkdir(outputDir, { recursive: true });
const manifest = { id: `free-${new Date().toISOString().replace(/[:.]/g, "-")}`, mode: "free", sourceLedger: ledgerDir, audienceCount: selected.length, audienceHash: sha256(selected.map((row) => row.email)), approvalStatus: "pending", createdAt: new Date().toISOString() };
await writeFile(path.join(outputDir, "selected.json"), `${JSON.stringify(selected, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, candidates: candidates.length, selected: selected.length, manifest }, null, 2));
