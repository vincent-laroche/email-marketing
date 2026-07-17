PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  lifecycle_stage TEXT,
  customer_status TEXT,
  customer_tier TEXT,
  engagement_tier TEXT,
  last_meaningful_activity_at TEXT,
  consent_status TEXT NOT NULL,
  eligibility_status TEXT NOT NULL,
  suppression_reason TEXT,
  source_portals TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_sources (
  email TEXT NOT NULL REFERENCES contacts(email),
  source_name TEXT NOT NULL,
  portal_id TEXT,
  source_record_id TEXT,
  source_checksum TEXT NOT NULL,
  first_observed_at TEXT,
  last_observed_at TEXT,
  PRIMARY KEY (email, source_name, source_record_id)
);

CREATE TABLE IF NOT EXISTS consent_evidence (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES contacts(email),
  marketing_topic TEXT,
  consent_status TEXT NOT NULL,
  consent_timestamp TEXT,
  timestamp_quality TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_record TEXT,
  form_or_page TEXT,
  consent_wording TEXT,
  confirmation_status TEXT,
  form_version TEXT,
  ip_evidence TEXT,
  user_agent_evidence TEXT,
  evidence_quality TEXT NOT NULL,
  inference_rule TEXT,
  owner_attested_by TEXT,
  owner_attested_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES contacts(email),
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_system TEXT NOT NULL,
  observed_at TEXT,
  permanent INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement_events (
  event_key TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES contacts(email),
  event_type TEXT NOT NULL,
  occurred_at TEXT,
  source_system TEXT NOT NULL,
  source_record TEXT,
  count_value INTEGER
);

CREATE TABLE IF NOT EXISTS segments (
  segment_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  resend_segment_id TEXT,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segment_memberships (
  segment_key TEXT NOT NULL REFERENCES segments(segment_key),
  email TEXT NOT NULL REFERENCES contacts(email),
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (segment_key, email, snapshot_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_key TEXT PRIMARY KEY,
  resend_broadcast_id TEXT,
  name TEXT NOT NULL,
  topic_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_manifests (
  manifest_id TEXT PRIMARY KEY,
  campaign_key TEXT REFERENCES campaigns(campaign_key),
  audience_hash TEXT NOT NULL,
  content_hash TEXT,
  source_snapshot_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  audience_count INTEGER NOT NULL,
  exclusions_json TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS send_runs (
  id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES campaign_manifests(manifest_id),
  resend_broadcast_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  signature_valid INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  processing_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  manifest_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
