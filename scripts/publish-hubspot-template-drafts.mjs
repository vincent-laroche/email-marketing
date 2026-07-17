import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";

const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");
if (apply === dryRun) throw new Error("Use exactly one of --dry-run or --apply.");
const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data/current";
const migration = JSON.parse(await readFile(path.join(root, "migration", "resend-template-drafts.json"), "utf8"));
const expected = [...migration.created, ...migration.retained];
if (!expected.length) throw new Error("No migrated Resend templates are recorded.");
const env = await loadNamedEnv(["RESEND_API_KEY"]);
const resend = new Resend(requireEnv(env, "RESEND_API_KEY"));
async function mapLimit(items, limit, callback) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await callback(items[index]);
    }
  }));
  return results;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = await mapLimit(expected, 1, async (item) => {
  await wait(125);
  const result = await resend.templates.get(item.resendTemplateId);
  if (result.error) throw new Error(`Could not read template ${item.resendTemplateId}: ${result.error.message}`);
  return { ...item, status: result.data.status };
});
const drafts = checks.filter((item) => item.status === "draft");
if (dryRun) {
  console.log(JSON.stringify({ action: "dry-run", total: checks.length, drafts: drafts.length, alreadyPublished: checks.length - drafts.length }, null, 2));
  process.exit(0);
}
const published = await mapLimit(drafts, 5, async (item) => {
  const result = await resend.templates.publish(item.resendTemplateId);
  if (result.error) throw new Error(`Could not publish template ${item.resendTemplateId}: ${result.error.message}`);
  return { hubspotEmailId: item.hubspotEmailId, resendTemplateId: item.resendTemplateId, alias: item.alias };
});
const verification = await mapLimit(checks, 1, async (item) => {
  await wait(125);
  const result = await resend.templates.get(item.resendTemplateId);
  if (result.error) throw new Error(`Could not verify template ${item.resendTemplateId}: ${result.error.message}`);
  return { id: item.resendTemplateId, status: result.data.status };
});
const failed = verification.filter((item) => item.status !== "published");
if (failed.length) throw new Error(`Post-publish verification failed for ${failed.length} templates.`);
const auditDir = path.join(root, "..", "audits");
await mkdir(auditDir, { recursive: true });
await writeFile(path.join(auditDir, `resend-template-publish-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), `${JSON.stringify({
  publishedAt: new Date().toISOString(), total: checks.length, newlyPublished: published.length, alreadyPublished: checks.length - drafts.length, published
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ action: "applied", total: checks.length, newlyPublished: published.length, alreadyPublished: checks.length - drafts.length }, null, 2));
