# Cloudflare deployment manifest

This project is staged but not deployed.

## Approved credentials for the future deployment

- Account-owned master token: Worker, D1, cron, and Worker-secret operations.
- User DNS token stored as `CLOUDFLARE_API_KEY`: DNS reads and approved DNS changes only.
- Do not use the brand Worker token.

## Planned resources

- Worker: `email-marketing-control-plane`
- D1 database: `email-marketing-control-plane`
- Cron: nightly reconciliation at 04:17 UTC
- Public routes: `/health`, `/webhooks/resend`
- Protected route: `/admin/status`
- Proposed Resend domain: `email.hairsolutions.co`

## Required approval batch

Before deployment, present Vincent with the exact D1 creation command, Worker bindings, secret names, deployment URL, and DNS records supplied by Resend. Do not deploy or write DNS before approval.
