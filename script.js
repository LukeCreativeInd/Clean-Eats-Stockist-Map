// ======= config =======
const API_URL = '/api/stockists.json';  // absolute URL if embedding from another domain
const RADIUS_KM_POSTCODE = 5;           // fallback radius when a postcode search has no direct matches
const RADIUS_KM_NEAR_ME = 10;           // radius for "Use my location"
const MIN_FIT_ZOOM = 6;                 // don't allow fitBounds to zoom out beyond this
const BRAND_GREEN = '#CDEB25';

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

// Minimal postcode geocode using Nominatim (client-side), used only on empty postcode matches
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

// Create a brand-green marker element (inline SVG)
function createBrandMarkerEl() {
  const el = document.createElement('div');
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.41 11.38 7.05 11.98a1.4 1.4 0 0 0 1.9 0C13.59 21.38 20 15.25 20 10c0-4.42-3.58-8-8-8z" fill="${BRAND_GREEN}"/>
      <circle cx="12" cy="10" r="3.2" fill="#000"/>
    </svg>
  `;
  el.style.transform = 'translate(-50%, -100%)';
  el.style.cursor = 'pointer';
  return el;
}

// Optional: a small dot for "my location"
function createMyLocationEl() {
  const el = document.createElement('div');
  el.style.width = '14px';
  el.style.height = '14px';
  el.style.border = '2px solid #000';
  el.style.background = BRAND_GREEN;
  el.style.borderRadius = '50%';
  el.style.boxShadow = '0 0 6px rgba(0,0,0,0.4)';
  el.style.transform = 'translate(-50%, -50%)';
  return el;
}

// Fit to coords and enforce a minimum zoom
function fitToCoords(coords) {
  if (!coords.length) return;
  const bounds = coords.reduce(
    (b, [lng, lat]) => b.extend([lng, lat]),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, { padding: 40, duration: 200 });
  setTimeout(() => {
    if (map.getZoom() < MIN_FIT_ZOOM) {
      map.easeTo({ zoom: MIN_FIT_ZOOM, duration: 100 });
    }
  }, 220);
}

// Add one item to the sidebar
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
    center: [133.7751, -25.2744], // AU
    zoom: 4
  });

  popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false });

  const resp = await fetch(API_URL);
  const data = await resp.json();

  const allCoords = [];
  data.forEach((row) => {
    const state = (row.province || '').toUpperCase();
    if (state) uniqueStates.add(state);

    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const marker = new maplibregl.Marker({ element: createBrandMarkerEl() })
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
      data: { ...row, state, lat, lng }
    };
    markers.push(item);
    addToStockistList({ ...row, state, lat, lng, marker });

    allCoords.push([lng, lat]);
  });

  // state dropdown
  const stateSelect = document.getElementById('state-select');
  stateSelect.innerHTML = '<option value="">All States</option>';
  Array.from(uniqueStates).sort().forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stateSelect.appendChild(opt);
  });

  if (allCoords.length) fitToCoords(allCoords);

  setupFiltering();
  setupUseMyLocation();
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

    // pass 1: direct matches
    let visible = markers.filter(({ data }) => {
      const matchesName = (data.name || '').toLowerCase().includes(nameVal);
      const matchesPostcode = data.postcode?.includes(postcodeVal);
      const matchesState = !stateVal || data.state === stateVal;
      return matchesName && matchesPostcode && matchesState;
    });

    // toggle visibility
    markers.forEach(({ marker, data }) => {
      const isVisible = visible.some((v) => v.data === data);
      marker.getElement().style.display = isVisible ? '' : 'none';
    });

    // postcode fallback (5km) if nothing matched
    if (postcodeVal && visible.length === 0) {
      const center = await geocodePostcodeAU(postcodeVal);
      if (center) {
        visible = markers.filter(({ data }) => distanceKm(center.lat, center.lng, data.lat, data.lng) <= RADIUS_KM_POSTCODE);
        markers.forEach(({ marker, data }) => {
          const isVisible = visible.some((v) => v.data === data);
          marker.getElement().style.display = isVisible ? '' : 'none';
        });
      }
    }

    // list + fit
    const coords = [];
    visible.forEach(({ marker, data }) => {
      addToStockistList({ ...data, marker });
      coords.push([data.lng, data.lat]);
    });
    if (coords.length) fitToCoords(coords);
  };

  nameInput.addEventListener('input', applyFilter);
  postcodeInput.addEventListener('input', applyFilter);
  stateSelect.addEventListener('change', applyFilter);
  document.getElementById('clear-filters').addEventListener('click', () => {
    nameInput.value = '';
    postcodeInput.value = '';
    stateSelect.value = '';
    applyFilter();
  });

  applyFilter();
}

// Use my location: centers map & shows stockists within RADIUS_KM_NEAR_ME
function setupUseMyLocation() {
  const btn = document.getElementById('use-location');
  if (!btn || !navigator.geolocation) {
    if (btn) btn.disabled = true;
    return;
  }

  let myMarker; // keep a single marker for user location

  btn.addEventListener('click', () => {
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        // show / move user marker
        if (!myMarker) {
          myMarker = new maplibregl.Marker({ element: createMyLocationEl() })
            .setLngLat([lng, lat]).addTo(map);
        } else {
          myMarker.setLngLat([lng, lat]);
        }

        // filter markers within radius
        const nearby = markers.filter(({ data }) => distanceKm(lat, lng, data.lat, data.lng) <= RADIUS_KM_NEAR_ME);
        markers.forEach(({ marker, data }) => {
          const isVisible = nearby.some((v) => v.data === data);
          marker.getElement().style.display = isVisible ? '' : 'none';
        });

        // rebuild list + fit (include user marker position)
        const listContainer = document.getElementById('stockist-entries');
        listContainer.innerHTML = '';
        const coords = [[lng, lat]];
        nearby.forEach(({ marker, data }) => {
          addToStockistList({ ...data, marker });
          coords.push([data.lng, data.lat]);
        });
        if (coords.length) fitToCoords(coords);

        btn.disabled = false;
      },
      (_err) => {
        // if blocked or failed, just re-enable the button
        btn.disabled = false;
        alert('Could not access your location.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}
