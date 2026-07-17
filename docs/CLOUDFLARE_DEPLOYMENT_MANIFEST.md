# Cloudflare deployment manifest

This project is deployed in Cloudflare.

## Approved credentials for the future deployment

- Account-owned master token: Worker, D1, cron, and Worker-secret operations.
- User DNS token stored as `CLOUDFLARE_API_KEY`: DNS reads and approved DNS changes only.
- Do not use the brand Worker token.

## Live resources

- Worker: `email-marketing-control-plane`
- D1 database: `email-marketing-control-plane`
- Cron: nightly reconciliation at 04:17 UTC
- Public routes: `/health`, `/webhooks/resend`
- Protected route: `/admin/status`
- Resend domain: `mail.hairsolutions.co` (verified)
- Resend webhook: `093a8133-907d-42ff-a8de-3669682c3277` to the Worker endpoint; its signing secret exists only as the Cloudflare Worker secret `RESEND_WEBHOOK_SECRET`.

## Required approval batch

Before any contact import, subscription update, test send, or broadcast, present Vincent with the exact audience manifest, exclusions, count, source snapshot, and content. Do not import or send without approval.
