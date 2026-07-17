import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../src/ledger.mjs";

const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.split("=")[1] ?? "free";
if (!["free", "pro"].includes(mode)) throw new Error("Use --mode=free or --mode=pro");
const root = "/Users/vMac/07_warehouse/email_marketing/resend_takeover";
const dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith("ledger-")).map((entry) => entry.name).sort();
if (!dirs.length) throw new Error("No ledger found");
const ledgerDir = path.join(root, dirs.at(-1));
const ledger = JSON.parse(await readFile(path.join(ledgerDir, "canonical-ledger.json"), "utf8"));
const eligible = ledger.filter((record) => record.eligibility_status === "eligible");
const rankingPath = path.join(ledgerDir, "free-ranking", "selected.json");
const selected = mode === "free"
  ? JSON.parse(await readFile(rankingPath, "utf8"))
  : eligible;
const cap = mode === "free" ? 1000 : 5000;
if (selected.some((record) => record.suppression_reason || !record.active_portal)) throw new Error("Safety invariant failed: unsafe contact selected");
if (selected.length > cap) throw new Error(`Contact cap exceeded for ${mode}`);
const destination = path.join(ledgerDir, `resend-${mode}`);
await mkdir(destination, { recursive: true });
const headers = ["email", "first_name", "last_name", "customer_status", "customer_tier", "lifecycle_stage", "engagement_tier", "last_meaningful_activity", "source_portals", "consent_evidence_quality", "migration_cohort"];
const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const rows = selected.map((record) => [record.email, record.first_name, record.last_name, record.customer_status, null, record.lifecycle_stage, record.engagement_tier, record.engagement.last_click_at || record.engagement.last_open_at || record.engagement.last_seen_at, record.source_portals.join(";"), record.consent.evidence_quality, mode].map(escape).join(","));
const csv = `${headers.join(",")}\n${rows.join("\n")}\n`;
const manifest = { id: `resend-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`, mode, sourceLedger: ledgerDir, rankingSource: mode === "free" ? rankingPath : null, audienceCount: selected.length, audienceHash: sha256(selected.map((record) => record.email)), csvSha256: sha256(csv), approvalStatus: "pending", createdAt: new Date().toISOString() };
await writeFile(path.join(destination, "import.csv"), csv, { mode: 0o600 });
await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ destination, manifest }, null, 2));
