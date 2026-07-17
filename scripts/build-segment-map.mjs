import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { latestLedgerDir } from "../src/manifests.mjs";

const ledgerDir = await latestLedgerDir();
const ledger = JSON.parse(await readFile(path.join(ledgerDir, "canonical-ledger.json"), "utf8"));
const free = JSON.parse(await readFile(path.join(ledgerDir, "free-ranking", "selected.json"), "utf8"));
const now = Date.now();
const daysAgo = (date, days) => date && (now - new Date(date).valueOf()) <= days * 86_400_000;
const eligible = ledger.filter((row) => row.eligibility_status === "eligible");
const lastActivity = (row) => row.engagement.last_click_at || row.engagement.last_open_at || row.engagement.last_seen_at;
const currentLaunchClick = (row) => row.engagement.last_click_at && new Date(row.engagement.last_click_at).valueOf() >= Date.parse("2026-07-01T00:00:00Z");
const customer = (row) => /customer/i.test(row.customer_status ?? "");
const prospect = (row) => !customer(row) && /inquiry|nurture|ready/i.test(row.customer_status ?? "");
const toEmails = (rows) => rows.map((row) => row.email).sort();
const mapping = {
  generatedAt: new Date().toISOString(),
  sourceLedger: ledgerDir,
  segments: [
    ["Free Continuity — Top 1000", free],
    ["All Marketing Eligible", eligible],
    ["Customers", eligible.filter(customer)],
    ["Repeat Customers", eligible.filter((row) => /repeat/i.test(row.customer_status ?? ""))],
    ["Prospects", eligible.filter(prospect)],
    ["Launch Clickers", eligible.filter(currentLaunchClick)],
    ["Historical Clickers", eligible.filter((row) => row.engagement.clicked > 0 && !currentLaunchClick(row))],
    ["Engaged — 30 Days", eligible.filter((row) => daysAgo(lastActivity(row), 30))],
    ["Engaged — 90 Days", eligible.filter((row) => daysAgo(lastActivity(row), 90))],
    ["Engaged — 180 Days", eligible.filter((row) => daysAgo(lastActivity(row), 180))],
    ["Re-engagement Hold", ledger.filter((row) => row.eligibility_status === "legacy_reactivation_hold")],
    ["Verification Hold", ledger.filter((row) => row.suppressions.some((reason) => /verification|unknown|catch|role/i.test(String(reason))))]
  ].map(([name, rows]) => ({ name, count: rows.length, emails: toEmails(rows) }))
};
const output = path.join(ledgerDir, "segment-map");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "hubspot-to-resend-segment-map.json"), `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, segments: mapping.segments.map(({ name, count }) => ({ name, count })) }, null, 2));
