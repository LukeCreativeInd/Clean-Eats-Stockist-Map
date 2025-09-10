// ======= config =======
const API_URL = '/api/stockists.json';  // change to absolute URL if embedding from another domain
const RADIUS_KM_POSTCODE = 5;           // fallback radius when a postcode search has no direct matches
const RADIUS_KM_NEAR_ME = 10;           // radius for "Use my location"
const BRAND_GREEN = '#CDEB25';
const MOBILE_MAX_ITEMS = 10;            // show only first N items on mobile before "Show all"

// ======= globals =======
let map;
let markers = []; // [{ marker, data: { name, city, state, postcode, country, lat, lng } }]
let uniqueStates = new Set();
let popup;

// ---------- utils ----------
function isMobile() {
  return window.matchMedia('(max-width: 1024px)').matches;
}

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

// ---------- markers ----------
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

// ---------- map helpers ----------
function fitToCoords(coords) {
  if (!coords.length) return;
  const bounds = coords.reduce(
    (b, [lng, lat]) => b.extend([lng, lat]),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, { padding: 40, duration: 200, maxZoom: 12 });
}

// Keep MapLibre sized correctly as the layout changes (desktop → stacked)
function installResizeHandlers() {
  window.addEventListener('resize', () => map && map.resize(), { passive: true });

  const container = document.getElementById('container');
  if (container && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => map && map.resize());
    ro.observe(container);
  }
}

// ---------- sidebar list ----------
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

// ================= init =================
(async function init() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [133.7751, -25.2744], // AU
    zoom: 4
  });

  // ensure proper sizing on layout changes
  installResizeHandlers();

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

  // state dropdown (guard if not present)
  const stateSelect = document.getElementById('state-select');
  if (stateSelect) {
    stateSelect.innerHTML = '<option value="">All States</option>';
    Array.from(uniqueStates).sort().forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      stateSelect.appendChild(opt);
    });
  }

  // initial fit after style finishes loading
  if (allCoords.length) {
    if (map.isStyleLoaded()) {
      fitToCoords(allCoords);
    } else {
      map.once('load', () => fitToCoords(allCoords));
    }
  }

  setupFiltering();
  setupUseMyLocation();
})();

// ================= filtering =================
function setupFiltering() {
  const nameInput = document.getElementById('search-name');
  const postcodeInput = document.getElementById('search-postcode');
  const stateSelect = document.getElementById('state-select');
  const listContainer = document.getElementById('stockist-entries');

  const applyFilter = async () => {
    const nameVal = (nameInput?.value || '').toLowerCase();
    const postcodeVal = (postcodeInput?.value || '').trim();
    const stateVal = (stateSelect?.value || '').toUpperCase();

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

    // list + fit (with mobile truncation)
    const coords = [];
    const container = document.getElementById('stockist-entries');
    container.innerHTML = '';

    let renderItems = visible;
    let truncated = false;
    if (isMobile() && visible.length > MOBILE_MAX_ITEMS) {
      renderItems = visible.slice(0, MOBILE_MAX_ITEMS);
      truncated = true;
    }

    renderItems.forEach(({ marker, data }) => {
      addToStockistList({ ...data, marker });
      coords.push([data.lng, data.lat]);
    });

    // "Show more" button for mobile if truncated
    let showMoreBtn = document.getElementById('show-more');
    if (truncated) {
      if (!showMoreBtn) {
        showMoreBtn = document.createElement('button');
        showMoreBtn.id = 'show-more';
        showMoreBtn.textContent = `Show all (${visible.length})`;
        // append right after the list container
        const panel = document.getElementById('stockist-list');
        panel.appendChild(showMoreBtn);
      } else {
        showMoreBtn.style.display = '';
        showMoreBtn.textContent = `Show all (${visible.length})`;
      }
      showMoreBtn.onclick = () => {
        container.innerHTML = '';
        visible.forEach(({ marker, data }) => addToStockistList({ ...data, marker }));
        showMoreBtn.style.display = 'none';
        const allCoords = visible.map(({ data }) => [data.lng, data.lat]);
        if (allCoords.length) fitToCoords(allCoords);
      };
    } else if (showMoreBtn) {
      showMoreBtn.style.display = 'none';
    }

    if (coords.length) fitToCoords(coords);
  };

  nameInput?.addEventListener('input', applyFilter);
  postcodeInput?.addEventListener('input', applyFilter);
  stateSelect?.addEventListener('change', applyFilter);
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    if (nameInput) nameInput.value = '';
    if (postcodeInput) postcodeInput.value = '';
    if (stateSelect) stateSelect.value = '';
    applyFilter();
  });

  // reapply filter on orientation change / resize (helps keep list trimmed)
  window.addEventListener('resize', applyFilter, { passive: true });

  applyFilter();
}

// ================= "Use my location" (parent-first for iOS Safari) =================
function getLocationViaParent() {
  return new Promise((resolve, reject) => {
    // Only if we are embedded
    if (window.parent === window) {
      reject(new Error('not-embedded'));
      return;
    }
    const handler = (ev) => {
      const d = ev.data || {};
      if (d.type === 'geolocation-response') {
        window.removeEventListener('message', handler);
        if (d.ok && d.coords) resolve(d.coords);
        else reject(new Error(d.error || 'denied'));
      }
    };
    window.addEventListener('message', handler, { once: true });
    // If you want to restrict, replace '*' with your parent origin
    window.parent.postMessage({ type: 'request-geolocation' }, '*');
  });
}

function setupUseMyLocation() {
  const btn = document.getElementById('use-location');
  if (!btn) return;

  let myMarker;

  btn.addEventListener('click', async () => {
    btn.disabled = true;

    // Try parent first (reliable on iOS Safari for cross-origin iframes)
    try {
      const coords = await getLocationViaParent();
      applyNearby(coords.lat, coords.lng);
      btn.disabled = false;
      return;
    } catch (_) {
      // fall through to iframe-based geolocation
    }

    if (!navigator.geolocation) {
      alert('Could not access your location.');
      btn.disabled = false;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyNearby(pos.coords.latitude, pos.coords.longitude);
        btn.disabled = false;
      },
      () => {
        alert('Could not access your location.');
        btn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });

  function applyNearby(lat, lng) {
    if (!myMarker) {
      myMarker = new maplibregl.Marker({ element: createMyLocationEl() })
        .setLngLat([lng, lat]).addTo(map);
    } else {
      myMarker.setLngLat([lng, lat]);
    }

    const nearby = markers.filter(({ data }) => distanceKm(lat, lng, data.lat, data.lng) <= RADIUS_KM_NEAR_ME);
    markers.forEach(({ marker, data }) => {
      const isVisible = nearby.some((v) => v.data === data);
      marker.getElement().style.display = isVisible ? '' : 'none';
    });

    const listContainer = document.getElementById('stockist-entries');
    listContainer.innerHTML = '';
    const coords = [[lng, lat]];
    nearby.forEach(({ marker, data }) => {
      addToStockistList({ ...data, marker });
      coords.push([data.lng, data.lat]);
    });
    if (coords.length) fitToCoords(coords);
  }
}
