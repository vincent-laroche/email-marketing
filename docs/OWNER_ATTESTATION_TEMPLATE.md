# Owner attestation template

Use this only if Vincent is truthfully attesting to current marketing permission. It is not a reconstruction of historical consent.

Create `data/owner-attestation.json` only after Vincent explicitly approves its scope.

```json
{
  "scope": "all_current_active_hubspot_contacts",
  "emails": [],
  "attestedBy": "Vincent Laroche",
  "attestedAt": "CURRENT_ISO_TIMESTAMP",
  "statement": "I attest that the contacts in the stated scope explicitly opted in to receive Hair Solutions Co. marketing communications. This is a present attestation; it does not assert an unavailable historical form, date, IP address, or wording."
}
```

Use `scope: "selected_emails"` with an explicit `emails` array if the attestation applies only to a reviewed subset. Do not create this file or populate its date without Vincent’s explicit approval.
