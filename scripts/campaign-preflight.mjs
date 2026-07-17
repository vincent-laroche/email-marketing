import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readManifest } from "../src/manifests.mjs";

const manifestId = process.argv[process.argv.indexOf("--manifest") + 1];
const contentPath = process.argv[process.argv.indexOf("--content") + 1];
if (!manifestId || !contentPath) throw new Error("Use --manifest <id> --content <html-or-json-file>.");
const manifest = await readManifest(manifestId);
const content = await readFile(contentPath, "utf8");
const contentHash = createHash("sha256").update(content).digest("hex");
const required = ["unsubscribe", "mailto:"];
const missing = required.filter((token) => !content.toLowerCase().includes(token));
if (missing.length) throw new Error(`Campaign content is missing required controls: ${missing.join(", ")}`);
console.log(JSON.stringify({ manifest: manifest.id, audienceCount: manifest.audienceCount, audienceHash: manifest.audienceHash, contentHash, pass: true }, null, 2));
