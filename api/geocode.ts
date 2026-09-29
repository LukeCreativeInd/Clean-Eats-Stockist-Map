import type { VercelRequest, VercelResponse } from '@vercel/node';
import { geocodeNominatim } from '../lib/geocode.js';

function setPublicHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPublicHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const raw = Array.isArray(req.query.postcode) ? req.query.postcode[0] : req.query.postcode;
  const postcode = String(raw || '').trim();
  if (!/^\d{4}$/.test(postcode)) {
    res.status(400).json({ error: 'Enter a four-digit Australian postcode.' });
    return;
  }

  try {
    const coords = await geocodeNominatim(`Australia ${postcode}`);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    if (!coords) {
      res.status(404).json({ error: 'Postcode not found.' });
      return;
    }

    res.status(200).json(coords);
  } catch (error) {
    console.error('[geocode] Postcode lookup failed', error);
    res.status(502).json({ error: 'Postcode lookup is temporarily unavailable.' });
  }
}
