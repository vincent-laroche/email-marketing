import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";

const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");
if (apply === dryRun) throw new Error("Use exactly one of --dry-run or --apply.");
const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const source = JSON.parse(await readFile(path.join(root, "hubspot-snapshot", "raw", "marketing-email-details.json"), "utf8"));
const excludedByName = /(?:do not reuse|test for cursor)/i;
const reserved = new Set(["FIRST_NAME", "LAST_NAME", "EMAIL", "RESEND_UNSUBSCRIBE_URL"]);
const variableName = (raw) => raw.replace(/^contact\.firstname$/i, "FIRST_NAME").replace(/^contact\.lastname$/i, "LAST_NAME")
  .replace(/^contact\.email$/i, "EMAIL").replace(/^unsubscribe_link$/i, "RESEND_UNSUBSCRIBE_URL")
  .replace(/^subscription_preferences_link$/i, "RESEND_UNSUBSCRIBE_URL")
  .replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
function extractHtml(email) {
  const widgets = email.content?.widgets ?? {};
  const chunks = Object.values(widgets).flatMap((widget) => [widget?.body?.html, widget?.body?.rich_text, widget?.body?.content])
    .filter((value) => typeof value === "string" && value.trim());
  return chunks.join("\n<hr>\n").trim();
}
function convert(html) {
  const variables = new Set();
  const converted = html.replace(/{{{?\s*([^} ]+)\s*}?}}/g, (_match, raw) => {
    const key = variableName(raw);
    if (!reserved.has(key)) variables.add(key);
    return `{{{${key}}}}`;
  });
  const text = converted.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { html: converted, text, variables: [...variables].sort().map((key) => ({ key, type: "string", fallbackValue: "Not available" })) };
}
const candidates = Object.values(source).flatMap((email) => {
  const html = extractHtml(email);
  if (excludedByName.test(email.name ?? "")) return [];
  if (!html) return [];
  const converted = convert(html);
  const convertedSubject = convert(String(email.subject ?? "").trim() || "[Subject missing in HubSpot source]");
  const variables = new Map([...converted.variables, ...convertedSubject.variables].map((variable) => [variable.key, variable]));
  return [{
    hubspotEmailId: String(email.id),
    alias: `hubspot-${email.id}`,
    name: `${String(email.name ?? "Email").slice(0, 35)} [HS ${email.id}]`.slice(0, 50),
    subject: convertedSubject.html,
    ...converted,
    variables: [...variables.values()],
    sourceType: email.type,
    sourceState: email.state
  }];
});
const skipped = Object.values(source).map((email) => ({ id: String(email.id), name: email.name ?? "", reason: excludedByName.test(email.name ?? "") ? "explicit_test_or_do_not_reuse" : extractHtml(email) ? null : "no_extractable_html_in_snapshot" })).filter((row) => row.reason);
if (dryRun) {
  console.log(JSON.stringify({ action: "dry-run", candidates: candidates.length, skipped, sample: candidates.slice(0, 3).map(({ html, text, ...item }) => item) }, null, 2));
  process.exit(0);
}
const env = await loadNamedEnv(["RESEND_API_KEY"]);
const resend = new Resend(requireEnv(env, "RESEND_API_KEY"));
const existing = [];
let after;
do {
  const result = await resend.templates.list({ limit: 100, after });
  if (result.error) throw new Error(result.error.message);
  existing.push(...(result.data?.data ?? []));
  after = result.data?.has_more ? existing.at(-1)?.id : undefined;
} while (after);
const existingAliases = new Map(existing.filter((template) => template.alias).map((template) => [template.alias, template.id]));
const created = [];
const retained = [];
for (const candidate of candidates) {
  const existingId = existingAliases.get(candidate.alias);
  if (existingId) { retained.push({ hubspotEmailId: candidate.hubspotEmailId, alias: candidate.alias, resendTemplateId: existingId }); continue; }
  const result = await resend.templates.create({ name: candidate.name, alias: candidate.alias, subject: candidate.subject, html: candidate.html, text: candidate.text, variables: candidate.variables });
  if (result.error) throw new Error(`Template ${candidate.hubspotEmailId} failed: ${result.error.message}`);
  created.push({ hubspotEmailId: candidate.hubspotEmailId, alias: candidate.alias, resendTemplateId: result.data.id, name: candidate.name, sourceType: candidate.sourceType, sourceState: candidate.sourceState });
}
const output = path.join(root, "migration");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "resend-template-drafts.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), action: "created_drafts_only", created, retained, skipped, published: false }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ action: "applied", created: created.length, retained: retained.length, skipped: skipped.length, output }, null, 2));
