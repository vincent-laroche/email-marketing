# Consent and suppression policy

Only `documented_explicit` and `owner_attested_explicit` contacts can enter an import package. `not_recorded` and `unknown` remain out of marketing sends.

Suppression precedence is complaint, unsubscribe, hard bounce, invalid/disposable, manual do-not-contact, plan-customer hold, then verification hold. Positive engagement never overrides a suppression.

Historical complaints and bounces remain in the private ledger. They are not uploaded as Resend custom properties, but they are excluded from every Resend import.

Contacts with HubSpot `hs_has_active_subscription = 1` or a `customer_purchase_profile` containing `plan_customer` are placed on a `plan_customer_hold` and excluded from marketing audiences. This is a Hair Solutions Co. operating exclusion, retained locally; it is not uploaded to Resend.
