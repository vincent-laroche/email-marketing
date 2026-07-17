import { readdir, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
const root = "/Users/vMac/01_projects/Email Marketing/resend-takeover/data";
const backupRoot = path.join(root, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupRoot, stamp);
await mkdir(destination, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "backups") continue;
  await cp(path.join(root, entry.name), path.join(destination, entry.name), { recursive: true, errorOnExist: true });
}
await writeFile(path.join(destination, "README.txt"), `Local recovery backup created ${new Date().toISOString()}\n`, { mode: 0o600 });
console.log(destination);
