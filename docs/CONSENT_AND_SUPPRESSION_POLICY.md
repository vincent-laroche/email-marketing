# Consent and suppression policy

Only `documented_explicit` and `owner_attested_explicit` contacts can enter an import package. `not_recorded` and `unknown` remain out of marketing sends.

Suppression precedence is complaint, unsubscribe, hard bounce, invalid/disposable, manual do-not-contact, then verification hold. Positive engagement never overrides a suppression.

Historical complaints and bounces remain in the private ledger. They are not uploaded as Resend custom properties, but they are excluded from every Resend import.
