import { readFile } from "node:fs/promises";

export async function loadNamedEnv(names, envPath = "/Users/vMac/.env") {
  const wanted = new Set(names);
  const parsed = {};
  const source = await readFile(envPath, "utf8");

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !wanted.has(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }

  return parsed;
}

export function requireEnv(env, name) {
  if (!env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return env[name];
}
