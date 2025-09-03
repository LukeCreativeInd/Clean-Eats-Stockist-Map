// ======= config =======
const API_URL = '/api/stockists.json'; // use absolute URL if this HTML is hosted on another domain
const RADIUS_KM = 5;                   // fallback radius for postcode search
const MIN_FIT_ZOOM = 6;                // don't allow fitBounds to zoom out more than this

// ======= globals =======
let map;
let markers = []; // [{ marker, data: { name, city, state, postcode, country, lat, lng } }]
let uniqueStates = new Set();
let popup;

// Haversine distance (km)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Minimal postcode geocode using Nominatim (client-side)
// Only called when a postcode search returns no matches.
async function geocodePostcodeAU(postcode) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    `Australia ${postcode}`
  )}&format=json&limit=1&countrycodes=au`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const first = data?.[0];
  if (!first) return null;
  return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
}

function toTitleCase(str) {
  return (str || '')
    .toLowerCase()
    .replace(/\b\w+/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Create a red marker element
function createRedMarkerEl() {
  const el = document.createElement('div');
  el.className = 'custom-marker';
  return el;
}

// Fit to a set of [lng,lat] coords and enforce MIN_FIT_ZOOM
function fitToCoords(coords) {
  if (!coords.length) return;
  const bounds = coords.reduce(
    (b, [lng, lat]) => b.extend([lng, lat]),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, { padding: 40, duration: 200 });
  // enforce a minimum zoom after fitting
  setTimeout(() => {
    if (map.getZoom() < MIN_FIT_ZOOM) {
      map.easeTo({ zoom: MIN_FIT_ZOOM, duration: 100 });
    }
  }, 220);
}

// Add one item to the sidebar list
function addToStockistList(data) {
  const container = document.getElementById('stockist-entries');
  const div = document.createElement('div');
  div.className = 'stockist';
  div.innerHTML = `
    <strong>${escapeHtml(data.name)}</strong><br/>
    ${toTitleCase(data.address1 || '')}<br/>
    ${toTitleCase(data.city || '')}, ${escapeHtml(data.postcode || '')} ${(data.state || '')}<br/>
    ${toTitleCase(data.country || '')}
  `;
  div.addEventListener('mouseenter', () => {
    data.marker.getElement().style.transform = 'scale(1.2)';
  });
  div.addEventListener('mouseleave', () => {
    data.marker.getElement().style.transform = '';
  });
  div.addEventListener('click', () => {
    map.easeTo({ center: [data.lng, data.lat], zoom: 14 });
    data.marker.getElement().dispatchEvent(new MouseEvent('click'));
  });
  container.appendChild(div);
}

// ==== init ====
(async function init() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [133.7751, -25.2744], // AU center
    zoom: 4
  });

  popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false });

  // Load data
  const resp = await fetch(API_URL);
  const data = await resp.json();

  // Build markers & list
  const allCoords = [];
  data.forEach((row) => {
    const state = (row.province || '').toUpperCase();
    if (state) uniqueStates.add(state);

    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const marker = new maplibregl.Marker({ element: createRedMarkerEl() })
      .setLngLat([lng, lat])
      .addTo(map);

    const html = `
      <strong>${escapeHtml(row.name)}</strong><br/>
      ${escapeHtml(row.address1 || '')}<br/>
      ${escapeHtml(row.city || '')} ${escapeHtml(row.postcode || '')} ${state}<br/>
      ${escapeHtml(row.country || '')}
    `;
    marker.getElement().addEventListener('click', () => {
      popup.setLngLat([lng, lat]).setHTML(html).addTo(map);
    });

    const item = {
      marker,
      data: {
        ...row,
        state,
        lat,
        lng
      }
    };
    markers.push(item);
    addToStockistList({ ...row, state, lat, lng, marker });

    allCoords.push([lng, lat]);
  });

  // populate states
  const stateSelect = document.getElementById('state-select');
  stateSelect.innerHTML = '<option value="">All States</option>';
  Array.from(uniqueStates).sort().forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stateSelect.appendChild(opt);
  });

  // initial fit
  if (allCoords.length) fitToCoords(allCoords);

  setupFiltering();
})();

function setupFiltering() {
  const nameInput = document.getElementById('search-name');
  const postcodeInput = document.getElementById('search-postcode');
  const stateSelect = document.getElementById('state-select');
  const listContainer = document.getElementById('stockist-entries');

  const applyFilter = async () => {
    const nameVal = (nameInput.value || '').toLowerCase();
    const postcodeVal = (postcodeInput.value || '').trim();
    const stateVal = (stateSelect.value || '').toUpperCase();

    listContainer.innerHTML = '';

    // filter pass 1: direct matches
    let visible = markers.filter(({ data }) => {
      const matchesName = (data.name || '').toLowerCase().includes(nameVal);
      const matchesPostcode = data.postcode?.includes(postcodeVal);
      const matchesState = !stateVal || data.state === stateVal;
      return matchesName && matchesPostcode && matchesState;
    });

    // toggle visibility in map
    markers.forEach(({ marker, data }) => {
      const isVisible = visible.some((v) => v.data === data);
      marker.getElement().style.display = isVisible ? '' : 'none';
    });

    // If a postcode was typed and nothing matched, 5km fallback
    if (postcodeVal && visible.length === 0) {
      // geocode the typed postcode (AU)
      const center = await geocodePostcodeAU(postcodeVal);
      if (center) {
        visible = markers.filter(({ data }) => distanceKm(center.lat, center.lng, data.lat, data.lng) <= RADIUS_KM);
        // show those
        markers.forEach(({ marker, data }) => {
          const isVisible = visible.some((v) => v.data === data);
          marker.getElement().style.display = isVisible ? '' : 'none';
        });
      }
    }

    // rebuild list + fit
    const coords = [];
    visible.forEach(({ marker, data }) => {
      addToStockistList({ ...data, marker });
      coords.push([data.lng, data.lat]);
    });

    if (coords.length) {
      fitToCoords(coords);
    }
  };

  nameInput.addEventListener('input', applyFilter);
  postcodeInput.addEventListener('input', applyFilter);
  stateSelect.addEventListener('change', applyFilter);
  document.getElementById
