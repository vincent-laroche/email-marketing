# Send-approval runbook

1. Generate a fresh immutable import or campaign manifest from the canonical ledger.
2. Confirm the manifest count and hash; any audience or content alteration invalidates prior approval.
3. Confirm `mail.hairsolutions.co` remains verified and that the Resend webhook is enabled.
4. Run `campaign:preflight` against the final content and capture its content hash.
5. Send only to separately approved internal seeds. Verify rendered HTML/text, links, reply-to, topic preferences, and webhook processing.
6. Obtain an explicit approval for the named manifest and exact seed or ramp cohort.
7. Use the initial ramp only: 100, then 250, then 500, then the remainder. Stop for any complaint, 2% hard-bounce rate, authentication failure, broken unsubscribe, or reconciliation failure.

No command may infer approval from an earlier manifest or different content.
