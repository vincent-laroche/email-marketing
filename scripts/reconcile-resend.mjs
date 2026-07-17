import { Resend } from "resend";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";
import { readManifest } from "../src/manifests.mjs";

const manifestId = process.argv[process.argv.indexOf("--manifest") + 1];
if (!manifestId) throw new Error("Use --manifest <id>.");
const manifest = await readManifest(manifestId);
const env = await loadNamedEnv(["RESEND_API_KEY"]);
const resend = new Resend(requireEnv(env, "RESEND_API_KEY"));
const imports = await resend.contacts.imports.list();
if (imports.error) throw new Error(imports.error.message);
console.log(JSON.stringify({ manifest: manifest.id, expectedCount: manifest.audienceCount, imports: imports.data?.data ?? [] }, null, 2));
