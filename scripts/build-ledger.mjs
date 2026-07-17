import { readdir, readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { normalizeEmail, parseCount, sha256, strongestSuppression, latestTimestamp, valueForHeader } from "../src/ledger.mjs";

const warehouse = "/Users/vMac/07_warehouse/email_marketing/resend_takeover";
const legacySources = [
  { name: "hubspot_4046266", portalId: "4046266", path: "/Users/vMac/07_warehouse/hubspot/outputs-20260612/exports/4046266/hubspot-crm-exports-all-contacts-4046266.csv" },
  { name: "hubspot_26557089", portalId: "26557089", path: "/Users/vMac/07_warehouse/hubspot/outputs-20260612/exports/26557089/hubspot-crm-exports-all-contacts-26557089.zip", zipEntry: "all-contacts.csv" },
  { name: "hubspot_4046266_cleaned", portalId: "4046266", path: "/Users/vMac/07_warehouse/_warehouse_inbox/Contacts Engagement - Hubspot Contacts (Columns Cleaned) - hubspot 266f4e0d84e0806bb754c7a4e664043d_all.csv" }
];
const verificationSource = {
  name: "millionverifier_top500",
  path: "/Users/vMac/Downloads/150120_hubspot_1298_20260709221210_FULL_REPORT_MILLIONVERIFIER.COM.csv"
};

const snapshotDirs = (await readdir(warehouse, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("hubspot-50966981-"))
  .map((entry) => entry.name)
  .sort();
if (!snapshotDirs.length) throw new Error("No HubSpot snapshot found. Run npm run snapshot:hubspot first.");
const snapshotDir = path.join(warehouse, snapshotDirs.at(-1));
const snapshotManifest = JSON.parse(await readFile(path.join(snapshotDir, "manifest.json"), "utf8"));
const outputDir = path.join(warehouse, `ledger-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(outputDir, { recursive: true });

const attestationPath = path.join(warehouse, "owner-attestation.json");
let attestation = null;
try {
  await access(attestationPath);
  attestation = JSON.parse(await readFile(attestationPath, "utf8"));
  if (!attestation.attestedBy || !attestation.attestedAt || !attestation.scope) throw new Error("owner-attestation.json is missing attestedBy, attestedAt, or scope");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

async function readCsv(source) {
  let text;
  if (source.zipEntry) {
    const zip = new AdmZip(source.path);
    const entry = zip.getEntry(source.zipEntry);
    if (!entry) throw new Error(`${source.name}: ZIP entry ${source.zipEntry} not found`);
    text = entry.getData().toString("utf8");
  } else {
    text = await readFile(source.path, "utf8");
  }
  return parse(text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
}

function makeRecord(email) {
  return {
    email,
    first_name: null,
    last_name: null,
    lifecycle_stage: null,
    customer_status: null,
    source_portals: new Set(),
    source_records: [],
    engagement: { delivered: 0, opened: 0, clicked: 0, replied: 0, form_submissions: 0, pageviews: 0, sessions: 0, last_seen_at: null, last_open_at: null, last_click_at: null },
    suppressions: [],
    consent: { status: "not_recorded", evidence_quality: "not_recorded", source_system: "HubSpot", source_record: null },
    active_portal: false
  };
}

const contacts = new Map();
function matchingValues(row, patterns) {
  return Object.entries(row)
    .filter(([key]) => patterns.some((pattern) => pattern.test(key.toLowerCase())))
    .map(([, value]) => value);
}
function anyPositive(row, patterns) {
  return matchingValues(row, patterns).some((value) => parseCount(value) > 0 || /^(true|yes)$/i.test(String(value ?? "").trim()));
}
function upsert(email) {
  if (!contacts.has(email)) contacts.set(email, makeRecord(email));
  return contacts.get(email);
}

const rawContacts = JSON.parse(await readFile(path.join(snapshotDir, "raw", "contacts.json"), "utf8"));
for (const contact of rawContacts) {
  const properties = contact.properties ?? {};
  const email = normalizeEmail(properties.email);
  if (!email) continue;
  const record = upsert(email);
  record.active_portal = true;
  record.source_portals.add("50966981");
  record.source_records.push({ source: "hubspot_50966981", portal_id: "50966981", record_id: contact.id });
  record.first_name ??= properties.firstname || null;
  record.last_name ??= properties.lastname || null;
  record.lifecycle_stage ??= properties.lifecyclestage || null;
  record.customer_status ??= properties.hs_lead_status || properties.customer_status || null;
  const attestedEmails = new Set((attestation?.emails ?? []).map(normalizeEmail).filter(Boolean));
  const wholeCurrentScope = attestation?.scope === "all_current_active_hubspot_contacts";
  if (wholeCurrentScope || attestedEmails.has(email)) {
    record.consent = {
      status: "owner_attested_explicit",
      evidence_quality: "owner_attested",
      source_system: "Owner attestation",
      source_record: `snapshot:${snapshotManifest.manifestSha256}`,
      owner_attested_by: attestation.attestedBy,
      owner_attested_at: attestation.attestedAt,
      notes: attestation.statement ?? null
    };
  }
  record.engagement.delivered = Math.max(record.engagement.delivered, parseCount(valueForHeader(properties, [/marketing.*email.*delivered/, /num.*delivered/, /email.*delivered/])));
  record.engagement.opened = Math.max(record.engagement.opened, parseCount(valueForHeader(properties, [/marketing.*email.*opened/, /num.*opened/, /email.*opened/])));
  record.engagement.clicked = Math.max(record.engagement.clicked, parseCount(valueForHeader(properties, [/marketing.*email.*clicked/, /num.*clicked/, /email.*clicked/])));
  record.engagement.replied = Math.max(record.engagement.replied, parseCount(valueForHeader(properties, [/marketing.*email.*repl/, /num.*repl/, /email.*repl/])));
  record.engagement.form_submissions = Math.max(record.engagement.form_submissions, parseCount(valueForHeader(properties, [/form.*submission/] )));
  record.engagement.pageviews = Math.max(record.engagement.pageviews, parseCount(valueForHeader(properties, [/pageview/] )));
  record.engagement.sessions = Math.max(record.engagement.sessions, parseCount(valueForHeader(properties, [/session/] )));
  record.engagement.last_seen_at = latestTimestamp(record.engagement.last_seen_at, valueForHeader(properties, [/time.*last.*seen/, /last.*seen/]));
  record.engagement.last_open_at = latestTimestamp(record.engagement.last_open_at, valueForHeader(properties, [/last.*open/]));
  record.engagement.last_click_at = latestTimestamp(record.engagement.last_click_at, valueForHeader(properties, [/last.*click/]));
  if (String(properties.hs_email_communication_subscriptions_opted_out || "").trim()) record.suppressions.push("unsubscribe");
  if (/true|yes|1/i.test(String(properties.hs_email_bad_address || properties.hs_email_is_ineligible || ""))) record.suppressions.push("hard_bounce");
}

const sourceSummary = [];
for (const source of legacySources) {
  const rows = await readCsv(source);
  let matched = 0;
  for (const row of rows) {
    const email = normalizeEmail(valueForHeader(row, [/^email$/, /^email address$/, /email address/]));
    if (!email) continue;
    const record = upsert(email);
    if (record.active_portal) matched += 1;
    record.source_portals.add(source.portalId);
    record.source_records.push({ source: source.name, portal_id: source.portalId, record_id: valueForHeader(row, [/^record id$/, /^id$/]) || null });
    record.first_name ??= valueForHeader(row, [/^first name$/, /^firstname$/]) || null;
    record.last_name ??= valueForHeader(row, [/^last name$/, /^lastname$/]) || null;
    record.engagement.delivered = Math.max(record.engagement.delivered, parseCount(valueForHeader(row, [/marketing.*email.*delivered/, /email.*delivered/] )));
    record.engagement.opened = Math.max(record.engagement.opened, parseCount(valueForHeader(row, [/marketing.*email.*opened/, /email.*opened/] )));
    record.engagement.clicked = Math.max(record.engagement.clicked, parseCount(valueForHeader(row, [/marketing.*email.*clicked/, /email.*clicked/] )));
    record.engagement.replied = Math.max(record.engagement.replied, parseCount(valueForHeader(row, [/marketing.*email.*repl/, /email.*repl/] )));
    record.engagement.form_submissions = Math.max(record.engagement.form_submissions, parseCount(valueForHeader(row, [/form.*submission/] )));
    record.engagement.pageviews = Math.max(record.engagement.pageviews, parseCount(valueForHeader(row, [/pageview/] )));
    record.engagement.sessions = Math.max(record.engagement.sessions, parseCount(valueForHeader(row, [/session/] )));
    record.engagement.last_seen_at = latestTimestamp(record.engagement.last_seen_at, valueForHeader(row, [/time.*last.*seen/, /last.*seen/]));
    record.engagement.last_open_at = latestTimestamp(record.engagement.last_open_at, valueForHeader(row, [/last.*open/]));
    record.engagement.last_click_at = latestTimestamp(record.engagement.last_click_at, valueForHeader(row, [/last.*click/]));
    if (anyPositive(row, [/hard.*bounce/, /marketing.*email.*bounce/])) record.suppressions.push("hard_bounce");
    if (anyPositive(row, [/opted.*out.*email/, /unsubscribed.*email/])) record.suppressions.push("unsubscribe");
  }
  sourceSummary.push({ ...source, rowCount: rows.length, currentPortalMatches: matched });
}

const verificationRows = await readCsv(verificationSource);
let verificationMatched = 0;
const verificationCounts = { invalid_disposable: 0, verification_hold: 0 };
for (const row of verificationRows) {
  const email = normalizeEmail(valueForHeader(row, [/^email$/]));
  if (!email) continue;
  const record = upsert(email);
  if (record.active_portal) verificationMatched += 1;
  const result = String(valueForHeader(row, [/^result$/]) ?? "").trim().toLowerCase();
  const quality = String(valueForHeader(row, [/^quality$/]) ?? "").trim().toLowerCase();
  const role = /^(yes|true|1)$/i.test(String(valueForHeader(row, [/^role$/]) ?? "").trim());
  if (result === "invalid" || quality === "bad") {
    record.suppressions.push("invalid_disposable");
    verificationCounts.invalid_disposable += 1;
  } else if (result === "unknown" || /catch/.test(result) || role) {
    record.suppressions.push("verification_hold");
    verificationCounts.verification_hold += 1;
  }
  record.source_records.push({ source: verificationSource.name, portal_id: null, record_id: null });
}
sourceSummary.push({ ...verificationSource, rowCount: verificationRows.length, currentPortalMatches: verificationMatched, verificationCounts });

const ledger = [...contacts.values()].map((record) => {
  const suppression_reason = strongestSuppression(record.suppressions);
  const eligibility_status = record.active_portal && !suppression_reason && record.consent.status !== "unknown" && record.consent.status !== "not_recorded"
    ? "eligible"
    : record.active_portal ? (suppression_reason ? "suppressed" : "consent_review") : "legacy_reactivation_hold";
  return {
    ...record,
    source_portals: [...record.source_portals].sort(),
    suppressions: [...new Set(record.suppressions)],
    suppression_reason,
    eligibility_status,
    record_key: sha256(record.email)
  };
}).sort((a, b) => a.email.localeCompare(b.email));

const report = {
  generatedAt: new Date().toISOString(),
  snapshotDir,
  snapshotManifestSha256: snapshotManifest.manifestSha256,
  totalContacts: ledger.length,
  currentPortalContacts: ledger.filter((record) => record.active_portal).length,
  currentPortalEmailContacts: rawContacts.filter((contact) => normalizeEmail(contact.properties?.email)).length,
  eligible: ledger.filter((record) => record.eligibility_status === "eligible").length,
  consentReview: ledger.filter((record) => record.eligibility_status === "consent_review").length,
  suppressed: ledger.filter((record) => record.eligibility_status === "suppressed").length,
  legacyReactivationHold: ledger.filter((record) => record.eligibility_status === "legacy_reactivation_hold").length,
  sourceSummary,
  attestation: attestation ? { scope: attestation.scope, attestedAt: attestation.attestedAt, attestedBy: attestation.attestedBy } : null,
  ledgerSha256: sha256(ledger)
};

await writeFile(path.join(outputDir, "canonical-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(outputDir, "ledger-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(outputDir, "consent-evidence.json"), `${JSON.stringify(ledger.map(({ email, consent, source_records }) => ({ email, ...consent, source_records })), null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(outputDir, "suppression-master.json"), `${JSON.stringify(ledger.filter((record) => record.suppression_reason).map(({ email, suppression_reason, suppressions, source_records }) => ({ email, suppression_reason, suppressions, source_records })), null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, ...report }, null, 2));
