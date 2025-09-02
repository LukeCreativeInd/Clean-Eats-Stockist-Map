import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../lib/supabase.js';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocodeNominatim(q: string) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=au`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'CleanEats-StockistMap/1.0 (contact@cleaneatsaustralia.com.au)'
    }
  });
  if (!resp.ok) return null;
  const data: any[] = await resp.json();
  const first = data?.[0];
  if (!first) return null;
  return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Fetch up to 15 pending rows
  const { data: rows, error } = await supabaseAdmin
    .from('stockists')
    .select('id,address1,address2,city,province,postcode,country')
    .is('latitude', null)
    .eq('is_active', true)
    .limit(15);

  if (error) return res.status(500).send(error.message);

  for (const r of rows ?? []) {
    const full = [r.address1, r.address2, r.city, r.province, r.postcode, r.country || 'Australia']
      .filter(Boolean)
      .join(', ');

    let coords = await geocodeNominatim(full);
    if (!coords && r.postcode) {
      coords = await geocodeNominatim(`Australia ${r.postcode}`);
    }

    if (coords) {
      await supabaseAdmin
        .from('stockists')
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq('id', r.id);
    }

    // Be polite: ~1 req/sec
    await sleep(1100);
  }

  return res.status(200).send('done');
}
