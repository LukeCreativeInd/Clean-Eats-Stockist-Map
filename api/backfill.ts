import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../lib/supabase.js';
import { geocodeNominatim } from '../lib/geocode.js';

const SHOP = process.env.SHOPIFY_SHOP!;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const BACKFILL_TOKEN = process.env.BACKFILL_TOKEN!;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(since_id?: number) {
  const url = new URL(`https://${SHOP}/admin/api/2024-10/customers.json`);
  url.searchParams.set('limit', '250');
  if (since_id) url.searchParams.set('since_id', String(since_id));

  const resp = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) throw new Error(`Shopify ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).customers ?? [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query.token !== BACKFILL_TOKEN) return res.status(401).send('unauthorized');

  let since_id: number | undefined = undefined;
  let count = 0;

  while (true) {
    const customers = await fetchPage(since_id);
    if (customers.length === 0) break;

    for (const c of customers) {
      const tags = (c.tags || '').toString();
      const nomap = tags.toLowerCase().includes('nomap');
      const a = c.default_address || {};

      const upsert: any = {
        id: c.id,
        name: c.company || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unnamed',
        email: c.email,
        phone: c.phone,
        address1: a.address1 || null,
        address2: a.address2 || null,
        city: a.city || null,
        province: a.province || null,
        postcode: a.zip || null,
        country: a.country || 'Australia',
        tags,
        is_active: !nomap
      };

      if (!nomap) {
        const full = [a.address1, a.address2, a.city, a.province, a.zip, a.country || 'Australia']
          .filter(Boolean)
          .join(', ');
        let coords = full ? await geocodeNominatim(full) : null;
        if (!coords && a.zip) coords = await geocodeNominatim(`Australia ${a.zip}`);
        if (coords) {
          upsert.latitude = coords.lat;
          upsert.longitude = coords.lng;
        }
      }

      await supabaseAdmin.from('stockists').upsert(upsert);
      count++;
      await delay(200); // polite for Nominatim
    }

    since_id = customers[customers.length - 1].id;
  }

  res.json({ imported: count });
}
