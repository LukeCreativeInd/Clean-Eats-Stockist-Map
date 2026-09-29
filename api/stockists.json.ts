import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

function setPublicHeaders(res: VercelResponse) {
  // This endpoint intentionally contains public map data only and is consumed
  // by the Clean Eats Shopify theme without credentials.
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

  const { data, error } = await supabase
    .from('stockists')
    // Do not expose customer email, phone, tags, internal IDs or timestamps.
    .select('name,address1,address2,city,province,postcode,country,latitude,longitude')
    .eq('is_active', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    console.error('[stockists.json] Supabase query failed', error);
    res.status(500).json({ error: 'Stockist data is temporarily unavailable.' });
    return;
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.status(200).json(data ?? []);
}
