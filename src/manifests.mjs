import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const warehouseRoot = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data";
export const currentRoot = path.join(warehouseRoot, "current");

export async function latestLedgerDir() {
  const ledgerDir = path.join(currentRoot, "ledger");
  try { await readFile(path.join(ledgerDir, "canonical-ledger.json")); } catch { throw new Error("No current canonical ledger exists. Run npm run build:ledger first."); }
  return ledgerDir;
}

export async function readManifest(id) {
  const ledgerDir = await latestLedgerDir();
  for (const mode of ["free", "pro"]) {
    const directory = path.join(currentRoot, `${mode}-import`);
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
      if (manifest.id === id) return { ...manifest, directory, mode };
    } catch {}
  }
  throw new Error(`No prepared Resend manifest matches ${id}`);
}

export async function readManifestCsv(manifest) {
  return readFile(path.join(manifest.directory, "import.csv"), "utf8");
}
