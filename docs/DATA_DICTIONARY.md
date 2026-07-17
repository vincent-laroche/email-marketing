# Data dictionary

| Field | System of record | Purpose | Resend upload |
| --- | --- | --- | --- |
| `email` | Canonical ledger | normalized join key | Yes |
| names and customer/lifecycle/engagement fields | Canonical ledger | audience segmentation | Yes, ordinary contact properties only |
| consent evidence | Canonical ledger + D1 | provenance and owner attestation | No |
| suppression reason | Canonical ledger + D1 | permanent exclusion control | No |
| historical engagement | Canonical ledger + D1 | ranking and reporting | No raw history |
| source portals | Canonical ledger | provenance | Yes |
| Resend delivery events | Resend webhook + D1 | future suppression/reconciliation | Not applicable |
