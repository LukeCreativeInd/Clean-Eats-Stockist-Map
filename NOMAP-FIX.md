# `nomap` Exclusion Fix

This version restores and strengthens the Shopify customer `nomap` rule.

- `/api/stockists.json` reads tags internally, excludes exact `nomap` tags, and removes all tags before sending the public response.
- The Shopify customer webhook falls back to the signed webhook payload when the secondary Admin API tag lookup fails.
- The backfill uses exact, case-insensitive tag matching.

Deploy this Vercel package to the existing project. No Shopify files need to change for this fix.

The public endpoint is cached for up to five minutes. After deployment, allow that cache to refresh and confirm the central-Australia stockists are gone.

If any `nomap` customers remain, run the existing protected backfill once. This refreshes stored Shopify tags and `is_active` values for historical records.
