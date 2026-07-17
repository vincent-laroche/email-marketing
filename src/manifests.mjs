import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const warehouseRoot = "/Users/vMac/07_warehouse/email_marketing/resend_takeover";

export async function latestLedgerDir() {
  const dirs = (await readdir(warehouseRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("ledger-"))
    .map((entry) => entry.name)
    .sort();
  if (!dirs.length) throw new Error("No canonical ledger exists. Run npm run build:ledger first.");
  return path.join(warehouseRoot, dirs.at(-1));
}

export async function readManifest(id) {
  const ledgerDir = await latestLedgerDir();
  for (const mode of ["free", "pro"]) {
    const directory = path.join(ledgerDir, `resend-${mode}`);
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
