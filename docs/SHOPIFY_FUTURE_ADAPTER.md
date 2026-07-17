# Shopify future adapter

Shopify is excluded from historical migration, consent reconstruction, and initial audience ranking. HubSpot is the historical system of record.

When Shopify is restored, this adapter may ingest only new customer and order events, repeat purchase status, last order date, customer value, and Shopify-observed marketing preferences. It may not release a suppression or manufacture consent.

The current Shopify Admin token is invalid and the available app token returns a store-unavailable response. Do not activate this adapter until a fresh token, customer-data access, and read scopes are independently verified.
