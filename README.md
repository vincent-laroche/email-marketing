# Resend takeover control plane

This package is the local implementation of the Hair Solutions Co. Resend migration. HubSpot snapshots and PII-bearing outputs live in `/Users/vMac/07_warehouse/email_marketing/resend_takeover/` and are never committed.

## Safe commands

- `npm run access:preflight`
- `npm run snapshot:hubspot`
- `npm run build:ledger`
- `npm run validate:ledger`
- `npm run rank:free`
- `npm test`

The Worker and D1 configuration is deployed. Contact imports, subscription updates, test sends, and broadcasts still require their own explicit approval.

## Current gates

- `mail.hairsolutions.co` is verified in Resend; webhook delivery is configured for delivery, bounce, complaint, provider-suppression, and contact-unsubscribe changes.
- No contacts have been imported and no email has been sent.
- R2 is optional because the Cloudflare account has not enabled R2.
- Shopify is a future-only source and is not part of historical migration or initial audience selection.
