# Backup and recovery

- HubSpot source snapshots and all PII-bearing prepared manifests live only in `/Users/vMac/07_warehouse/email_marketing/resend_takeover/` with restrictive local permissions.
- Run `npm run backup:local` after each immutable snapshot or before any approved external mutation.
- D1 is the operational ledger, not the sole recovery source; rebuild it from the immutable canonical ledger using `sync:d1` after validating the source checksum.
- Never recover contacts from Resend alone: Resend is delivery state, while the canonical ledger is the evidence and suppression authority.
- For a webhook incident, retain the D1 `webhook_events` rows, identify failed processing, then replay only signature-verified source events through the Worker.
