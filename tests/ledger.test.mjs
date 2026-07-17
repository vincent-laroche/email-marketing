import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, strongestSuppression, latestTimestamp } from "../src/ledger.mjs";

test("normalizes valid addresses without alias rewriting", () => {
  assert.equal(normalizeEmail("  First.Last+vip@Example.COM  "), "first.last+vip@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("suppression precedence never allows positive engagement to override complaint", () => {
  assert.equal(strongestSuppression(["verification_hold", "complaint"]), "complaint");
  assert.equal(strongestSuppression(["hard_bounce", "unsubscribe"]), "unsubscribe");
});

test("last event uses the most recent valid timestamp", () => {
  assert.equal(latestTimestamp("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), "2026-01-01T00:00:00.000Z");
});
