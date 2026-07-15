// ===== OpenRadio - Worldwide Internet Radio =====
// Uses the (unofficial) Radio Garden API: https://radio.garden/
//
// Endpoints:
//   /api/ara/content/places                    -> all places (cities) with country + station count
//   /api/ara/content/page/{placeId}/channels   -> stations in a place
//   /api/search?q=...                          -> search stations and places
//   /api/ara/content/listen/{id}/channel.mp3   -> 302 redirect to the actual stream

(function () {
  'use strict';

  // ===== Configuration =====
  const API_BASE = 'https://radio.garden/api';
  const SEARCH_DEBOUNCE = 400;
  const FAV_KEY = 'openradio_favorites';
  const VOL_KEY = 'openradio_volume';
  const LAST_STATION_KEY = 'openradio_last_station';
  const DISCOVER_SECTIONS = 3;
  const DISCOVER_LIMIT = 12;
  const CHIP_PAGE_SIZE = 200;

  let currentStation = null;
  let currentList = [];
  let currentIndex = -1;
  let isPlaying = false;
  let isLoading = false;
  let favorites = {};
  let searchTimeout = null;
  let placesCache = null;

  // ===== DOM References =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const audio = $('#audio-player');
  const playerBar = $('#player-bar');
  const playerName = $('#player-name');
  const playerMeta = $('#player-meta');
  const playerFavicon = $('#player-favicon');
  const btnPlay = $('#btn-play');
  const btnPrev = $('#btn-prev');
  const btnNext = $('#btn-next');
  const btnFavPlayer = $('#btn-fav-player');
  const btnMute = $('#btn-mute');
  const volumeSlider = $('#volume-slider');
  const iconPlay = $('#icon-play');
  const iconPause = $('#icon-pause');
  const iconLoading = $('#icon-loading');
  const heartOutline = $('#heart-outline');
  const heartFilled = $('#heart-filled');
  const volIcon = $('#vol-icon');
  const volMuteIcon = $('#vol-mute-icon');
  const searchBar = $('#search-bar');
  const searchInput = $('#search-input');
  const searchClear = $('#search-clear');
  const viewTitle = $('#view-title');
  const sidebarToggle = $('#sidebar-toggle');
  const sidebar = $('#sidebar');
  const favCountBadge = $('#fav-count');

  // ===== Initialize =====
  function init() {
    loadFavorites();
    loadVolume();
    setupEventListeners();
    setupSidebarBackdrop();
    navigateTo('discover');
  }

  // ===== API Helpers =====
  async function apiFetch(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // ===== Offline Snapshot Fallback =====
  // data/ holds a crawled copy of the directory (see tools/snapshot.mjs).
  // If the live API is unreachable (e.g. locked down), we serve from it.
  let snapshot = null; // { places, stations, byPlace: Map<placeId, station[]> }
  let snapshotNotified = false;

  async function loadSnapshot() {
    if (snapshot) return snapshot;
    const [placesRes, stationsRes] = await Promise.all([
      fetch('data/places.json'),
      fetch('data/stations.json'),
    ]);
    if (!placesRes.ok || !stationsRes.ok) throw new Error('No local snapshot available');
    const [places, stations] = await Promise.all([placesRes.json(), stationsRes.json()]);

    const byPlace = new Map();
    stations.forEach((s) => {
      if (!byPlace.has(s.placeId)) byPlace.set(s.placeId, []);
      byPlace.get(s.placeId).push(s);
    });

    snapshot = { places, stations, byPlace };
    if (!snapshotNotified) {
      snapshotNotified = true;
      showToast('Live API unreachable — using local snapshot');
    }
    return snapshot;
  }

  async function getPlaces() {
    if (placesCache) return placesCache;
    try {
      const data = await apiFetch('/ara/content/places');
      placesCache = data.data.list.filter((p) => p.title && p.country);
    } catch (err) {
      console.warn('Places API failed, trying local snapshot:', err.message);
      placesCache = (await loadSnapshot()).places;
    }
    return placesCache;
  }

  function channelId(pageUrl) {
    return pageUrl.split('/').pop();
  }

  // Normalize an API "page" object (from channels lists or search hits)
  // into the station shape used by cards, the player, and favorites.
  function toStation(page) {
    return {
      id: channelId(page.url),
      name: page.title,
      place: page.place ? page.place.title : '',
      country: page.country ? page.country.title : '',
      website: page.website || '',
      secure: !!page.secure,
    };
  }

  // On an https page, plain-http audio is blocked as mixed content;
  // route those streams through our own proxy (functions/listen.js)
  function proxiedIfNeeded(url) {
    if (url.startsWith('http://') && location.protocol === 'https:') {
      return `/listen?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function streamUrl(station) {
    // Snapshot data and legacy favorites carry their own stream URL
    if (station.streamUrl) {
      return proxiedIfNeeded(station.streamUrl);
    }
    // Live API station whose stream is insecure: the listen redirect would
    // land on http:// and be blocked on an https page — use the proxy
    if (station.secure === false && location.protocol === 'https:') {
      return `/listen?id=${encodeURIComponent(station.id)}`;
    }
    return `${API_BASE}/ara/content/listen/${station.id}/channel.mp3`;
  }

  async function getPlaceStations(placeId) {
    try {
      const data = await apiFetch(`/ara/content/page/${placeId}/channels`);
      const stations = [];
      (data.data.content || []).forEach((block) => {
        (block.items || []).forEach((item) => {
          if (item.page && item.page.type === 'channel') {
            stations.push(toStation(item.page));
          }
        });
      });
      return stations;
    } catch (err) {
      console.warn('Channels API failed, trying local snapshot:', err.message);
      return (await loadSnapshot()).byPlace.get(placeId) || [];
    }
  }

  async function searchStations(query) {
    try {
      const results = await apiFetch(`/search?q=${encodeURIComponent(query)}`);
      const hits = (results.hits && results.hits.hits) || [];
      return hits
        .filter((h) => h._source && h._source.type === 'channel' && h._source.page)
        .map((h) => toStation(h._source.page));
    } catch (err) {
      console.warn('Search API failed, trying local snapshot:', err.message);
      const q = query.toLowerCase();
      return (await loadSnapshot()).stations
        .filter((s) => s.name.toLowerCase().includes(q) || (s.place && s.place.toLowerCase().includes(q)))
        .slice(0, 50);
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ===== Navigation =====
  const views = {
    discover: { title: 'Discover', showSearch: false },
    globe: { title: 'Globe', showSearch: false },
    search: { title: 'Search', showSearch: true },
    favorites: { title: 'Favorites', showSearch: false },
    countries: { title: 'Browse by Country', showSearch: false },
    cities: { title: 'Browse by City', showSearch: false },
  };

  let currentView = 'discover';

  function navigateTo(view) {
    currentView = view;
    const config = views[view];

    $$('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');

    viewTitle.textContent = config.title;
    viewTitle.classList.toggle('hidden', config.showSearch);
    searchBar.classList.toggle('hidden', !config.showSearch);

    if (config.showSearch) {
      searchInput.focus();
    }

    closeSidebar();
    loadView(view);
  }

  async function loadView(view) {
    switch (view) {
      case 'discover':
        loadDiscover();
        break;
      case 'globe':
        loadGlobe();
        break;
      case 'favorites':
        renderFavorites();
        break;
      case 'countries':
        loadCountries();
        break;
      case 'cities':
        loadCities();
        break;
    }
  }

  // ===== Discover View =====
  let discoverLoaded = false;

  async function loadDiscover() {
    if (discoverLoaded) return;
    const container = $('#discover-sections');

    try {
      const places = await getPlaces();
      const featured = places.filter((p) => p.boost);
      const pool = featured.length >= DISCOVER_SECTIONS ? featured : places.filter((p) => p.size > 20);
      const picks = shuffle(pool).slice(0, DISCOVER_SECTIONS);

      container.innerHTML = '';

      picks.forEach((place) => {
        const block = document.createElement('div');
        block.className = 'section-block';
        block.innerHTML = `
          <h3 class="section-title">📍 ${escapeHtml(place.title)}, ${escapeHtml(place.country)}</h3>
          <div class="stations-grid loading-placeholder"><div class="loader"></div></div>`;
        container.appendChild(block);

        const grid = block.querySelector('.stations-grid');
        getPlaceStations(place.id)
          .then((stations) => {
            grid.classList.remove('loading-placeholder');
            grid.innerHTML = '';
            appendStationCards(grid, stations.slice(0, DISCOVER_LIMIT), stations);
          })
          .catch(() => {
            grid.classList.remove('loading-placeholder');
            grid.innerHTML = '<div class="empty-state"><p>Failed to load stations</p></div>';
          });
      });

      discoverLoaded = true;
    } catch (err) {
      console.error('Failed to load discover:', err);
      container.innerHTML = `
        <div class="empty-state">
          <p>Failed to load stations. Please refresh.</p>
          <span>Check your internet connection and try again</span>
        </div>`;
    }
  }

  // ===== Globe View =====
  // A dependency-free 3D globe: the ~12k city dots themselves draw the
  // continents (orthographic projection on a 2D canvas, like Radio Garden).
  let globeInited = false;

  async function loadGlobe() {
    if (globeInited) return;
    globeInited = true;

    const wrap = $('#globe-wrap');
    const canvas = $('#globe-canvas');
    const tooltip = $('#globe-tooltip');
    const stationsEl = $('#globe-stations');
    const ctx = canvas.getContext('2d');

    let pts = [];
    try {
      const places = await getPlaces();
      pts = places.filter((p) => Array.isArray(p.geo) && p.geo.length === 2);
    } catch (err) {
      console.error('Failed to load globe:', err);
      wrap.innerHTML = '<div class="empty-state"><p>Failed to load the globe. Please refresh.</p></div>';
      return;
    }

    // Precompute each place's trigonometry once
    const n = pts.length;
    const D2R = Math.PI / 180;
    const sinLat = new Float32Array(n);
    const cosLat = new Float32Array(n);
    const sinLng = new Float32Array(n);
    const cosLng = new Float32Array(n);
    // Projected screen position + depth, refreshed every render (for hit testing)
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const depth = new Float32Array(n);

    pts.forEach((p, i) => {
      const lng = p.geo[0] * D2R;
      const lat = p.geo[1] * D2R;
      sinLat[i] = Math.sin(lat);
      cosLat[i] = Math.cos(lat);
      sinLng[i] = Math.sin(lng);
      cosLng[i] = Math.cos(lng);
    });

    // View state: centered on Europe to start
    let lng0 = 10 * D2R;
    let lat0 = 40 * D2R;
    let zoom = 1;
    let autoRotate = true;
    let dirty = true;
    let hovered = -1;
    let dpr = 1;
    let W = 0;
    let H = 0;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      dirty = true;
    }
    resize();
    new ResizeObserver(resize).observe(wrap);

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-light').trim() || '#a78bfa';

    function render() {
      const cx = (W / 2) * dpr;
      const cy = (H / 2) * dpr;
      const R = Math.min(W, H) * 0.44 * zoom * dpr;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Sphere with subtle shading and rim glow
      const grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      grad.addColorStop(0, 'rgba(120, 100, 200, 0.22)');
      grad.addColorStop(0.7, 'rgba(60, 50, 110, 0.16)');
      grad.addColorStop(1, 'rgba(30, 25, 60, 0.3)');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      // Orthographic projection centered on (lat0, lng0)
      const sinLat0 = Math.sin(lat0);
      const cosLat0 = Math.cos(lat0);
      const sinLng0 = Math.sin(lng0);
      const cosLng0 = Math.cos(lng0);

      ctx.fillStyle = accent;
      for (let i = 0; i < n; i++) {
        // cos/sin of (lng - lng0) via angle-difference identities
        const cosDl = cosLng[i] * cosLng0 + sinLng[i] * sinLng0;
        const sinDl = sinLng[i] * cosLng0 - cosLng[i] * sinLng0;
        const z = sinLat0 * sinLat[i] + cosLat0 * cosLat[i] * cosDl;

        if (z <= 0) {
          depth[i] = -1;
          sx[i] = -1e5;
          continue;
        }

        const x = cosLat[i] * sinDl;
        const y = cosLat0 * sinLat[i] - sinLat0 * cosLat[i] * cosDl;

        const X = cx + x * R;
        const Y = cy - y * R;
        sx[i] = X;
        sy[i] = Y;
        depth[i] = z;

        const boost = pts[i].boost;
        const s = (boost ? 2.6 : pts[i].size > 40 ? 1.9 : 1.3) * dpr * Math.min(zoom, 2.2);
        ctx.globalAlpha = 0.25 + 0.75 * z;
        ctx.fillRect(X - s / 2, Y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      // Hovered city marker
      if (hovered >= 0 && depth[hovered] > 0) {
        ctx.beginPath();
        ctx.arc(sx[hovered], sy[hovered], 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
    }

    function frame() {
      if (autoRotate) {
        lng0 += 0.0006;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        render();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Nearest visible dot within grab distance of a canvas-space point
    function hitTest(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const mx = (clientX - rect.left) * dpr;
      const my = (clientY - rect.top) * dpr;
      const maxDist = 10 * dpr;
      let best = -1;
      let bestD = maxDist * maxDist;
      for (let i = 0; i < n; i++) {
        if (depth[i] <= 0) continue;
        const dx = sx[i] - mx;
        const dy = sy[i] - my;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    // Drag to rotate, click to open a city
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      autoRotate = false;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX;
        lastY = e.clientY;
        const k = 0.005 / zoom;
        lng0 -= dx * k;
        lat0 += dy * k;
        lat0 = Math.max(-1.45, Math.min(1.45, lat0));
        dirty = true;
        return;
      }

      const hit = hitTest(e.clientX, e.clientY);
      if (hit !== hovered) {
        hovered = hit;
        dirty = true;
      }
      canvas.style.cursor = hit >= 0 ? 'pointer' : 'grab';

      if (hit >= 0) {
        const p = pts[hit];
        tooltip.textContent = `${p.title}, ${p.country} · ${p.size} station${p.size === 1 ? '' : 's'}`;
        const rect = wrap.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 14}px`;
        tooltip.style.top = `${e.clientY - rect.top - 10}px`;
        tooltip.classList.remove('hidden');
      } else {
        tooltip.classList.add('hidden');
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      canvas.style.cursor = 'grab';
      if (moved < 5) {
        const hit = hitTest(e.clientX, e.clientY);
        if (hit >= 0) {
          const p = pts[hit];
          showPlaceStations(p, stationsEl, 'Back to Globe', () => {
            stationsEl.classList.add('hidden');
          });
          stationsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });

    canvas.addEventListener('pointerleave', () => {
      hovered = -1;
      tooltip.classList.add('hidden');
      dirty = true;
    });

    function setZoom(z) {
      zoom = Math.max(0.8, Math.min(10, z));
      dirty = true;
    }

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        autoRotate = false;
        setZoom(zoom * Math.exp(-e.deltaY * 0.0012));
      },
      { passive: false }
    );

    $('#globe-zoom-in').addEventListener('click', () => setZoom(zoom * 1.4));
    $('#globe-zoom-out').addEventListener('click', () => setZoom(zoom / 1.4));
  }

  // ===== Search =====
  function handleSearch(query) {
    if (searchTimeout) clearTimeout(searchTimeout);

    searchClear.classList.toggle('hidden', !query);

    if (!query.trim()) {
      renderSearchEmpty();
      return;
    }

    searchTimeout = setTimeout(async () => {
      const container = $('#search-results');
      container.innerHTML = '<div class="loading-placeholder"><div class="loader"></div></div>';

      try {
        const stations = await searchStations(query);

        container.innerHTML = '';

        if (stations.length === 0) {
          container.innerHTML = `
            <div class="empty-state">
              <p>No stations found</p>
              <span>Try a different search term</span>
            </div>`;
        } else {
          appendStationCards(container, stations);
        }
      } catch (err) {
        console.error('Search failed:', err);
        showError('search-results', 'Search failed. Please try again.');
      }
    }, SEARCH_DEBOUNCE);
  }

  function renderSearchEmpty() {
    $('#search-results').innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>Search for radio stations worldwide</p>
        <span>Type a station name or place</span>
      </div>`;
  }

  // ===== Shared: station list for a place =====
  async function showPlaceStations(place, stationsEl, backLabel, onBack) {
    stationsEl.classList.remove('hidden');
    stationsEl.innerHTML = `
      <div style="grid-column: 1/-1">
        <button class="back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          ${escapeHtml(backLabel)}
        </button>
        <h3 class="section-title">${escapeHtml(place.title)}, ${escapeHtml(place.country)}</h3>
      </div>
      <div class="loading-placeholder" style="grid-column:1/-1"><div class="loader"></div></div>`;

    stationsEl.querySelector('.back-btn').addEventListener('click', onBack);

    try {
      const stations = await getPlaceStations(place.id);
      const header = stationsEl.querySelector('div:first-child');
      stationsEl.innerHTML = '';
      if (header) stationsEl.appendChild(header);

      if (stations.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<p>No stations in this place</p>';
        stationsEl.appendChild(empty);
      } else {
        appendStationCards(stationsEl, stations);
      }
    } catch (err) {
      console.error('Failed to load place stations:', err);
      showError(stationsEl.id, 'Failed to load stations. Please try again.');
    }
  }

  function renderPlaceChips(container, places, onSelect) {
    container.innerHTML = '';
    let shown = 0;

    function renderPage() {
      const wrapper = container.querySelector('.load-more-wrapper');
      if (wrapper) wrapper.remove();

      const page = places.slice(shown, shown + CHIP_PAGE_SIZE);
      shown += page.length;

      const frag = document.createDocumentFragment();
      page.forEach((p) => {
        const chip = document.createElement('button');
        chip.className = 'tag-chip';
        chip.innerHTML = `${escapeHtml(p.title)} <span class="tag-count">${p.size}</span>`;
        chip.addEventListener('click', () => onSelect(p));
        frag.appendChild(chip);
      });
      container.appendChild(frag);

      if (shown < places.length) {
        const more = document.createElement('div');
        more.className = 'load-more-wrapper';
        more.style.flexBasis = '100%';
        more.innerHTML = '<button class="load-more-btn">Load More Cities</button>';
        more.querySelector('.load-more-btn').addEventListener('click', renderPage);
        container.appendChild(more);
      }
    }

    renderPage();
  }

  // ===== Countries =====
  let countriesLoaded = false;

  async function loadCountries() {
    if (countriesLoaded) return;

    try {
      const places = await getPlaces();

      // Group places by country, summing station counts
      const byCountry = new Map();
      places.forEach((p) => {
        const entry = byCountry.get(p.country) || { name: p.country, count: 0, places: [] };
        entry.count += p.size;
        entry.places.push(p);
        byCountry.set(p.country, entry);
      });

      const countries = [...byCountry.values()].sort((a, b) => b.count - a.count);

      const container = $('#countries-list');
      container.classList.remove('loading-placeholder');
      container.innerHTML = '';

      const frag = document.createDocumentFragment();
      countries.forEach((c) => {
        const chip = document.createElement('button');
        chip.className = 'tag-chip';
        chip.innerHTML = `${escapeHtml(c.name)} <span class="tag-count">${c.count}</span>`;
        chip.addEventListener('click', () => showCountryCities(c));
        frag.appendChild(chip);
      });
      container.appendChild(frag);

      countriesLoaded = true;
    } catch (err) {
      console.error('Failed to load countries:', err);
    }
  }

  function showCountryCities(country) {
    const listEl = $('#countries-list');
    const citiesEl = $('#country-cities');
    const stationsEl = $('#country-stations');

    listEl.classList.add('hidden');
    stationsEl.classList.add('hidden');
    citiesEl.classList.remove('hidden');

    citiesEl.innerHTML = `
      <div style="flex-basis:100%">
        <button class="back-btn" id="back-countries">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Countries
        </button>
        <h3 class="section-title">${escapeHtml(country.name)}</h3>
      </div>`;

    $('#back-countries').addEventListener('click', () => {
      citiesEl.classList.add('hidden');
      listEl.classList.remove('hidden');
    });

    const chipArea = document.createElement('div');
    chipArea.className = 'tags-grid';
    chipArea.style.flexBasis = '100%';
    citiesEl.appendChild(chipArea);

    const sorted = country.places.slice().sort((a, b) => b.size - a.size);
    renderPlaceChips(chipArea, sorted, (place) => {
      citiesEl.classList.add('hidden');
      showPlaceStations(place, stationsEl, 'Back to Cities', () => {
        stationsEl.classList.add('hidden');
        citiesEl.classList.remove('hidden');
      });
    });
  }

  // ===== Cities =====
  let citiesLoaded = false;

  async function loadCities() {
    if (citiesLoaded) return;

    try {
      const places = await getPlaces();
      const sorted = places.slice().sort((a, b) => b.size - a.size);

      const container = $('#cities-list');
      container.classList.remove('loading-placeholder');

      renderPlaceChips(container, sorted, (place) => {
        container.classList.add('hidden');
        showPlaceStations(place, $('#city-stations'), 'Back to Cities', () => {
          $('#city-stations').classList.add('hidden');
          container.classList.remove('hidden');
        });
      });

      citiesLoaded = true;
    } catch (err) {
      console.error('Failed to load cities:', err);
    }
  }

  // ===== Favorites =====
  function loadFavorites() {
    try {
      const data = localStorage.getItem(FAV_KEY);
      const raw = data ? JSON.parse(data) : {};
      favorites = {};
      Object.values(raw).forEach((f) => {
        if (f.id) {
          favorites[f.id] = f;
        } else if (f.stationuuid) {
          // Migrate a favorite saved by the old Radio Browser version:
          // keep its direct stream URL since Radio Garden uses different ids
          favorites[f.stationuuid] = {
            id: f.stationuuid,
            name: f.name,
            place: '',
            country: f.country || '',
            website: f.homepage || '',
            streamUrl: f.url_resolved,
          };
        }
      });
    } catch {
      favorites = {};
    }
    updateFavCount();
  }

  function saveFavorites() {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
    updateFavCount();
  }

  function toggleFavorite(station) {
    const id = station.id;
    if (favorites[id]) {
      delete favorites[id];
      showToast(`Removed "${station.name}" from favorites`);
    } else {
      favorites[id] = station;
      showToast(`Added "${station.name}" to favorites`);
    }
    saveFavorites();
    updateFavoriteButtons(id);

    if (currentView === 'favorites') {
      renderFavorites();
    }
  }

  function isFavorite(id) {
    return !!favorites[id];
  }

  function updateFavCount() {
    const count = Object.keys(favorites).length;
    favCountBadge.textContent = count;
    favCountBadge.classList.toggle('hidden', count === 0);
  }

  function updateFavoriteButtons(id) {
    $$(`.btn-fav[data-id="${id}"]`).forEach((btn) => {
      btn.classList.toggle('active', isFavorite(id));
      btn.innerHTML = isFavorite(id)
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    });

    if (currentStation && currentStation.id === id) {
      updatePlayerFavButton();
    }
  }

  function updatePlayerFavButton() {
    if (!currentStation) return;
    const fav = isFavorite(currentStation.id);
    heartOutline.classList.toggle('hidden', fav);
    heartFilled.classList.toggle('hidden', !fav);
  }

  function renderFavorites() {
    const container = $('#favorites-list');
    const favList = Object.values(favorites);

    if (favList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <p>No favorites yet</p>
          <span>Click the heart icon on any station to save it here</span>
        </div>`;
      return;
    }

    container.classList.remove('loading-placeholder');
    container.innerHTML = '';
    appendStationCards(container, favList);
  }

  // ===== Render Station Cards =====
  function appendStationCards(container, stations, fullList) {
    const frag = document.createDocumentFragment();
    // fullList is the complete list (for prev/next beyond what's rendered)
    const playableList = fullList || stations;

    stations.forEach((station) => {
      const card = document.createElement('div');
      card.className = 'station-card';
      if (currentStation && currentStation.id === station.id && isPlaying) {
        card.classList.add('playing');
      }
      card.dataset.id = station.id;

      const tags = [station.place, station.country].filter(Boolean).join(' / ');
      const fav = isFavorite(station.id);

      card.innerHTML = `
        <div class="station-favicon">📻</div>
        <div class="station-info">
          <span class="station-name" title="${escapeAttr(station.name)}">${escapeHtml(station.name)}</span>
          <span class="station-tags">${escapeHtml(tags)}</span>
        </div>
        <div class="now-playing-indicator">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="station-actions">
          <button class="btn-fav ${fav ? 'active' : ''}" data-id="${escapeAttr(station.id)}" aria-label="Toggle favorite" title="Toggle favorite">
            ${
              fav
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
            }
          </button>
        </div>`;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav')) {
          toggleFavorite(station);
          return;
        }

        currentList = playableList;
        currentIndex = playableList.findIndex((s) => s.id === station.id);

        playStation(station);
      });

      frag.appendChild(card);
    });

    container.appendChild(frag);
  }

  // ===== Audio Player =====
  let retryCount = 0;
  let triedSnapshotStream = false;
  const MAX_RETRIES = 2;

  function playStation(station) {
    currentStation = station;
    isLoading = true;
    isPlaying = false;
    retryCount = 0;
    triedSnapshotStream = false;
    updatePlayerUI();

    playerBar.classList.remove('hidden');

    // The listen endpoint 302-redirects to the real stream; the browser follows it
    attemptPlay(streamUrl(station));

    try {
      localStorage.setItem(LAST_STATION_KEY, JSON.stringify(station));
    } catch {}

    updateMediaSession(station);
  }

  function attemptPlay(url) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    // Small delay to let the audio element reset
    setTimeout(() => {
      audio.src = url;
      audio.load();

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Playback attempt failed:', err.message);

          if (retryCount < MAX_RETRIES && currentStation) {
            retryCount++;
            console.log(`Retrying playback (${retryCount}/${MAX_RETRIES})...`);
            setTimeout(() => attemptPlay(url), 500 * retryCount);
          } else {
            isLoading = false;
            isPlaying = false;
            updatePlayerUI();
            showToast('Failed to play this station. Try another one.');
          }
        });
      }
    }, 100);
  }

  function togglePlayPause() {
    if (!currentStation) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {
        showToast('Playback failed. Try again.');
      });
    }
  }

  function playPrev() {
    if (currentList.length === 0 || currentIndex <= 0) return;
    currentIndex--;
    playStation(currentList[currentIndex]);
  }

  function playNext() {
    if (currentList.length === 0 || currentIndex >= currentList.length - 1) return;
    currentIndex++;
    playStation(currentList[currentIndex]);
  }

  function updatePlayerUI() {
    if (!currentStation) return;

    playerName.textContent = currentStation.name;
    const metaParts = [currentStation.place, currentStation.country].filter(Boolean);
    playerMeta.textContent = metaParts.join(' / ');

    // Radio Garden has no station artwork
    playerFavicon.src = '';
    playerFavicon.style.display = 'none';

    iconPlay.classList.toggle('hidden', isPlaying || isLoading);
    iconPause.classList.toggle('hidden', !isPlaying || isLoading);
    iconLoading.classList.toggle('hidden', !isLoading);

    updatePlayerFavButton();

    $$('.station-card').forEach((card) => {
      card.classList.toggle('playing', card.dataset.id === currentStation.id && isPlaying);
    });

    if (isPlaying) {
      document.title = `${currentStation.name} - OpenRadio`;
    } else {
      document.title = 'OpenRadio - Worldwide Internet Radio';
    }
  }

  // ===== Audio Events =====
  audio.addEventListener('playing', () => {
    isPlaying = true;
    isLoading = false;
    updatePlayerUI();
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    isLoading = false;
    updatePlayerUI();
  });

  audio.addEventListener('waiting', () => {
    isLoading = true;
    updatePlayerUI();
  });

  audio.addEventListener('error', async () => {
    if (!currentStation) return;

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`Stream error, retrying (${retryCount}/${MAX_RETRIES})...`);
      setTimeout(() => attemptPlay(streamUrl(currentStation)), 500 * retryCount);
      return;
    }

    // Last resort: the listen endpoint may be down — try the direct
    // stream URL from the local snapshot
    if (!currentStation.streamUrl && !triedSnapshotStream) {
      triedSnapshotStream = true;
      try {
        const snap = await loadSnapshot();
        const saved = snap.stations.find((s) => s.id === currentStation.id);
        if (saved && saved.streamUrl) {
          console.log('Falling back to snapshot stream URL...');
          attemptPlay(proxiedIfNeeded(saved.streamUrl));
          return;
        }
      } catch {}
    }

    isPlaying = false;
    isLoading = false;
    updatePlayerUI();
    showToast('Stream unavailable. Try another station.');
  });

  audio.addEventListener('ended', () => {
    playNext();
  });

  // ===== Volume =====
  function loadVolume() {
    const saved = localStorage.getItem(VOL_KEY);
    const vol = saved ? parseInt(saved, 10) : 80;
    volumeSlider.value = vol;
    audio.volume = vol / 100;
  }

  function setVolume(val) {
    audio.volume = val / 100;
    localStorage.setItem(VOL_KEY, val);
    updateVolumeIcon();
  }

  function toggleMute() {
    if (audio.volume > 0) {
      audio.dataset.prevVol = audio.volume;
      audio.volume = 0;
      volumeSlider.value = 0;
    } else {
      const prev = parseFloat(audio.dataset.prevVol) || 0.8;
      audio.volume = prev;
      volumeSlider.value = Math.round(prev * 100);
    }
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    const muted = audio.volume === 0;
    volIcon.classList.toggle('hidden', muted);
    volMuteIcon.classList.toggle('hidden', !muted);
  }

  // ===== Media Session API =====
  function updateMediaSession(station) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: [station.place, station.country].filter(Boolean).join(', ') || 'Internet Radio',
      album: 'OpenRadio',
    });

    navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
  }

  // ===== Sidebar =====
  function setupSidebarBackdrop() {
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.id = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', closeSidebar);
  }

  function toggleSidebar() {
    sidebar.classList.toggle('open');
    $('#sidebar-backdrop').classList.toggle('active');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    const backdrop = $('#sidebar-backdrop');
    if (backdrop) backdrop.classList.remove('active');
  }

  // ===== Toast =====
  let toastTimeout;
  function showToast(message) {
    let toast = $('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // ===== Error Display =====
  function showError(containerId, message) {
    const container = $(`#${containerId}`);
    container.classList.remove('loading-placeholder');
    container.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(message)}</p>
        <span>Check your internet connection and try again</span>
      </div>`;
  }

  // ===== Helpers =====
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    $$('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    btnPlay.addEventListener('click', togglePlayPause);
    btnPrev.addEventListener('click', playPrev);
    btnNext.addEventListener('click', playNext);
    btnFavPlayer.addEventListener('click', () => {
      if (currentStation) toggleFavorite(currentStation);
    });

    volumeSlider.addEventListener('input', (e) => setVolume(e.target.value));
    btnMute.addEventListener('click', toggleMute);

    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      handleSearch('');
      searchInput.focus();
    });

    sidebarToggle.addEventListener('click', toggleSidebar);

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          playPrev();
          break;
        case 'ArrowRight':
          playNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          volumeSlider.value = Math.min(100, parseInt(volumeSlider.value) + 5);
          setVolume(volumeSlider.value);
          break;
        case 'ArrowDown':
          e.preventDefault();
          volumeSlider.value = Math.max(0, parseInt(volumeSlider.value) - 5);
          setVolume(volumeSlider.value);
          break;
        case 'm':
          toggleMute();
          break;
        case '/':
          e.preventDefault();
          navigateTo('search');
          break;
        case 'f':
          if (currentStation) toggleFavorite(currentStation);
          break;
      }
    });
  }

  // ===== Start =====
  document.addEventListener('DOMContentLoaded', init);
})();
