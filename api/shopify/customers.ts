import type { VercelRequest, VercelResponse } from '@vercel/node';
import getRawBody from 'raw-body';
import { supabaseAdmin } from '../../lib/supabase.js';
import { verifyShopifyHmac } from '../../lib/hmac.js';
import { geocodeNominatim } from '../../lib/geocode.js';

const SHOP = process.env.SHOPIFY_SHOP!;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

export const config = {
  api: { bodyParser: false }
};

type ShopifyCustomer = {
  id: number | string;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  tags?: string | string[] | null;
  default_address?: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
};

// ---- helpers ----
function idAsIs(id: ShopifyCustomer['id']) {
  // keep whatever type your column currently expects (number if you haven’t migrated yet)
  return typeof id === 'string' ? Number(id) : (id as number);
}
function nameFrom(c: ShopifyCustomer) {
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return c.company?.trim() || (parts.length ? parts.join(' ') : 'Unnamed');
}
function addressStr(r: {
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
function normAddress(c: ShopifyCustomer) {
  const a = c.default_address || {};
  return {
    address1: a.address1 || null,
    address2: a.address2 || null,
    city: a.city || null,
    province: a.province || null,
    postcode: a.zip || null,
    country: a.country || 'Australia'
  };
}
function toTagList(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}
async function fetchCustomerTagsFromAdmin(id: number | string): Promise<string[]> {
  const url = `https://${SHOP}/admin/api/2024-10/customers/${id}.json`;
  const resp = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': ADMIN_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) {
    // if this fails for any reason, fall back to empty list
    return [];
  }
  const json = await resp.json();
  return toTagList(json?.customer?.tags);
}

// ---- handler ----
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

  // delete → soft deactivate
  if (topic === 'customers/delete') {
    const id = idAsIs((payload as any).id);
    await supabaseAdmin.from('stockists').update({ is_active: false }).eq('id', id);
    res.status(200).send('ok');
    return;
  }

  // create/update
  const c = payload as ShopifyCustomer;
  const id = idAsIs(c.id);

  // Authoritative tags from Admin API (robust against webhook payload quirks)
  const liveTags = await fetchCustomerTagsFromAdmin(c.id);
  const nomap = liveTags.some((t) => t.toLowerCase() === 'nomap');
  const tagsStr = liveTags.join(', '); // how we store it in Supabase

  // Address normalization
  const incoming = normAddress(c);

  // Detect address changes to decide geocoding
  const { data: existing } = await supabaseAdmin
    .from('stockists')
    .select('address1,address2,city,province,postcode,country')
    .eq('id', id)
    .maybeSingle();

  const addressChanged =
    !existing ||
    existing.address1 !== incoming.address1 ||
    existing.address2 !== incoming.address2 ||
    existing.city !== incoming.city ||
    existing.province !== incoming.province ||
    existing.postcode !== incoming.postcode ||
    existing.country !== incoming.country;

  // Upsert payload
  const upsert: any = {
    id,
    name: nameFrom(c),
    email: c.email ?? null,
    phone: c.phone ?? null,
    ...incoming,
    tags: tagsStr,          // <- always mirror Shopify
    is_active: !nomap
  };

  // One-time geocode if active and new/changed address
  if (!nomap && addressChanged) {
    const full = addressStr(incoming);
    let coords = full ? await geocodeNominatim(full) : null;
    if (!coords && incoming.postcode) coords = await geocodeNominatim(`Australia ${incoming.postcode}`);
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
