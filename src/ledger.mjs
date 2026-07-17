import { createHash } from "node:crypto";

export function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export const suppressionPriority = [
  "complaint",
  "unsubscribe",
  "hard_bounce",
  "invalid_disposable",
  "manual_do_not_contact",
  "verification_hold"
];

export function strongestSuppression(reasons) {
  return suppressionPriority.find((reason) => reasons.includes(reason)) ?? null;
}

export function parseCount(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function latestTimestamp(...values) {
  const usable = values.filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.valueOf()));
  if (!usable.length) return null;
  return new Date(Math.max(...usable.map((date) => date.valueOf()))).toISOString();
}

export function valueForHeader(row, patterns) {
  const headers = Object.keys(row).filter((key) => patterns.some((pattern) => pattern.test(key.toLowerCase())));
  const populated = headers.find((header) => String(row[header] ?? "").trim() !== "");
  return populated ? row[populated] : headers[0] ? row[headers[0]] : undefined;
}
