import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";
import { latestLedgerDir, warehouseRoot } from "../src/manifests.mjs";

const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");
if (apply === dryRun) throw new Error("Use exactly one of --dry-run or --apply.");
const ledgerDir = await latestLedgerDir();
const ledger = JSON.parse(await readFile(path.join(ledgerDir, "canonical-ledger.json"), "utf8"));
const now = new Date().toISOString();
const q = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const statements = ["PRAGMA foreign_keys = ON;"];
for (const contact of ledger) {
  statements.push(`INSERT INTO contacts (email, first_name, last_name, lifecycle_stage, customer_status, customer_tier, engagement_tier, last_meaningful_activity_at, consent_status, eligibility_status, suppression_reason, source_portals, created_at, updated_at) VALUES (${q(contact.email)}, ${q(contact.first_name)}, ${q(contact.last_name)}, ${q(contact.lifecycle_stage)}, ${q(contact.customer_status)}, NULL, NULL, ${q(contact.engagement.last_click_at || contact.engagement.last_open_at || contact.engagement.last_seen_at)}, ${q(contact.consent.status)}, ${q(contact.eligibility_status)}, ${q(contact.suppression_reason)}, ${q(JSON.stringify(contact.source_portals))}, ${q(now)}, ${q(now)}) ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,lifecycle_stage=excluded.lifecycle_stage,customer_status=excluded.customer_status,last_meaningful_activity_at=excluded.last_meaningful_activity_at,consent_status=excluded.consent_status,eligibility_status=excluded.eligibility_status,suppression_reason=excluded.suppression_reason,source_portals=excluded.source_portals,updated_at=excluded.updated_at;`);
  for (const source of contact.source_records) statements.push(`INSERT INTO contact_sources (email, source_name, portal_id, source_record_id, source_checksum, first_observed_at, last_observed_at) VALUES (${q(contact.email)}, ${q(source.source)}, ${q(source.portal_id)}, ${q(source.record_id)}, ${q(contact.record_key)}, ${q(now)}, ${q(now)}) ON CONFLICT(email,source_name,source_record_id) DO UPDATE SET last_observed_at=excluded.last_observed_at;`);
  statements.push(`INSERT INTO consent_evidence (id,email,marketing_topic,consent_status,consent_timestamp,timestamp_quality,source_system,source_record,form_or_page,consent_wording,confirmation_status,form_version,ip_evidence,user_agent_evidence,evidence_quality,inference_rule,owner_attested_by,owner_attested_at,notes) VALUES (${q(`${contact.record_key}:consent`)},${q(contact.email)},'Marketing updates',${q(contact.consent.status)},NULL,'not_recorded',${q(contact.consent.source_system)},${q(contact.consent.source_record)},NULL,NULL,'not_recorded',NULL,NULL,NULL,${q(contact.consent.evidence_quality)},'canonical-ledger',${q(contact.consent.status === 'owner_attested_explicit' ? 'Vincent Laroche' : null)},${q(contact.consent.status === 'owner_attested_explicit' ? now : null)},'Imported from immutable canonical ledger') ON CONFLICT(id) DO NOTHING;`);
  for (const suppression of contact.suppressions) {
    const reason = typeof suppression === "string" ? suppression : suppression.reason;
    const source = typeof suppression === "string" ? "HubSpot" : suppression.source ?? "HubSpot";
    const observedAt = typeof suppression === "string" ? null : suppression.observed_at;
    statements.push(`INSERT INTO suppressions (id,email,reason,scope,source_system,observed_at,permanent,created_at) VALUES (${q(`${contact.record_key}:${reason}`)},${q(contact.email)},${q(reason)},'global',${q(source)},${q(observedAt)},1,${q(now)}) ON CONFLICT(id) DO NOTHING;`);
  }
}
statements.push(`INSERT INTO sync_runs (id,operation,status,summary_json,created_at,completed_at) VALUES (${q(`ledger:${now}`)},'ledger-load','completed',${q(JSON.stringify({ ledgerDir, contacts: ledger.length }))},${q(now)},${q(now)});`);
const outputDir = path.join(warehouseRoot, "d1-loads");
await mkdir(outputDir, { recursive: true });
const sqlPath = path.join(outputDir, `ledger-${now.replace(/[:.]/g, "-")}.sql`);
await writeFile(sqlPath, `${statements.join("\n")}\n`, { mode: 0o600 });
console.log(JSON.stringify({ action: dryRun ? "dry-run" : "apply", ledgerDir, contacts: ledger.length, statements: statements.length, sqlPath }, null, 2));
if (dryRun) process.exit(0);
const env = await loadNamedEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN"]);
const child = spawn("npx", ["wrangler", "d1", "execute", "email-marketing-control-plane", "--remote", `--file=${sqlPath}`], { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: requireEnv(env, "CLOUDFLARE_ACCOUNT_ID"), CLOUDFLARE_API_TOKEN: requireEnv(env, "CLOUDFLARE_MASTER_ACCOUNT_API_TOKEN") }, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
