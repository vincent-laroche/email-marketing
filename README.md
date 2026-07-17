# Resend takeover control plane

This package is the local implementation of the Hair Solutions Co. Resend migration. HubSpot snapshots and PII-bearing outputs live in `/Users/vMac/07_warehouse/email_marketing/resend_takeover/` and are never committed.

## Safe commands

- `npm run access:preflight`
- `npm run snapshot:hubspot`
- `npm run build:ledger`
- `npm run validate:ledger`
- `npm run rank:free`
- `npm test`

The Worker and D1 configuration is deliberately un-deployed. Creating D1, deploying the Worker, writing Worker secrets, changing DNS, importing Resend contacts, and sending email each require explicit approval.

## Current gates

- Resend API access is not configured until `RESEND_API_KEY` is explicitly approved and added to the master environment.
- R2 is optional because the Cloudflare account has not enabled R2.
- Shopify is a future-only source and is not part of historical migration or initial audience selection.
