import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";

const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");
if (apply === dryRun) throw new Error("Use exactly one of --dry-run or --apply.");
const offset = Number(process.argv.find((argument) => argument.startsWith("--offset="))?.split("=")[1] ?? 0);
const limit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] ?? 104);
if (!Number.isInteger(offset) || !Number.isInteger(limit) || offset < 0 || limit < 1) throw new Error("--offset must be >= 0 and --limit must be >= 1.");
const projectRoot = "/Users/vMac/01_projects/Email Marketing";
const root = path.join(projectRoot, "resend-takeover", "data", "current");
const exportDir = path.join(projectRoot, "hubspot-html-export");
const details = JSON.parse(await readFile(path.join(root, "hubspot-snapshot", "raw", "marketing-email-details.json"), "utf8"));
const explicitTest = new Set(["211682259546"]);
const reserved = new Set(["FIRST_NAME", "LAST_NAME", "EMAIL", "RESEND_UNSUBSCRIBE_URL"]);
const normalizeKey = (raw) => raw.replace(/^contact\.firstname$/i, "FIRST_NAME").replace(/^contact\.lastname$/i, "LAST_NAME")
  .replace(/^contact\.email$/i, "EMAIL").replace(/^unsubscribe_link$/i, "RESEND_UNSUBSCRIBE_URL")
  .replace(/^subscription_preferences_link$/i, "RESEND_UNSUBSCRIBE_URL").replace(/[^a-zA-Z0-9_]+/g, "_")
  .replace(/^_+|_+$/g, "").toUpperCase();
function convert(sourceHtml) {
  const custom = new Set();
  const html = sourceHtml.replace(/{{\s*([A-Za-z0-9_.]+)(?:\s*\|[^}]*)?\s*}}/g, (_match, raw) => {
    const key = normalizeKey(raw);
    if (!reserved.has(key)) custom.add(key);
    return `{{{${key}}}}`;
  });
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { html, text, variables: [...custom].sort().map((key) => ({ key, type: "string", fallbackValue: "Not available" })) };
}
const files = (await readdir(exportDir)).filter((name) => name.endsWith(".html"));
const candidates = [];
for (const filename of files) {
  const id = filename.match(/^(\d+)_/)?.[1];
  if (!id || explicitTest.has(id) || !details[id]) continue;
  const sourceHtml = await readFile(path.join(exportDir, filename), "utf8");
  const converted = convert(sourceHtml);
  candidates.push({
    hubspotEmailId: id,
    alias: `hubspot-${id}`,
    name: `${String(details[id].name ?? "Email").slice(0, 35)} [HS ${id}]`.slice(0, 50),
    subject: convert(String(details[id].subject ?? "").trim() || "[Subject missing in HubSpot source]").html,
    replyTo: "info@hairsolutions.co",
    sourceFile: filename,
    ...converted
  });
}
const sourceIds = Object.keys(details);
const exportedIds = new Set(candidates.map((item) => item.hubspotEmailId));
const held = sourceIds.filter((id) => !exportedIds.has(id)).map((id) => ({ hubspotEmailId: id, name: details[id].name ?? "", reason: explicitTest.has(id) ? "explicit_test_do_not_reuse" : "no_full_html_export_found" }));
const batch = candidates.slice(offset, offset + limit);
if (dryRun) {
  console.log(JSON.stringify({ action: "dry-run", fullHtmlCandidates: candidates.length, offset, limit, batchCount: batch.length, held, sample: batch.slice(0, 3).map(({ html, text, ...item }) => item) }, null, 2));
  process.exit(0);
}
const env = await loadNamedEnv(["RESEND_API_KEY"]);
const resend = new Resend(requireEnv(env, "RESEND_API_KEY"));
const listed = [];
let after;
do {
  const result = await resend.templates.list({ limit: 100, after });
  if (result.error) throw new Error(result.error.message);
  listed.push(...(result.data?.data ?? []));
  after = result.data?.has_more ? listed.at(-1)?.id : undefined;
} while (after);
const existing = new Map(listed.filter((item) => item.alias).map((item) => [item.alias, item.id]));
const changes = [];
for (const item of batch) {
  let templateId = existing.get(item.alias);
  if (templateId) {
    const result = await resend.templates.update(templateId, { name: item.name, subject: item.subject, html: item.html, text: item.text, replyTo: item.replyTo, variables: item.variables });
    if (result.error) throw new Error(`Could not update ${item.alias}: ${result.error.message}`);
  } else {
    const result = await resend.templates.create({ name: item.name, alias: item.alias, subject: item.subject, html: item.html, text: item.text, replyTo: item.replyTo, variables: item.variables });
    if (result.error) throw new Error(`Could not create ${item.alias}: ${result.error.message}`);
    templateId = result.data.id;
  }
  const publish = await resend.templates.publish(templateId);
  if (publish.error) throw new Error(`Could not publish ${item.alias}: ${publish.error.message}`);
  changes.push({ hubspotEmailId: item.hubspotEmailId, resendTemplateId: templateId, alias: item.alias, sourceFile: item.sourceFile });
}
const output = path.join(root, "migration");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, `resend-full-html-template-migration-${offset}.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), replyTo: "info@hairsolutions.co", from: null, offset, limit, totalCandidates: candidates.length, migratedAndPublished: changes, held }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ action: "applied", offset, limit, batchCount: batch.length, migratedAndPublished: changes.length, held: held.length, output }, null, 2));
