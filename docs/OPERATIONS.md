# Operations runbook

## Routine process

1. Run `npm run access:preflight`.
2. Run `npm run snapshot:hubspot` while HubSpot access exists.
3. Run `npm run build:ledger` and `npm run validate:ledger`.
4. Do not create an import until consent status is eligible and the manifest is reviewed.
5. Run `npm run prepare:resend -- --mode=free` or `--mode=pro`.
6. Review the immutable manifest, exclusions, count, and source snapshot.
7. Obtain explicit approval before any Resend import or send.

## Stop conditions

- Any complaint during warm-up.
- Hard bounce at or above 2%.
- Failed authentication or broken unsubscribe.
- Audience hash differs from the approved manifest.
- Any unresolved webhook processing error.

## Approval boundaries

Cloudflare D1 creation, Worker deployment, Worker secrets, DNS changes, Resend imports, subscription updates, test sends, and broadcasts are production actions. Stage the exact change and obtain approval first.

## Sending-domain decision

The DNS audit on 2026-07-17 found that `mail.hairsolutions.co` is a live HubSpot domain with HubSpot SPF and DKIM records. Leave it untouched. The staged Resend domain is `email.hairsolutions.co`; create its exact DNS manifest only after Resend supplies the verification records.
