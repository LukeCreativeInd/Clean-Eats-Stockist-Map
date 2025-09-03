import type { VercelRequest, VercelResponse } from '@vercel/node';
import getRawBody from 'raw-body';
import { supabaseAdmin } from '../../lib/supabase.js';
import { verifyShopifyHmac } from '../../lib/hmac.js';
import { geocodeNominatim } from '../../lib/geocode.js';

export const config = {
  api: { bodyParser: false } // Needed to read raw body for HMAC
};

type ShopifyCustomer = {
  id: number | string;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  tags?: string | null;
  default_address?: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
};

function normId(id: ShopifyCustomer['id']): number {
  return typeof id === 'string' ? Number(id) : (id as number);
}

function nameFrom(c: ShopifyCustomer) {
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return c.company?.trim() || (parts.length ? parts.join(' ') : 'Unnamed');
}

function buildAddressString(r: {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postcode?: string | null;
  country?: string | null;
}) {
  return [r.address1, r.address2, r.city, r.province, r.postcode, r.country || 'Australia']
    .filter(Boolean)
    .join(', ');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).send('Server not configured');
    return;
  }

  const raw = await getRawBody(req);
  const ok = verifyShopifyHmac(raw, req.headers['x-shopify-hmac-sha256'], secret);
  if (!ok) {
    res.status(401).send('Invalid HMAC');
    return;
  }

  const topic = String(req.headers['x-shopify-topic'] || '');
  const payload = JSON.parse(raw.toString('utf8')) as ShopifyCustomer | { id: number | string };

  // Soft delete
  if (topic === 'customers/delete') {
    const id = normId((payload as any).id);
    await supabaseAdmin.from('stockists').update({ is_active: false }).eq('id', id);
    res.status(200).send('ok');
    return;
  }

  // Create / Update
  const c = payload as ShopifyCustomer;
  const id = normId(c.id);
  const addr = c.default_address || {};
  const tags = (c.tags || '').toString();
  const nomap = tags.toLowerCase().includes('nomap');

  // Fetch existing to detect address change
  const { data: existing } = await supabaseAdmin
    .from('stockists')
    .select('address1,address2,city,province,postcode,country')
    .eq('id', id)
    .maybeSingle();

  const incoming = {
    address1: addr.address1 || null,
    address2: addr.address2 || null,
    city: addr.city || null,
    province: addr.province || null,
    postcode: addr.zip || null,
    country: addr.country || 'Australia'
  };

  const addressChanged =
    !existing ||
    existing.address1 !== incoming.address1 ||
    existing.address2 !== incoming.address2 ||
    existing.city !== incoming.city ||
    existing.province !== incoming.province ||
    existing.postcode !== incoming.postcode ||
    existing.country !== incoming.country;

  const upsert: any = {
    id,
    name: nameFrom(c),
    email: c.email ?? null,
    phone: c.phone ?? null,
    ...incoming,
    tags,
    is_active: !nomap
  };

  // One-time geocode if active and new/changed address
  if (!nomap && addressChanged) {
    const full = buildAddressString(incoming);
    let coords = full ? await geocodeNominatim(full) : null;
    if (!coords && incoming.postcode) {
      coords = await geocodeNominatim(`Australia ${incoming.postcode}`);
    }
    if (coords) {
      upsert.latitude = coords.lat;
      upsert.longitude = coords.lng;
    } else {
      upsert.latitude = null;
      upsert.longitude = null;
    }
  }

  await supabaseAdmin.from('stockists').upsert(upsert);
  res.status(200).send('ok');
}
