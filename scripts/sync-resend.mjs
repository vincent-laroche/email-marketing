import { Resend } from "resend";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";
import { readManifest, readManifestCsv } from "../src/manifests.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run");
const manifestIndex = process.argv.indexOf("--manifest");
const manifestId = manifestIndex >= 0 ? process.argv[manifestIndex + 1] : null;
if ((!apply && !dryRun) || (apply && dryRun) || !manifestId) throw new Error("Use exactly one of --dry-run or --apply with --manifest <id>.");

const manifest = await readManifest(manifestId);
if (manifest.approvalStatus !== "pending") throw new Error(`Manifest ${manifest.id} is not pending approval.`);
const csv = await readManifestCsv(manifest);
const rows = csv.trim().split("\n");
if (rows.length - 1 !== manifest.audienceCount) throw new Error("CSV count differs from immutable manifest.");
const cap = manifest.mode === "free" ? 1000 : 5000;
if (manifest.audienceCount > cap) throw new Error(`Manifest exceeds ${manifest.mode} contact cap.`);

const properties = [
  "customer_status", "customer_tier", "lifecycle_stage", "engagement_tier",
  "last_meaningful_activity", "source_portals", "consent_evidence_quality", "migration_cohort"
];
const segmentNames = manifest.mode === "free"
  ? ["Free Continuity — Top 1000", "All Marketing Eligible"]
  : ["All Marketing Eligible"];
const topicId = "9d63a3fe-13bc-4bae-acb0-94beb751f36d";

if (dryRun) {
  console.log(JSON.stringify({ action: "dry-run", manifest: manifest.id, mode: manifest.mode, audienceCount: manifest.audienceCount, properties, segmentNames, topicId, csvSha256: manifest.csvSha256 }, null, 2));
  process.exit(0);
}

const env = await loadNamedEnv(["RESEND_API_KEY"]);
const resend = new Resend(requireEnv(env, "RESEND_API_KEY"));
const existingProperties = await resend.contactProperties.list();
if (existingProperties.error) throw new Error(existingProperties.error.message);
for (const key of properties) {
  if ((existingProperties.data?.data ?? []).some((property) => property.key === key)) continue;
  const result = await resend.contactProperties.create({ key, type: "string" });
  if (result.error) throw new Error(`Could not create property ${key}: ${result.error.message}`);
}
const existingSegments = await resend.segments.list();
if (existingSegments.error) throw new Error(existingSegments.error.message);
const segmentIds = [];
for (const name of segmentNames) {
  const found = (existingSegments.data?.data ?? []).find((segment) => segment.name === name);
  if (found) { segmentIds.push(found.id); continue; }
  const result = await resend.segments.create({ name });
  if (result.error) throw new Error(`Could not create segment ${name}: ${result.error.message}`);
  segmentIds.push(result.data.id);
}
const importResult = await resend.contacts.imports.create({
  file: new Blob([csv], { type: "text/csv" }),
  columnMap: {
    email: "email", firstName: "first_name", lastName: "last_name",
    properties: Object.fromEntries(properties.map((key) => [key, { column: key, type: "string" }]))
  },
  onConflict: "upsert",
  segments: segmentIds.map((id) => ({ id })),
  topics: [{ id: topicId, subscription: "opt_in" }]
});
if (importResult.error) throw new Error(importResult.error.message);
console.log(JSON.stringify({ action: "applied", manifest: manifest.id, importId: importResult.data.id, audienceCount: manifest.audienceCount, segmentIds }, null, 2));
