import { mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";
import { hubspotClient } from "../src/hubspot.mjs";

const portalId = "50966981";
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, "-");
const root = `/Users/vMac/07_warehouse/email_marketing/resend_takeover/hubspot-${portalId}-${stamp}`;
const rawDir = path.join(root, "raw");
const manifest = { portalId, startedAt, completedAt: null, sources: [], errors: [] };

await mkdir(rawDir, { recursive: true });
const env = await loadNamedEnv(["HUBSPOT_SERVICE_KEY"]);
const client = hubspotClient(requireEnv(env, "HUBSPOT_SERVICE_KEY"));

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function save(name, value, metadata = {}) {
  const target = path.join(rawDir, `${name}.json`);
  const temp = `${target}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(temp, serialized, { mode: 0o600 });
  await rename(temp, target);
  manifest.sources.push({
    name,
    path: target,
    retrievedAt: new Date().toISOString(),
    recordCount: Array.isArray(value) ? value.length : metadata.recordCount ?? null,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    ...metadata
  });
}

async function capture(name, task) {
  try {
    const result = await task();
    await save(name, result.payload, result.metadata);
    console.log(`captured ${name}`);
    return result.payload;
  } catch (error) {
    manifest.errors.push({
      name,
      at: new Date().toISOString(),
      message: error.message,
      status: error.status ?? null,
      payload: error.payload ?? null
    });
    console.error(`failed ${name}: ${error.message}`);
    return null;
  }
}

const properties = await capture("contact-property-definitions", async () => {
  const { json, url } = await client.request("/crm/v3/properties/contacts");
  return { payload: json.results ?? [], metadata: { endpoint: url, recordCount: json.results?.length ?? 0, paginationCount: 1 } };
});

const propertyNames = (properties ?? []).map((property) => property.name).filter(Boolean);
const contacts = await capture("contacts", async () => {
  const all = [];
  let after;
  let pageCount = 0;
  const chunks = [];
  for (let index = 0; index < propertyNames.length; index += 80) chunks.push(propertyNames.slice(index, index + 80));
  if (!chunks.length) chunks.push(["email", "firstname", "lastname"]);

  const byId = new Map();
  for (const propertiesChunk of chunks) {
    after = undefined;
    do {
      const { json } = await client.request("/crm/v3/objects/contacts", {
        query: { limit: 100, after, properties: propertiesChunk.join(","), archived: false }
      });
      for (const contact of json.results ?? []) {
        const current = byId.get(contact.id) ?? { ...contact, properties: {} };
        current.properties = { ...current.properties, ...(contact.properties ?? {}) };
        current.createdAt = contact.createdAt ?? current.createdAt;
        current.updatedAt = contact.updatedAt ?? current.updatedAt;
        byId.set(contact.id, current);
      }
      after = json.paging?.next?.after;
      pageCount += 1;
      if (pageCount > 2000) throw new Error("Contact pagination safety limit exceeded");
    } while (after);
  }
  all.push(...byId.values());
  return { payload: all, metadata: { endpoint: "/crm/v3/objects/contacts", recordCount: all.length, paginationCount: pageCount, propertyCount: propertyNames.length, propertyChunks: chunks.length } };
});

const lists = await capture("lists", async () => {
  const { results, pageCount } = await client.getAll("/crm/v3/lists", { limit: 250 });
  return { payload: results, metadata: { endpoint: "/crm/v3/lists", recordCount: results.length, paginationCount: pageCount } };
});

await capture("list-memberships", async () => {
  const memberships = {};
  let total = 0;
  for (const list of lists ?? []) {
    const listId = list.listId ?? list.id;
    if (!listId) continue;
    try {
      const { results, pageCount } = await client.getAll(`/crm/v3/lists/${listId}/memberships`, { limit: 250 });
      memberships[String(listId)] = { pageCount, members: results };
      total += results.length;
    } catch (error) {
      memberships[String(listId)] = { error: error.message, status: error.status ?? null, members: [] };
    }
  }
  return { payload: memberships, metadata: { endpoint: "/crm/v3/lists/{listId}/memberships", recordCount: total, listCount: Object.keys(memberships).length } };
});

await capture("subscription-definitions", async () => {
  const { json, url } = await client.request("/communication-preferences/v3/definitions");
  return { payload: json, metadata: { endpoint: url, recordCount: json?.results?.length ?? null, paginationCount: 1 } };
});

for (const [name, endpoint, key] of [
  ["marketing-emails", "/marketing/v3/emails", "results"],
  ["forms", "/marketing/v3/forms", "results"],
  ["campaigns", "/marketing/v3/campaigns", "results"],
  ["workflows", "/automation/v4/flows", "results"]
]) {
  await capture(name, async () => {
    const { results, pageCount } = await client.getAll(endpoint, { resultKey: key, limit: 100 });
    return { payload: results, metadata: { endpoint, recordCount: results.length, paginationCount: pageCount } };
  });
}

const emailCatalog = manifest.sources.find((source) => source.name === "marketing-emails");
if (emailCatalog) {
  const emails = JSON.parse(await (await import("node:fs/promises")).readFile(emailCatalog.path, "utf8"));
  await capture("marketing-email-details", async () => {
    const details = {};
    for (const email of emails) {
      const id = email.id;
      if (!id) continue;
      try {
        const { json } = await client.request(`/marketing/v3/emails/${id}`);
        details[String(id)] = json;
      } catch (error) {
        details[String(id)] = { error: error.message, status: error.status ?? null };
      }
    }
    return { payload: details, metadata: { endpoint: "/marketing/v3/emails/{id}", recordCount: Object.keys(details).length } };
  });
}

manifest.completedAt = new Date().toISOString();
manifest.contactEmailCount = (contacts ?? []).filter((contact) => contact.properties?.email).length;
manifest.manifestSha256 = digest({ ...manifest, manifestSha256: undefined });
await writeFile(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ root, sourceCount: manifest.sources.length, errorCount: manifest.errors.length, contactEmailCount: manifest.contactEmailCount }, null, 2));
if (manifest.errors.length) process.exitCode = 2;
