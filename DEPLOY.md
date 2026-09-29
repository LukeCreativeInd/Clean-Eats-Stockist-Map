# Vercel Deploy

Update the existing `clean-eats-stockist-map` Vercel project with this package before installing the Shopify section.

Existing environment variables remain in use; no new secrets are required.

After deployment, verify:

- `/api/stockists.json` returns active mapped stockists and no email, phone, tags, IDs or timestamps.
- `/api/geocode?postcode=3000` returns numeric `lat` and `lng` values.
- the existing Shopify customer webhook continues to update Supabase.

Run `pnpm typecheck` before deployment if dependencies are installed locally.
