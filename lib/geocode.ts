export type Coords = { lat: number; lng: number };

export async function geocodeNominatim(q: string): Promise<Coords | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=au`;
  const resp = await fetch(url, {
    headers: {
      // Keep an identifying UA per OSM policy
      'User-Agent': 'CleanEats-StockistMap/1.0 (contact@cleaneatsaustralia.com.au)'
    }
  });
  if (!resp.ok) return null;
  const data: any[] = await resp.json();
  const first = data?.[0];
  if (!first) return null;
  return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
}
