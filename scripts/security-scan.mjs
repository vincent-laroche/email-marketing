import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const { stdout } = await exec("git", ["ls-files"]);
const files = stdout.split("\n").filter(Boolean);
const forbidden = files.filter((file) => /(^|\/)(\.env|\.dev\.vars|.*\.csv|.*\.sqlite|.*\.db)$/i.test(file));
if (forbidden.length) throw new Error(`Sensitive or generated file tracked by Git: ${forbidden.join(", ")}`);
console.log(JSON.stringify({ pass: true, trackedFileCount: files.length, checkedAt: new Date().toISOString() }, null, 2));
