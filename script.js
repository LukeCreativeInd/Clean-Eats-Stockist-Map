let map;
let markers = []; // array of { marker, data }
let uniqueStates = new Set();
let popup;

/** Haversine distance in km */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

(async function init() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [133.7751, -25.2744], // AU center
    zoom: 4
  });

  popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false });

  const resp = await fetch('/api/stockists.json');
  const data = await resp.json();

  data.forEach((row) => {
    const state = (row.province || '').toUpperCase();
    if (state) uniqueStates.add(state);

    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    function createRedMarkerEl() {
  const el = document.createElement('div');
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28">
      <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.41 11.38 7.05 11.98a1.4 1.4 0 0 0 1.9 0C13.59 21.38 20 15.25 20 10c0-4.42-3.58-8-8-8z" fill="#e63946"/>
      <circle cx="12" cy="10" r="3.2" fill="#ffffff"/>
    </svg>
  `;
  // position like MapLibre’s default marker
  el.style.transform = 'translate(-50%, -100%)';
  el.style.cursor = 'pointer';
  return el;
}

// use it:
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

    markers.push({
      marker,
      data: {
        ...row,
        state,
        lat,
        lng
      }
    });

    addToStockistList({ ...row, state, lat, lng, marker });
  });

  // State dropdown
  const stateSelect = document.getElementById('state-select');
  stateSelect.innerHTML = '<option value="">All States</option>';
  Array.from(uniqueStates).sort().forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stateSelect.appendChild(opt);
  });

  setupFiltering();
})();

function setupFiltering() {
  const nameInput = document.getElementById('search-name');
  const postcodeInput = document.getElementById('search-postcode');
  const stateSelect = document.getElementById('state-select');
  const listContainer = document.getElementById('stockist-entries');

  const applyFilter = () => {
    const nameVal = (nameInput.value || '').toLowerCase();
    const postcodeVal = (postcodeInput.value || '').trim();
    const stateVal = (stateSelect.value || '').toUpperCase();

    listContainer.innerHTML = '';
    let visibleMarkers = [];

    markers.forEach(({ marker, data }) => {
      const matchesName = (data.name || '').toLowerCase().includes(nameVal);
      const matchesPostcode = data.postcode?.includes(postcodeVal);
      const matchesState = !stateVal || data.state === stateVal;
      const visible = matchesName && matchesPostcode && matchesState;

      marker.getElement().style.display = visible ? '' : 'none';
      if (visible) {
        visibleMarkers.push({ marker, data });
        addToStockistList({ ...data, marker });
      }
    });

    // === New: 5km radius fallback if postcode search fails ===
    if (postcodeVal && visibleMarkers.length === 0) {
      // find lat/lng of that postcode (from any stockist entry)
      const ref = markers.find(({ data }) => data.postcode === postcodeVal);
      if (ref) {
        const { lat, lng } = ref.data;
        const nearby = markers.filter(
          ({ data }) => distanceKm(lat, lng, data.lat, data.lng) <= 5
        );
        nearby.forEach(({ marker, data }) => {
          marker.getElement().style.display = '';
          addToStockistList({ ...data, marker });
        });
        visibleMarkers = nearby;
      }
    }

    // fit bounds if we have any visible markers
    if (visibleMarkers.length > 0) {
      const coords = visibleMarkers.map(({ data }) => [data.lng, data.lat]);
      const bounds = coords.reduce(
        (b, [lng, lat]) => b.extend([lng, lat]),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 40, duration: 200 });
    }
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

// Helpers
function toTitleCase(str) {
  return (str || '').toLowerCase().replace(/\b\w+/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1));
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
