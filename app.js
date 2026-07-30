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
  const API_BASE = '/api';
  const RADIO_GARDEN_API = 'https://radio.garden/api';
  // Cloudflare serves /api in production. Plain-HTTP development servers use
  // the bundled snapshot because they cannot run Pages Functions.
  const LIVE_API_ENABLED = location.protocol === 'https:';
  const SEARCH_DEBOUNCE = 400;
  const FAV_KEY = 'openradio_favorites';
  const VOL_KEY = 'openradio_volume';
  const LAST_STATION_KEY = 'openradio_last_station';

  let currentStation = null;
  let currentList = [];
  let currentIndex = -1;
  let isPlaying = false;
  let isLoading = false;
  let favorites = {};
  let placesCache = null;
  let placesPromise = null;
  let refreshGlobeMarkers = null;
  let openGlobePlace = null;

  // ===== DOM References =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const audio = $('#audio-player');
  const playerBar = $('#player-bar');
  const playerName = $('#player-name');
  const playerMeta = $('#player-meta');
  const playerFavicon = $('#player-favicon');
  const playerWave = $('#player-wave');
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
  const btnLocate = $('#btn-locate');
  const btnSurprise = $('#btn-surprise');
  const favCountBadge = $('#fav-count');

  // Command palette — the single entry point for finding anything.
  const palette = $('#palette');
  const paletteInput = $('#palette-input');
  const paletteResults = $('#palette-results');
  const searchTrigger = $('#search-trigger');

  // Favorites sheet, and the scrim shared by both overlays.
  const favoritesPanel = $('#favorites-panel');
  const favoritesList = $('#favorites-list');
  const btnFavorites = $('#btn-favorites');
  const scrim = $('#scrim');

  // ===== Initialize =====
  function init() {
    loadFavorites();
    loadVolume();
    setupEventListeners();

    // Show the shortcut the way this platform writes it.
    if (/Mac|iPhone|iPad/.test(navigator.platform || '')) {
      $('#search-trigger-key').textContent = '⌘K';
    }

    // The globe is the app, not a view you navigate to: build it immediately.
    loadMapLibreGlobe();
  }

  // ===== API Helpers =====
  async function apiFetch(path) {
    if (!LIVE_API_ENABLED) throw new Error('Live API disabled for local development');
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // ===== Local Snapshot & Fallback =====
  // data/ holds a crawled copy of the directory (see tools/snapshot.mjs).
  // Local servers use it directly; production falls back if the API is down.
  let snapshot = null; // { places, stations, byPlace: Map<placeId, station[]> }
  let snapshotPromise = null;
  let snapshotPlaces = null;
  let snapshotPlacesPromise = null;
  let snapshotNotified = false;

  // Places are enough for the globe and browse views. Keep them separate from
  // the 10 MB station snapshot so opening the globe offline stays lightweight.
  async function loadSnapshotPlaces() {
    if (snapshot && snapshot.places) return snapshot.places;
    if (snapshotPlaces) return snapshotPlaces;
    if (!snapshotPlacesPromise) {
      snapshotPlacesPromise = fetch('data/places.json')
        .then((res) => {
          if (!res.ok) throw new Error('No local places snapshot available');
          return res.json();
        })
        .then((places) => {
          snapshotPlaces = places;
          return places;
        })
        .catch((err) => {
          snapshotPlacesPromise = null;
          throw err;
        });
    }
    return snapshotPlacesPromise;
  }

  async function loadSnapshot() {
    if (snapshot) return snapshot;
    if (!snapshotPromise) {
      snapshotPromise = (async () => {
        const [places, stationsRes] = await Promise.all([
          loadSnapshotPlaces(),
          fetch('data/stations.json'),
        ]);
        if (!stationsRes.ok) throw new Error('No local stations snapshot available');
        const stations = await stationsRes.json();

        const byPlace = new Map();
        stations.forEach((s) => {
          if (!byPlace.has(s.placeId)) byPlace.set(s.placeId, []);
          byPlace.get(s.placeId).push(s);
        });

        snapshot = { places, stations, byPlace };
        if (LIVE_API_ENABLED && !snapshotNotified) {
          snapshotNotified = true;
          showToast('Live API unreachable — using local snapshot');
        }
        return snapshot;
      })().catch((err) => {
        snapshotPromise = null;
        throw err;
      });
    }
    return snapshotPromise;
  }

  async function getPlaces() {
    if (placesCache) return placesCache;
    if (!placesPromise) {
      placesPromise = (async () => {
        if (!LIVE_API_ENABLED) {
          placesCache = await loadSnapshotPlaces();
          return placesCache;
        }
        try {
          const data = await apiFetch('/ara/content/places');
          placesCache = data.data.list.filter((p) => p.title && p.country);
        } catch (err) {
          console.warn('Places API failed, trying local snapshot:', err.message);
          placesCache = await loadSnapshotPlaces();
        }
        return placesCache;
      })().catch((err) => {
        placesPromise = null;
        throw err;
      });
    }
    return placesPromise;
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
      placeId: page.place ? page.place.id : '',
      country: page.country ? page.country.title : '',
      website: page.website || '',
      secure: !!page.secure,
    };
  }

  // Production audio stays same-origin through the restricted streaming proxy.
  // Besides handling mixed content, this lets Web Audio analyse the stream
  // without requiring every third-party station host to provide CORS headers.
  function proxiedStreamUrl(url) {
    if (LIVE_API_ENABLED) {
      return `/listen?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function streamUrl(station) {
    // Snapshot data and legacy favorites carry their own stream URL.
    if (station.streamUrl) {
      return proxiedStreamUrl(station.streamUrl);
    }
    if (LIVE_API_ENABLED) {
      return `/listen?id=${encodeURIComponent(station.id)}`;
    }
    return `${RADIO_GARDEN_API}/ara/content/listen/${station.id}/channel.mp3`;
  }

  async function getPlaceStations(placeId) {
    if (!LIVE_API_ENABLED) return (await loadSnapshot()).byPlace.get(placeId) || [];
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
    if (!LIVE_API_ENABLED) {
      const q = query.toLowerCase();
      return (await loadSnapshot()).stations
        .filter((s) => s.name.toLowerCase().includes(q) || (s.place && s.place.toLowerCase().includes(q)))
        .slice(0, 50);
    }
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
  // There is only ever one view: the globe. Everything else is an overlay on
  // top of it, so the render loop below never has to be torn down.
  const currentView = 'globe';

  let activeOverlay = null; // 'palette' | 'favorites' | null

  function setScrim(visible) {
    scrim.classList.toggle('hidden', !visible);
    requestAnimationFrame(() => scrim.classList.toggle('is-visible', visible));
  }

  function closeOverlay() {
    if (activeOverlay === 'palette') closePalette();
    else if (activeOverlay === 'favorites') closeFavorites();
  }

  async function showPlaceOnGlobe(place, options = {}) {
    closeOverlay();
    await loadMapLibreGlobe();
    if (!openGlobePlace) {
      showToast('The globe could not be loaded. Please try again.');
      return false;
    }
    openGlobePlace(place, options);
    return true;
  }

  async function showStationOnGlobe(station) {
    const places = await getPlaces();
    const place = (station.placeId && places.find((candidate) => candidate.id === station.placeId))
      || places.find((candidate) => (
        candidate.title.toLocaleLowerCase() === station.place.toLocaleLowerCase()
        && candidate.country.toLocaleLowerCase() === station.country.toLocaleLowerCase()
      ));
    if (!place) {
      showToast('This station location is not available on the globe.');
      return false;
    }
    return showPlaceOnGlobe(place, { markLocation: true });
  }

  // ===== Command Palette =====
  // One field resolves everything the old Search / By Country / By City views
  // used to: cities, countries, and stations, ranked together.
  const PALETTE_PLACE_LIMIT = 7;
  const PALETTE_STATION_LIMIT = 6;
  const PALETTE_SUGGESTIONS = 6;

  let paletteToken = 0;
  let paletteItems = [];
  let paletteIndex = -1;
  let paletteTimer = null;

  function openPalette(prefill = '') {
    if (activeOverlay === 'favorites') closeFavorites();
    activeOverlay = 'palette';
    palette.classList.remove('hidden');
    setScrim(true);
    requestAnimationFrame(() => palette.classList.add('is-visible'));
    paletteInput.value = prefill;
    paletteInput.focus();
    paletteInput.select();
    runPalette(prefill);
  }

  function closePalette() {
    if (activeOverlay !== 'palette') return;
    activeOverlay = null;
    paletteToken++;
    if (paletteTimer) clearTimeout(paletteTimer);
    palette.classList.remove('is-visible');
    paletteInput.setAttribute('aria-expanded', 'false');
    paletteInput.blur();
    setScrim(false);

    const finish = () => {
      if (activeOverlay === 'palette') return;
      palette.classList.add('hidden');
      paletteResults.innerHTML = '';
      paletteItems = [];
      paletteIndex = -1;
    };
    if (prefersReducedMotion()) finish();
    else setTimeout(finish, 180);
  }

  // Same ranking the globe's own place lookup used: exact prefixes first,
  // then substring hits, with the busiest places breaking ties.
  function matchPlaces(places, raw) {
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const place of places) {
      const title = (place.title || '').toLowerCase();
      const country = (place.country || '').toLowerCase();
      let score;
      if (title === q) score = 0;
      else if (title.startsWith(q)) score = 1;
      else if (country.startsWith(q)) score = 2;
      else if (title.includes(q)) score = 3;
      else if (country.includes(q)) score = 4;
      else continue;
      scored.push({ place, score });
    }
    scored.sort((a, b) => a.score - b.score
      || (Number(b.place.size) || 0) - (Number(a.place.size) || 0));
    return scored.map((entry) => entry.place);
  }

  function paletteRowHtml(item, index) {
    const active = index === paletteIndex ? ' active' : '';
    if (item.kind === 'place') {
      const count = Number(item.place.size) || 0;
      return `
        <button class="palette-row${active}" role="option" type="button" data-idx="${index}" aria-selected="${index === paletteIndex}">
          <span class="palette-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </span>
          <span class="palette-text">
            <span class="palette-title">${escapeHtml(item.place.title)}</span>
            <span class="palette-sub">${escapeHtml(item.place.country || '')}</span>
          </span>
          <span class="palette-tag">${count} station${count === 1 ? '' : 's'}</span>
        </button>`;
    }
    const where = [item.station.place, item.station.country].filter(Boolean).join(' · ');
    return `
      <button class="palette-row${active}" role="option" type="button" data-idx="${index}" aria-selected="${index === paletteIndex}">
        <span class="palette-icon palette-icon-station" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 16.25a6 6 0 0 1 0-8.49"/></svg>
        </span>
        <span class="palette-text">
          <span class="palette-title">${escapeHtml(item.station.name)}</span>
          <span class="palette-sub">${escapeHtml(where)}</span>
        </span>
        <span class="palette-tag palette-tag-play">Tune in</span>
      </button>`;
  }

  function renderPalette(items, options = {}) {
    paletteItems = items;
    if (paletteIndex >= items.length) paletteIndex = items.length - 1;
    if (items.length && paletteIndex < 0) paletteIndex = 0;

    const groups = [];
    const places = items.filter((item) => item.kind === 'place');
    const stations = items.filter((item) => item.kind === 'station');

    if (places.length) {
      groups.push(`<p class="palette-group">${escapeHtml(options.placeLabel || 'Places')}</p>`);
      groups.push(...places.map((item) => paletteRowHtml(item, items.indexOf(item))));
    }
    if (stations.length) {
      groups.push(`<p class="palette-group">${escapeHtml(options.stationLabel || 'Stations')}</p>`);
      groups.push(...stations.map((item) => paletteRowHtml(item, items.indexOf(item))));
    }
    if (options.pendingStations) {
      groups.push('<p class="palette-group">Stations</p>');
      groups.push('<div class="palette-pending"><div class="loader loader-sm"></div>Searching stations…</div>');
    }
    if (!groups.length) {
      groups.push(`
        <div class="palette-empty">
          <p>Nothing matched that.</p>
          <span>Try a city, a country, or part of a station name.</span>
        </div>`);
    }

    paletteResults.innerHTML = groups.join('');
    paletteInput.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    scrollPaletteIntoView();
  }

  function scrollPaletteIntoView() {
    const row = paletteResults.querySelector('.palette-row.active');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function movePaletteSelection(delta) {
    if (!paletteItems.length) return;
    paletteIndex = (paletteIndex + delta + paletteItems.length) % paletteItems.length;
    paletteResults.querySelectorAll('.palette-row').forEach((row) => {
      const active = Number(row.dataset.idx) === paletteIndex;
      row.classList.toggle('active', active);
      row.setAttribute('aria-selected', String(active));
    });
    scrollPaletteIntoView();
  }

  function choosePalette(index = paletteIndex) {
    const item = paletteItems[index];
    if (!item) return;
    if (item.kind === 'place') {
      showPlaceOnGlobe(item.place);
    } else {
      currentList = [item.station];
      currentIndex = 0;
      playStation(item.station);
      showStationOnGlobe(item.station).catch(() => {
        // Playback already started; the globe simply could not follow along.
      });
    }
    closePalette();
  }

  // Empty field: offer somewhere to go rather than a blank sheet.
  async function renderPaletteSuggestions(token) {
    const favList = Object.values(favorites).slice(0, 3);
    let places = [];
    try {
      const all = await getPlaces();
      const boosted = all.filter((place) => place.boost);
      const pool = boosted.length >= PALETTE_SUGGESTIONS ? boosted : all.filter((place) => place.size > 40);
      places = shuffle(pool.slice()).slice(0, PALETTE_SUGGESTIONS);
    } catch {
      places = [];
    }
    if (token !== paletteToken) return;

    renderPalette([
      ...places.map((place) => ({ kind: 'place', place })),
      ...favList.map((station) => ({ kind: 'station', station })),
    ], { placeLabel: 'On air somewhere', stationLabel: 'Your favorites' });
  }

  function runPalette(raw) {
    const query = raw.trim();
    const token = ++paletteToken;
    paletteIndex = query ? 0 : -1;
    if (paletteTimer) clearTimeout(paletteTimer);

    if (!query) {
      renderPaletteSuggestions(token);
      return;
    }

    // Places live in memory, so they answer instantly; stations need the API
    // and arrive underneath a moment later.
    getPlaces()
      .catch(() => [])
      .then((places) => {
        if (token !== paletteToken) return;
        const matched = matchPlaces(places, query).slice(0, PALETTE_PLACE_LIMIT);
        renderPalette(matched.map((place) => ({ kind: 'place', place })), { pendingStations: true });

        paletteTimer = setTimeout(async () => {
          let stations = [];
          try {
            stations = await searchStations(query);
          } catch (err) {
            console.warn('Palette station search failed:', err);
          }
          if (token !== paletteToken) return;
          renderPalette([
            ...matched.map((place) => ({ kind: 'place', place })),
            ...stations.slice(0, PALETTE_STATION_LIMIT).map((station) => ({ kind: 'station', station })),
          ]);
        }, SEARCH_DEBOUNCE);
      });
  }

  // ===== Favorites sheet =====
  function openFavorites() {
    if (activeOverlay === 'palette') closePalette();
    activeOverlay = 'favorites';
    renderFavorites();
    favoritesPanel.classList.remove('hidden');
    setScrim(true);
    requestAnimationFrame(() => favoritesPanel.classList.add('is-visible'));
    btnFavorites.setAttribute('aria-expanded', 'true');
  }

  function closeFavorites() {
    if (activeOverlay !== 'favorites') return;
    activeOverlay = null;
    favoritesPanel.classList.remove('is-visible');
    btnFavorites.setAttribute('aria-expanded', 'false');
    setScrim(false);

    const finish = () => {
      if (activeOverlay === 'favorites') return;
      favoritesPanel.classList.add('hidden');
    };
    if (prefersReducedMotion()) finish();
    else setTimeout(finish, 240);
  }

  function toggleFavoritesPanel() {
    if (activeOverlay === 'favorites') closeFavorites();
    else openFavorites();
  }

  // ===== Surprise me =====
  // Serendipity replaces the old Discover view: drop the listener into a real
  // place on the globe instead of showing three lists of cards.
  let surprising = false;

  async function surpriseMe() {
    if (surprising) return;
    surprising = true;
    btnSurprise.disabled = true;
    btnSurprise.setAttribute('aria-busy', 'true');
    try {
      const places = await getPlaces();
      const boosted = places.filter((place) => place.boost);
      const pool = boosted.length ? boosted : places.filter((place) => place.size > 20);
      if (!pool.length) throw new Error('No places available');
      const place = pool[Math.floor(Math.random() * pool.length)];
      await showPlaceOnGlobe(place, { markLocation: true });
    } catch (err) {
      console.error('Surprise me failed:', err);
      showToast('Could not reach the station directory. Please try again.');
    } finally {
      surprising = false;
      btnSurprise.disabled = false;
      btnSurprise.removeAttribute('aria-busy');
    }
  }

  // ===== Globe View =====
  // WebGL globe (globe.gl, vendored in lib/) with high-resolution Natural
  // Earth vector geometry that remains sharp at every zoom level.
  const GLOBE_COUNTRIES = 'data/countries.geojson';
  const GLOBE_POLYGON_ALTITUDE = 0.003;
  const GLOBE_MIN_ALTITUDE = 0.02;
  const GLOBE_MAX_ALTITUDE = 12;
  let globeInited = false;
  let globeLibraryPromise = null;
  let globeCountriesPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  function loadGlobeLibrary() {
    if (window.Globe) return Promise.resolve();
    if (!globeLibraryPromise) {
      globeLibraryPromise = loadScript('lib/globe.gl.min.js').catch((err) => {
        globeLibraryPromise = null;
        throw err;
      });
    }
    return globeLibraryPromise;
  }

  function loadGlobeCountries() {
    if (!globeCountriesPromise) {
      globeCountriesPromise = fetch(GLOBE_COUNTRIES)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load country geometry: ${res.status}`);
          return res.json();
        })
        .catch((err) => {
          globeCountriesPromise = null;
          throw err;
        });
    }
    return globeCountriesPromise;
  }

  function prepareGlobeAssets() {
    return Promise.all([loadGlobeLibrary(), loadGlobeCountries()]);
  }

  async function loadGlobe() {
    if (globeInited) {
      if (window.__globe) window.__globe.resumeAnimation();
      if (refreshGlobeMarkers) refreshGlobeMarkers();
      return;
    }
    globeInited = true;

    const wrap = $('#globe-wrap');
    const container = $('#globe-3d');
    const tooltip = $('#globe-tooltip');
    const stationsEl = $('#globe-stations');

    wrap.classList.add('is-loading');
    container.classList.add('loading-placeholder');
    container.innerHTML = '<div class="loader" aria-label="Loading globe"></div>';

    let pts;
    let countries;
    try {
      const [places, , countryData] = await Promise.all([
        getPlaces(),
        loadGlobeLibrary(),
        loadGlobeCountries(),
      ]);
      pts = places.filter((p) => Array.isArray(p.geo) && p.geo.length === 2);
      countries = countryData;
    } catch (err) {
      console.error('Failed to load globe:', err);
      globeInited = false;
      wrap.classList.remove('is-loading');
      container.classList.remove('loading-placeholder');
      container.innerHTML = '<div class="empty-state"><p>Failed to load the globe. Please refresh.</p></div>';
      return;
    }

    container.classList.remove('loading-placeholder');
    container.innerHTML = '';

    const initialRect = container.getBoundingClientRect();
    const initialWidth = Math.max(1, Math.floor(initialRect.width));
    const initialHeight = Math.max(1, Math.floor(initialRect.height));

    // Keep the earth itself on the GPU. City markers are rendered by one 2D
    // canvas pass below; generating 12,000 individual cylinders is both slower
    // and makes their apparent size depend on camera distance.
    let resolveGlobeReady;
    const globeReady = new Promise((resolve) => {
      resolveGlobeReady = resolve;
    });
    const globe = Globe({
      rendererConfig: {
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      },
    })(container)
      .width(initialWidth)
      .height(initialHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#93c5fd')
      .atmosphereAltitude(0.14)
      .enablePointerInteraction(false)
      .polygonsData(countries.features)
      .polygonCapColor(() => '#263b4f')
      .polygonSideColor(() => 'rgba(7, 18, 31, 0.9)')
      .polygonStrokeColor(() => 'rgba(154, 210, 235, 0.65)')
      .polygonAltitude(GLOBE_POLYGON_ALTITUDE)
      .polygonsTransitionDuration(0)
      .onGlobeReady(resolveGlobeReady);

    globe.globeMaterial().color.set('#071a2c');
    globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    window.__globe = globe;

    globe.pointOfView({ lat: 35, lng: 8, altitude: 1.85 }, 0);

    const controls = globe.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    // globe.gl uses a 100-unit sphere; keep OrbitControls and button zoom in
    // the same broad altitude range.
    controls.minDistance = 100 * (1 + GLOBE_MIN_ALTITUDE);
    controls.maxDistance = 100 * (1 + GLOBE_MAX_ALTITUDE);
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
    });

    const pointsCanvas = $('#globe-points');
    const pointsContext = pointsCanvas.getContext('2d', { alpha: true });
    const statsEl = $('#globe-stats');
    const totalStations = pts.reduce((total, place) => total + (Number(place.size) || 0), 0);
    statsEl.textContent = `${pts.length.toLocaleString()} places · ${totalStations.toLocaleString()} stations`;

    // At a world view several nearby cities occupy the same few pixels. Keep
    // the busiest one as the visual anchor and roll the density into its size.
    // Finer levels are selected as the camera approaches the earth.
    function clusterPlaces(cellSize) {
      if (!cellSize) {
        return pts.map((place) => ({
          place,
          placeCount: 1,
          stationCount: Number(place.size) || 0,
          boost: !!place.boost,
        }));
      }

      const cells = new Map();
      pts.forEach((place) => {
        const lat = Number(place.geo[1]);
        const lng = Number(place.geo[0]);
        const key = `${Math.floor((lat + 90) / cellSize)}:${Math.floor((lng + 180) / cellSize)}`;
        const stationCount = Number(place.size) || 0;
        const score = stationCount + (place.boost ? 1000 : 0);
        const marker = cells.get(key);

        if (!marker) {
          cells.set(key, {
            place,
            placeCount: 1,
            stationCount,
            boost: !!place.boost,
            score,
          });
          return;
        }

        marker.placeCount += 1;
        marker.stationCount += stationCount;
        marker.boost = marker.boost || !!place.boost;
        if (score > marker.score) {
          marker.place = place;
          marker.score = score;
        }
      });
      return Array.from(cells.values());
    }

    const markerLevels = [
      { maxAltitude: 0.42, markers: clusterPlaces(0) },
      { maxAltitude: 0.85, markers: clusterPlaces(0.8) },
      { maxAltitude: 1.5, markers: clusterPlaces(1.6) },
      { maxAltitude: Infinity, markers: clusterPlaces(2.4) },
    ];

    let markerWidth = initialWidth;
    let markerHeight = initialHeight;
    let markerPixelRatio = 1;
    let markerFrame = 0;
    let hoveredPlace = null;
    const markerCells = new Map();
    const markerCellSize = 24;

    function resizePointsCanvas(width, height) {
      markerWidth = width;
      markerHeight = height;
      markerPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelWidth = Math.max(1, Math.round(width * markerPixelRatio));
      const pixelHeight = Math.max(1, Math.round(height * markerPixelRatio));
      if (pointsCanvas.width !== pixelWidth) pointsCanvas.width = pixelWidth;
      if (pointsCanvas.height !== pixelHeight) pointsCanvas.height = pixelHeight;
    }

    function drawMarkers() {
      markerFrame = 0;
      const pov = globe.pointOfView();
      const altitude = Math.max(0.01, pov.altitude || 0.01);
      const level = markerLevels.find((item) => altitude <= item.maxAltitude);
      const cameraLat = pov.lat * Math.PI / 180;
      const cameraLng = pov.lng * Math.PI / 180;
      const sinCameraLat = Math.sin(cameraLat);
      const cosCameraLat = Math.cos(cameraLat);
      const horizon = 1 / (1 + altitude) - 0.025;
      const zoomScale = Math.max(0.9, Math.min(1.2, 1.14 - altitude * 0.07));

      pointsContext.setTransform(markerPixelRatio, 0, 0, markerPixelRatio, 0, 0);
      pointsContext.clearRect(0, 0, markerWidth, markerHeight);
      pointsContext.beginPath();
      markerCells.clear();

      level.markers.forEach((marker) => {
        const lat = marker.place.geo[1] * Math.PI / 180;
        const lng = marker.place.geo[0] * Math.PI / 180;
        const facing = Math.sin(lat) * sinCameraLat
          + Math.cos(lat) * cosCameraLat * Math.cos(lng - cameraLng);
        if (facing < horizon) return;

        const screen = globe.getScreenCoords(
          marker.place.geo[1],
          marker.place.geo[0],
          GLOBE_POLYGON_ALTITUDE,
        );
        if (
          screen.x < -8 || screen.y < -8
          || screen.x > markerWidth + 8 || screen.y > markerHeight + 8
        ) return;

        const density = Math.log2(marker.stationCount + marker.placeCount * 2 + 1);
        const radius = (1.65 + Math.min(2.4, density * 0.32) + (marker.boost ? 0.7 : 0))
          * zoomScale;
        marker.x = screen.x;
        marker.y = screen.y;
        marker.radius = radius;
        const cellX = Math.floor(screen.x / markerCellSize);
        const cellY = Math.floor(screen.y / markerCellSize);
        const cellKey = `${cellX}:${cellY}`;
        const cell = markerCells.get(cellKey);
        if (cell) cell.push(marker);
        else markerCells.set(cellKey, [marker]);
        pointsContext.moveTo(screen.x + radius, screen.y);
        pointsContext.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      });

      pointsContext.save();
      pointsContext.globalCompositeOperation = 'lighter';
      pointsContext.fillStyle = 'rgba(74, 246, 137, 0.95)';
      pointsContext.shadowColor = 'rgba(65, 255, 137, 0.9)';
      pointsContext.shadowBlur = 5;
      pointsContext.fill();
      pointsContext.restore();

      if (hoveredPlace) {
        const screen = globe.getScreenCoords(
          hoveredPlace.geo[1],
          hoveredPlace.geo[0],
          GLOBE_POLYGON_ALTITUDE,
        );
        pointsContext.beginPath();
        pointsContext.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
        pointsContext.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        pointsContext.lineWidth = 1.5;
        pointsContext.stroke();
      }
    }

    function scheduleMarkerDraw() {
      if (currentView !== 'globe') return;
      if (!markerFrame) markerFrame = requestAnimationFrame(drawMarkers);
    }

    refreshGlobeMarkers = scheduleMarkerDraw;
    resizePointsCanvas(initialWidth, initialHeight);
    controls.addEventListener('change', scheduleMarkerDraw);
    globeReady.then(() => {
      requestAnimationFrame(() => {
        drawMarkers();
        requestAnimationFrame(() => wrap.classList.remove('is-loading'));
      });
    });
    if (currentView !== 'globe') globe.pauseAnimation();

    // Use the globe's cheap sphere projection for interaction instead of
    // enabling polygon raycasting over the complete country mesh.
    let downX = 0;
    let downY = 0;
    container.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    container.addEventListener('pointerup', (e) => {
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) return;
      const hit = markerAt(e);
      if (hit) {
        showPlaceStations(hit, stationsEl, 'Close', () => {
          stationsEl.classList.add('hidden');
        }, { scroll: true });
      }
    });

    function markerAt(event) {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let nearest = null;
      let nearestDistance = Infinity;

      const cellX = Math.floor(x / markerCellSize);
      const cellY = Math.floor(y / markerCellSize);
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          const cell = markerCells.get(`${cellX + offsetX}:${cellY + offsetY}`) || [];
          cell.forEach((marker) => {
            const dx = marker.x - x;
            const dy = marker.y - y;
            const distance = dx * dx + dy * dy;
            const hitRadius = Math.max(10, marker.radius + 4);
            if (distance <= hitRadius * hitRadius && distance < nearestDistance) {
              nearest = marker.place;
              nearestDistance = distance;
            }
          });
        }
      }
      return nearest;
    }

    let hoverFrame = 0;
    let hoverEvent = null;
    function updateHover() {
      hoverFrame = 0;
      const e = hoverEvent;
      if (!e) return;
      const hit = markerAt(e);
      if (hit) {
        if (hoveredPlace !== hit) {
          hoveredPlace = hit;
          scheduleMarkerDraw();
        }
        tooltip.textContent = `${hit.title}, ${hit.country} · ${hit.size} station${hit.size === 1 ? '' : 's'}`;
        const wrect = wrap.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - wrect.left + 14}px`;
        tooltip.style.top = `${e.clientY - wrect.top - 10}px`;
        tooltip.classList.remove('hidden');
      } else {
        if (hoveredPlace) {
          hoveredPlace = null;
          scheduleMarkerDraw();
        }
        tooltip.classList.add('hidden');
      }
    }
    container.addEventListener('pointermove', (e) => {
      hoverEvent = { clientX: e.clientX, clientY: e.clientY };
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
    });

    container.addEventListener('pointerleave', () => {
      hoverEvent = null;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
      hoveredPlace = null;
      scheduleMarkerDraw();
      tooltip.classList.add('hidden');
    });
    container.addEventListener('pointerdown', () => tooltip.classList.add('hidden'));

    let renderedWidth = initialWidth;
    let renderedHeight = initialHeight;
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);

      resizeFrame = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        // Ignore insignificant one-pixel layout fluctuations.
        if (
          Math.abs(width - renderedWidth) < 2 &&
          Math.abs(height - renderedHeight) < 2
        ) {
          return;
        }

        renderedWidth = width;
        renderedHeight = height;
        globe.width(width).height(height);
        resizePointsCanvas(width, height);
        scheduleMarkerDraw();
      });
    });
    resizeObserver.observe(container);

    // Zoom buttons (wheel/pinch zoom is built into the controls)
    function zoomBy(factor) {
      const pov = globe.pointOfView();
      const altitude = Math.max(
        GLOBE_MIN_ALTITUDE,
        Math.min(GLOBE_MAX_ALTITUDE, pov.altitude * factor),
      );
      globe.pointOfView({ altitude }, 300);
    }
    $('#globe-zoom-in').addEventListener('click', () => zoomBy(0.65));
    $('#globe-zoom-out').addEventListener('click', () => zoomBy(1 / 0.65));
  }

  // Globe info popover (the "!" button in the globe's bottom-left corner).
  // Guarded: a cached index.html may not contain this markup yet.
  {
    const infoButton = $('#globe-info-btn');
    const infoPanel = $('#globe-info-panel');
    if (infoButton && infoPanel) {
      const closeInfo = () => {
        infoPanel.classList.add('hidden');
        infoButton.setAttribute('aria-expanded', 'false');
      };
      infoButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = !infoPanel.classList.toggle('hidden');
        infoButton.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', (event) => {
        if (infoPanel.classList.contains('hidden') || infoPanel.contains(event.target)) return;
        closeInfo();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !infoPanel.classList.contains('hidden')) closeInfo();
      });
    }
  }

  // MapLibre uses the same public architecture as Radio Garden: globe
  // projection, raster imagery tiles, and markers rendered in the map scene.
  const MAPLIBRE_VERSION = '5.24.0';
  const MAPLIBRE_BASE = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
  const MAPLIBRE_JS_INTEGRITY = 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp';
  const MAPLIBRE_CSS_INTEGRITY = 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK';
  let mapLibrePromise = null;
  let mapLibreGlobePromise = null;

  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibrePromise) return mapLibrePromise;
    if (!document.querySelector('link[data-maplibre]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${MAPLIBRE_BASE}/maplibre-gl.css`;
      link.integrity = MAPLIBRE_CSS_INTEGRITY;
      link.crossOrigin = 'anonymous';
      link.dataset.maplibre = '';
      document.head.appendChild(link);
    }
    mapLibrePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${MAPLIBRE_BASE}/maplibre-gl.js`;
      script.integrity = MAPLIBRE_JS_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => reject(new Error('Failed to load MapLibre GL JS'));
      document.head.appendChild(script);
    }).catch((err) => {
      mapLibrePromise = null;
      throw err;
    });
    return mapLibrePromise;
  }

  async function loadMapLibreGlobe() {
    if (window.__mapLibreGlobe) {
      window.__globe.resumeAnimation();
      return;
    }
    if (mapLibreGlobePromise) return mapLibreGlobePromise;

    mapLibreGlobePromise = (async () => {
      const wrap = $('#globe-wrap');
      const container = $('#globe-3d');
      const tooltip = $('#globe-tooltip');
      const stationsEl = $('#globe-stations');
      wrap.classList.add('is-loading');
      container.innerHTML = '';

      let maplibregl;
      let places;
      try {
        [maplibregl, places] = await Promise.all([loadMapLibre(), getPlaces()]);
      } catch (err) {
        console.error('Failed to load globe:', err);
        wrap.classList.remove('is-loading');
        container.innerHTML = '<div class="empty-state"><p>Failed to load the globe. Please refresh.</p></div>';
        mapLibreGlobePromise = null;
        return;
      }

      const markers = places.filter((place) => Array.isArray(place.geo) && place.geo.length === 2);
      // Custom WebGL layer: Radio Garden-style markers. All 12,326 places
      // render as one instanced draw of camera-facing glowing green dots
      // hugging the satellite surface at a constant screen size. MapLibre's
      // injected shader prelude (projectTileFor3D) places them on the globe
      // or mercator plane, including the projection transition, and clips
      // the back hemisphere. A second on-demand pass renders each dot's id
      // as a color into an offscreen buffer, so hover/click picking is
      // pixel-exact.
      function createMarkerLayer() {
        const quadTemplate = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];

        const INSTANCE_STRIDE = 5;
        const instanceData = new Float32Array(markers.length * INSTANCE_STRIDE);
        markers.forEach((place, index) => {
          const mercator = maplibregl.MercatorCoordinate.fromLngLat(
            { lng: Number(place.geo[0]), lat: Number(place.geo[1]) },
            0,
          );
          const id = index + 1;
          const offset = index * INSTANCE_STRIDE;
          instanceData[offset] = mercator.x;
          instanceData[offset + 1] = mercator.y;
          instanceData[offset + 2] = (id & 255) / 255;
          instanceData[offset + 3] = ((id >> 8) & 255) / 255;
          instanceData[offset + 4] = ((id >> 16) & 255) / 255;
        });

        const PICK_DOWNSCALE = 2;
        const dotFragmentSource = `#version 300 es
precision highp float;
in vec2 v_corner;
flat in vec3 v_pick;
flat in float v_selected;
uniform float u_pick_mode;
out vec4 fragColor;
void main() {
  float dist = length(v_corner);
  if (dist > 1.0) discard;
  // Horizon culling happens in projectTile before this fragment stage. Bias
  // surviving front-hemisphere dots slightly toward the camera so they do not
  // z-fight with the curved satellite surface.
  gl_FragDepth = clamp(gl_FragCoord.z - 0.0015, 0.0, 1.0);
  if (u_pick_mode > 0.5) {
    fragColor = vec4(v_pick, 1.0);
    return;
  }
  // Selected quads are 2.4x larger. Keep their green center at the normal
  // dot size and draw a crisp one-pixel light ring around it.
  float coreDist = dist * mix(1.0, 2.4, v_selected);
  float coreAlpha = 1.0 - smoothstep(0.58, 1.0, coreDist);
  float ringAlpha = v_selected * (1.0 - smoothstep(0.025, 0.09, abs(dist - 0.78)));
  float alpha = max(coreAlpha, ringAlpha);
  vec3 dotColor = mix(vec3(0.55, 1.0, 0.65), vec3(0.05, 0.78, 0.36), smoothstep(0.12, 0.85, coreDist));
  vec3 color = mix(dotColor, vec3(0.91, 0.94, 0.98), ringAlpha);
  fragColor = vec4(color * alpha, alpha);
}`;

        function buildProgram(gl, vertexSource, fragSource, attributeNames) {
          const vertexShader = gl.createShader(gl.VERTEX_SHADER);
          gl.shaderSource(vertexShader, vertexSource);
          gl.compileShader(vertexShader);
          const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
          gl.shaderSource(fragmentShader, fragSource);
          gl.compileShader(fragmentShader);
          const program = gl.createProgram();
          gl.attachShader(program, vertexShader);
          gl.attachShader(program, fragmentShader);
          attributeNames.forEach((name, location) => gl.bindAttribLocation(program, location, name));
          gl.linkProgram(program);
          gl.deleteShader(vertexShader);
          gl.deleteShader(fragmentShader);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Marker layer shader failed to link:', gl.getProgramInfoLog(program));
          }
          const uniforms = {};
          [
            'u_projection_matrix', 'u_projection_fallback_matrix', 'u_projection_tile_mercator_coords',
            'u_projection_clipping_plane', 'u_projection_transition', 'u_pick_mode', 'u_viewport',
            'u_dot_radius', 'u_selected_pick',
          ].forEach((name) => { uniforms[name] = gl.getUniformLocation(program, name); });
          return { program, uniforms };
        }

        return {
          id: 'place-markers',
          type: 'custom',
          renderingMode: '3d',
          programs: new Map(),
          pendingPick: null,
          selectedPick: [0, 0, 0],

          onAdd(mapInstance, gl) {
            this.map = mapInstance;
            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quadTemplate), gl.STATIC_DRAW);
            this.instanceBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
          },

          onRemove(mapInstance, gl) {
            this.programs.forEach((entry) => gl.deleteProgram(entry.program));
            this.programs.clear();
            if (this.dotVao) gl.deleteVertexArray(this.dotVao);
            if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
            if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
            if (this.pickTexture) gl.deleteTexture(this.pickTexture);
            if (this.pickFramebuffer) gl.deleteFramebuffer(this.pickFramebuffer);
          },

          getProgram(gl, shaderData) {
            const cached = this.programs.get(shaderData.variantName);
            if (cached) return cached;
            const dotVertexSource = `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 a_corner;
in vec2 a_center;
in vec3 a_pick;
uniform vec2 u_viewport;
uniform float u_dot_radius;
uniform float u_pick_mode;
uniform vec3 u_selected_pick;
out vec2 v_corner;
flat out vec3 v_pick;
flat out float v_selected;
void main() {
  vec4 anchor = projectTile(a_center);
  float selected = 1.0 - step(0.001, distance(a_pick, u_selected_pick));
  float selectionScale = mix(1.0, 2.4, selected * (1.0 - step(0.5, u_pick_mode)));
  anchor.xy += a_corner * u_dot_radius * selectionScale * 2.0 * anchor.w / u_viewport;
  gl_Position = anchor;
  v_corner = a_corner;
  v_pick = a_pick;
  v_selected = selected;
}`;
            const entry = buildProgram(gl, dotVertexSource, dotFragmentSource, ['a_corner', 'a_center', 'a_pick']);
            this.programs.set(shaderData.variantName, entry);
            return entry;
          },

          getDotVao(gl) {
            if (this.dotVao) return this.dotVao;
            this.dotVao = gl.createVertexArray();
            gl.bindVertexArray(this.dotVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INSTANCE_STRIDE * 4, 0);
            gl.vertexAttribDivisor(1, 1);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 3, gl.FLOAT, false, INSTANCE_STRIDE * 4, 8);
            gl.vertexAttribDivisor(2, 1);
            gl.bindVertexArray(null);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            return this.dotVao;
          },

          drawScene(gl, programEntry, args, pickMode, viewportWidth, viewportHeight) {
            const projection = args.defaultProjectionData;
            const uniforms = programEntry.uniforms;
            const canvas = this.map.getCanvas();
            const pixelScale = viewportWidth / (canvas.clientWidth || viewportWidth);
            gl.useProgram(programEntry.program);
            gl.uniformMatrix4fv(uniforms.u_projection_matrix, false, projection.mainMatrix);
            gl.uniformMatrix4fv(uniforms.u_projection_fallback_matrix, false, projection.fallbackMatrix);
            gl.uniform4f(uniforms.u_projection_tile_mercator_coords, ...projection.tileMercatorCoords);
            gl.uniform4f(uniforms.u_projection_clipping_plane, ...projection.clippingPlane);
            gl.uniform1f(uniforms.u_projection_transition, projection.projectionTransition);
            gl.uniform1f(uniforms.u_pick_mode, pickMode);
            gl.uniform2f(uniforms.u_viewport, viewportWidth, viewportHeight);
            gl.uniform1f(uniforms.u_dot_radius, (pickMode ? 6.5 : 5) * pixelScale);
            gl.uniform3f(uniforms.u_selected_pick, ...this.selectedPick);
            if (pickMode) {
              gl.disable(gl.BLEND);
              gl.disable(gl.DEPTH_TEST);
            } else {
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.enable(gl.DEPTH_TEST);
              gl.depthFunc(gl.LEQUAL);
              gl.depthMask(false);
            }
            gl.bindVertexArray(this.getDotVao(gl));
            gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, markers.length);
            gl.bindVertexArray(null);
            gl.disable(gl.BLEND);
            gl.depthMask(true);
          },

          ensurePickTarget(gl) {
            const width = Math.max(1, Math.floor(gl.drawingBufferWidth / PICK_DOWNSCALE));
            const height = Math.max(1, Math.floor(gl.drawingBufferHeight / PICK_DOWNSCALE));
            if (this.pickFramebuffer && this.pickWidth === width && this.pickHeight === height) return;
            if (this.pickTexture) gl.deleteTexture(this.pickTexture);
            if (this.pickFramebuffer) gl.deleteFramebuffer(this.pickFramebuffer);
            this.pickWidth = width;
            this.pickHeight = height;
            this.pickTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.bindTexture(gl.TEXTURE_2D, null);
            this.pickFramebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          },

          resolvePick(gl, entry, args) {
            const pick = this.pendingPick;
            this.pendingPick = null;
            const canvas = this.map.getCanvas();
            const scaleX = gl.drawingBufferWidth / (canvas.clientWidth || canvas.width);
            const scaleY = gl.drawingBufferHeight / (canvas.clientHeight || canvas.height);
            this.ensurePickTarget(gl);
            const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            const previousViewport = gl.getParameter(gl.VIEWPORT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
            gl.viewport(0, 0, this.pickWidth, this.pickHeight);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this.drawScene(gl, entry, args, 1, this.pickWidth, this.pickHeight);
            const pixelX = Math.min(
              this.pickWidth - 1,
              Math.max(0, Math.round(pick.point.x * scaleX / PICK_DOWNSCALE)),
            );
            const pixelY = Math.min(
              this.pickHeight - 1,
              Math.max(0, this.pickHeight - 1 - Math.round(pick.point.y * scaleY / PICK_DOWNSCALE)),
            );
            const pixel = new Uint8Array(4);
            gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
            gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
            const id = pixel[0] | (pixel[1] << 8) | (pixel[2] << 16);
            let place = id > 0 ? markers[id - 1] || null : null;
            // The pick buffer has no globe depth, so reject hits on the far
            // hemisphere that the visible globe would occlude.
            if (place) {
              const center = this.map.getCenter();
              const centerLatitude = center.lat * Math.PI / 180;
              const placeLatitude = Number(place.geo[1]) * Math.PI / 180;
              const longitudeDelta = (Number(place.geo[0]) - center.lng) * Math.PI / 180;
              const facing = Math.sin(centerLatitude) * Math.sin(placeLatitude)
                + Math.cos(centerLatitude) * Math.cos(placeLatitude) * Math.cos(longitudeDelta);
              if (facing < -0.05) place = null;
            }
            pick.callbacks.forEach((callback) => callback(place));
          },

          render(gl, args) {
            const entry = this.getProgram(gl, args.shaderData);
            gl.disable(gl.CULL_FACE);
            this.drawScene(gl, entry, args, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            if (this.pendingPick) this.resolvePick(gl, entry, args);
          },

          pick(point, callback) {
            if (this.pendingPick) {
              this.pendingPick.point = point;
              this.pendingPick.callbacks.push(callback);
            } else {
              this.pendingPick = { point, callbacks: [callback] };
            }
            if (this.map) this.map.triggerRepaint();
          },

          select(place) {
            const index = place ? markers.indexOf(place) : -1;
            const id = index + 1;
            this.selectedPick = id > 0
              ? [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255]
              : [0, 0, 0];
            if (this.map) this.map.triggerRepaint();
          },
        };
      }
      const markerLayer = createMarkerLayer();
      // Open on a big globe like Radio Garden instead of a distant marble:
      // pick the zoom where the globe spans ~95% of the shorter container
      // edge. Under globe projection the globe's pixel radius is
      // worldSize / (2π · cos(centerLat)) with worldSize = 512 · 2^zoom.
      const GLOBE_CENTER_LAT = 35;
      const fitDiameter =
        0.95 * Math.min(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
      const initialZoom = Math.max(
        1.15,
        Math.log2((fitDiameter * Math.PI * Math.cos((GLOBE_CENTER_LAT * Math.PI) / 180)) / 512),
      );
      const map = new maplibregl.Map({
        container,
        center: [8, GLOBE_CENTER_LAT],
        zoom: initialZoom,
        minZoom: 0,
        maxZoom: 19,
        pitch: 20,
        bearing: 0,
        attributionControl: false,
        doubleClickZoom: false,
        scrollZoom: true,
        reduceMotion: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        canvasContextAttributes: { antialias: true },
        style: {
          version: 8,
          projection: { type: 'globe' },
          sources: {
            satellite: {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              maxzoom: 19,
              attribution: 'Tiles © Esri and imagery contributors',
            },
          },
          layers: [
            { id: 'ocean', type: 'background', paint: { 'background-color': '#071a2c' } },
            { id: 'satellite', type: 'raster', source: 'satellite' },
          ],
          sky: {
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
          },
        },
      });
      map.touchZoomRotate.disableRotation();
      // Passing `padding` to the constructor above has no effect (MapLibre only
      // applies it via camera methods), and pitch shifts the rendered sphere
      // downward relative to its geographic center point on screen. Push the
      // visual center back up by a fraction of the globe's own diameter so it
      // sits centered in the container instead of clipping at the bottom.
      map.setPadding({ top: 0, bottom: fitDiameter * 0.295, left: 0, right: 0 });

      await map.once('load');
      map.addLayer(markerLayer);

      // Render selection inside the same WebGL layer as the marker so the
      // ring shares its exact globe projection, depth, and screen position.
      const selectPlaceMarker = (place) => markerLayer.select(place);

      const totalStations = markers.reduce((total, place) => total + (Number(place.size) || 0), 0);
      $('#globe-stats').textContent = `${markers.length.toLocaleString()} places · ${totalStations.toLocaleString()} stations`;

      let autoRotate = true;
      let running = true;
      let rotateFrame = 0;
      let lastTime = performance.now();
      const rotate = (time) => {
        rotateFrame = 0;
        if (!running || !autoRotate || currentView !== 'globe') return;
        const elapsed = Math.min(40, time - lastTime);
        lastTime = time;
        const center = map.getCenter();
        map.setCenter([center.lng + elapsed * 0.0012, center.lat]);
        rotateFrame = requestAnimationFrame(rotate);
      };
      const stopAutoRotate = () => {
        autoRotate = false;
        if (rotateFrame) cancelAnimationFrame(rotateFrame);
        rotateFrame = 0;
      };
      container.addEventListener('pointerdown', stopAutoRotate);

      // Asymmetric wheel zoom: zooming in stays on MapLibre's native scroll
      // handler, which anchors on the cursor even under globe projection, so
      // you dive toward the place beneath the pointer. Zooming out is
      // intercepted in the capture phase (before MapLibre sees it) and eased
      // around the screen center instead — cursor-anchored zoom-out makes the
      // whole globe orbit the pointer, which reads as the globe swinging away.
      container.addEventListener('wheel', (event) => {
        stopAutoRotate();
        if (event.deltaY <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        const lineScale = event.deltaMode === 1 ? 20 : 1;
        const rate = event.ctrlKey ? 0.008 : 0.0022;
        const delta = -event.deltaY * lineScale * rate;
        const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta));
        map.easeTo({ zoom, duration: 90, easing: (t) => t });
      }, { passive: false, capture: true });

      map.on('mousemove', (event) => {
        const point = event.point;
        markerLayer.pick(point, (place) => {
          map.getCanvas().style.cursor = place ? 'pointer' : '';
          if (!place) {
            tooltip.classList.add('hidden');
            return;
          }
          tooltip.textContent = `${place.title}, ${place.country} · ${place.size} station${place.size === 1 ? '' : 's'}`;
          tooltip.style.left = `${point.x + 14}px`;
          tooltip.style.top = `${point.y - 10}px`;
          tooltip.classList.remove('hidden');
        });
      });
      map.on('mouseout', () => {
        map.getCanvas().style.cursor = '';
        tooltip.classList.add('hidden');
      });
      const globeView = $('#view-globe');
      const stationPanelIsStacked = () => window.matchMedia('(max-width: 768px)').matches;

      // Keep the chosen city framed while the station browser opens beside the
      // globe. Resizing first matters on desktop because the side panel changes
      // the map's viewport width.
      const focusPlace = (place, options = {}) => {
        const duration = options.duration ?? 900;
        const zoom = options.zoom ?? Math.max(5, Math.min(7, map.getZoom()));
        stopAutoRotate();
        requestAnimationFrame(() => {
          map.resize();
          map.flyTo({
            center: place.geo,
            zoom,
            pitch: 20,
            duration,
          });
        });
      };

      const openPlaceStations = (place, options = {}) => {
        selectPlaceMarker(options.markLocation ? place : null);
        globeView.classList.add('has-stations');
        stationsEl.classList.remove('hidden');
        stationsEl.innerHTML = '<div class="loading-placeholder"><div class="loader" aria-label="Loading stations"></div></div>';
        focusPlace(place, options.markLocation ? {
          zoom: Math.max(8, Math.min(10, map.getZoom())),
        } : {});
        showPlaceStations(place, stationsEl, 'Close', () => {
          globeView.classList.remove('has-stations');
          // Once the map expands again, resize and re-center it on the city the
          // listener just browsed instead of returning to a generic globe view.
          focusPlace(place, { duration: 500 });
        }, {
          scroll: stationPanelIsStacked(),
          onStationSelect: () => {
            selectPlaceMarker(place);
            focusPlace(place, {
              duration: 700,
              zoom: Math.max(8, Math.min(10, map.getZoom())),
            });
          },
        });
      };
      openGlobePlace = openPlaceStations;

      map.on('click', (event) => {
        markerLayer.pick(event.point, (place) => {
          if (!place) return;
          openPlaceStations(place);
        });
      });

      await Promise.race([
        map.once('idle'),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      wrap.classList.remove('is-loading');

      function zoomBy(delta) {
        stopAutoRotate();
        map.stop();
        const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta));
        map.jumpTo({ zoom });
      }
      $('#globe-zoom-in').addEventListener('click', () => zoomBy(1));
      $('#globe-zoom-out').addEventListener('click', () => zoomBy(-1));

      window.__globe = {
        pauseAnimation() {
          running = false;
          if (rotateFrame) cancelAnimationFrame(rotateFrame);
          rotateFrame = 0;
          map.stop();
        },
        resumeAnimation() {
          running = true;
          lastTime = performance.now();
          map.resize();
          map.triggerRepaint();
          if (autoRotate && !rotateFrame) rotateFrame = requestAnimationFrame(rotate);
        },
      };
      window.__mapLibreGlobe = map;
      refreshGlobeMarkers = () => map.triggerRepaint();
      if (currentView === 'globe') rotateFrame = requestAnimationFrame(rotate);
      else window.__globe.pauseAnimation();
    })();
    return mapLibreGlobePromise;
  }

  // ===== Shared: station list for a place =====
  const placeStationRequests = new WeakMap();

  async function showPlaceStations(place, stationsEl, backLabel, onBack, options = {}) {
    const requestToken = {};
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wasVisible = !stationsEl.classList.contains('hidden')
      && stationsEl.classList.contains('is-visible');
    placeStationRequests.set(stationsEl, requestToken);
    stationsEl.setAttribute('aria-busy', 'true');

    let stations = [];
    let loadError = null;
    try {
      stations = await getPlaceStations(place.id);
    } catch (err) {
      loadError = err;
    }
    if (placeStationRequests.get(stationsEl) !== requestToken) return;

    stationsEl.classList.remove('hidden', 'is-loading', 'is-ready');
    stationsEl.classList.add('place-stations-panel');
    if (!wasVisible) stationsEl.classList.remove('is-visible');
    const count = stations.length;
    stationsEl.innerHTML = `
      <header class="place-stations-header">
        <div class="place-heading">
          <span class="place-kicker">${escapeHtml(place.country)}</span>
          <h2 class="place-title">${escapeHtml(place.title)}</h2>
          <p class="place-count">${count} station${count === 1 ? '' : 's'} on air</p>
        </div>
        <button class="back-btn icon-btn" type="button" aria-label="${escapeAttr(backLabel)}" title="${escapeAttr(backLabel)}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>
      <div class="place-stations-results stations-list" aria-live="polite"></div>`;

    const results = stationsEl.querySelector('.place-stations-results');
    if (loadError) {
      console.error('Failed to load place stations:', loadError);
      results.innerHTML = `
        <div class="empty-state">
          <p>Failed to load stations. Please try again.</p>
          <span>Check your internet connection and try again</span>
        </div>`;
    } else if (stations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<p>No stations in this place</p>';
      results.appendChild(empty);
    } else {
      appendStationCards(results, stations, undefined, {
        onSelect: options.onStationSelect,
        showOnGlobe: options.showOnGlobe === true,
      });
    }
    stationsEl.setAttribute('aria-busy', 'false');


    stationsEl.querySelector('.back-btn').addEventListener('click', () => {
      const closeToken = {};
      placeStationRequests.set(stationsEl, closeToken);
      stationsEl.classList.remove('is-visible');

      const finishClose = () => {
        if (placeStationRequests.get(stationsEl) !== closeToken) return;
        stationsEl.classList.add('hidden');
        stationsEl.classList.remove('place-stations-panel', 'is-visible');
        stationsEl.removeAttribute('aria-busy');
        stationsEl.innerHTML = '';
        onBack();
      };

      if (reducedMotion) finishClose();
      else setTimeout(finishClose, 240);
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (placeStationRequests.get(stationsEl) !== requestToken) return;
        stationsEl.classList.add('is-visible');
        if (options.scroll) {
          stationsEl.scrollIntoView({
            behavior: reducedMotion ? 'auto' : 'smooth',
            block: 'start',
          });
        }
      });
    });
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

    if (activeOverlay === 'favorites') {
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
    $$(`.btn-fav[data-id="${CSS.escape(String(id))}"]`).forEach((btn) => {
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
    const favList = Object.values(favorites);

    if (favList.length === 0) {
      favoritesList.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <p>No favorites yet</p>
          <span>Tap the heart on any station and it will wait for you here.</span>
        </div>`;
      return;
    }

    favoritesList.innerHTML = '';
    appendStationCards(favoritesList, favList);
  }

  // ===== Render Station Rows =====
  // Rows live inside panels now, so the play target is a real <button>: the
  // whole list is reachable and operable from the keyboard.
  function appendStationCards(container, stations, fullList, options = {}) {
    const frag = document.createDocumentFragment();
    // fullList is the complete list (for prev/next beyond what's rendered)
    const playableList = fullList || stations;
    const offset = Number(options.startIndex) || 0;

    stations.forEach((station, i) => {
      const row = document.createElement('div');
      row.className = 'station-row';
      if (currentStation && currentStation.id === station.id && isPlaying) {
        row.classList.add('playing');
      }
      row.dataset.id = station.id;

      const where = [station.place, station.country].filter(Boolean).join(' · ');
      const fav = isFavorite(station.id);
      const ordinal = String(offset + i + 1).padStart(2, '0');
      const showGlobe = options.showOnGlobe !== false && (station.placeId || station.place);

      row.innerHTML = `
        <button class="station-main" type="button" title="${escapeAttr(station.name)}">
          <span class="station-index" aria-hidden="true">${ordinal}</span>
          <span class="station-cue" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </span>
          <span class="station-body">
            <span class="station-name">${escapeHtml(station.name)}</span>
            <span class="station-where">${escapeHtml(where)}</span>
          </span>
          <span class="now-playing-indicator" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </span>
        </button>
        <div class="station-actions">
          ${showGlobe ? `
            <button class="btn-globe" type="button" aria-label="Show ${escapeAttr(station.place || 'station')} on globe" title="Show on globe">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </button>` : ''}
          <button class="btn-fav ${fav ? 'active' : ''}" type="button" data-id="${escapeAttr(station.id)}" aria-label="Toggle favorite" title="Toggle favorite">
            ${
              fav
                ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
                : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
            }
          </button>
        </div>`;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav')) {
          toggleFavorite(station);
          return;
        }

        currentList = playableList;
        currentIndex = playableList.findIndex((s) => s.id === station.id);

        const globeButton = e.target.closest('.btn-globe');
        if (globeButton) {
          // Navigating an already-playing station must not reload its stream.
          if (!currentStation || currentStation.id !== station.id || (!isPlaying && !isLoading)) {
            playStation(station);
          }
          globeButton.disabled = true;
          globeButton.setAttribute('aria-busy', 'true');
          showStationOnGlobe(station)
            .catch((err) => {
              console.error('Failed to open station on globe:', err);
              showToast('The globe could not be loaded. Please try again.');
            })
            .finally(() => {
              globeButton.disabled = false;
              globeButton.removeAttribute('aria-busy');
            });
          return;
        }

        playStation(station);
        if (options.onSelect) options.onSelect(station);
      });

      frag.appendChild(row);
    });

    container.appendChild(frag);
  }

  // ===== Audio Player =====
  let retryCount = 0;
  let triedSnapshotStream = false;
  const MAX_RETRIES = 2;
  let waveAnimationFrame = 0;
  const waveContext = playerWave ? playerWave.getContext('2d') : null;
  const reducedWaveMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function drawPlayerWave(timestamp = 0) {
    if (!waveContext || !playerWave) return;

    const width = playerWave.clientWidth || 120;
    const height = playerWave.clientHeight || 36;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (playerWave.width !== pixelWidth || playerWave.height !== pixelHeight) {
      playerWave.width = pixelWidth;
      playerWave.height = pixelHeight;
    }
    waveContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    waveContext.clearRect(0, 0, width, height);

    const centers = [height * 0.2, height * 0.5, height * 0.8];
    const cycles = [1.35, 1.7, 2.05];
    const speeds = [1.15, -0.9, 0.7];
    const amplitudes = [height * 0.105, height * 0.09, height * 0.075];
    const opacities = [0.92, 0.72, 0.5];
    const elapsed = timestamp * 0.001;

    waveContext.lineCap = 'round';
    waveContext.lineJoin = 'round';
    for (let line = 0; line < 3; line++) {
      const phase = elapsed * speeds[line];

      waveContext.beginPath();
      waveContext.lineWidth = 1.35;
      waveContext.globalAlpha = opacities[line];
      waveContext.strokeStyle = '#ffffff';
      waveContext.shadowColor = 'rgba(255, 255, 255, 0.55)';
      waveContext.shadowBlur = isPlaying ? 4 : 0;
      for (let x = 0; x <= width; x += 1.5) {
        const progress = x / width;
        const envelope = Math.pow(Math.sin(Math.PI * progress), 0.7);
        const primary = Math.sin(progress * Math.PI * 2 * cycles[line] + phase);
        const detail = Math.sin(progress * Math.PI * 2 * (cycles[line] * 2.35) - phase * 0.65)
          * 0.18;
        const y = centers[line]
          + (primary + detail) * amplitudes[line] * envelope;
        if (x === 0) waveContext.moveTo(x, y);
        else waveContext.lineTo(x, y);
      }
      waveContext.stroke();
    }
    waveContext.globalAlpha = 1;
    waveContext.shadowBlur = 0;
  }

  function animatePlayerWave(timestamp) {
    waveAnimationFrame = 0;
    drawPlayerWave(timestamp);
    if (isPlaying && !reducedWaveMotion) {
      waveAnimationFrame = requestAnimationFrame(animatePlayerWave);
    }
  }

  function startPlayerWave() {
    if (!waveAnimationFrame) {
      waveAnimationFrame = requestAnimationFrame(animatePlayerWave);
    }
  }

  function stopPlayerWave() {
    if (waveAnimationFrame) cancelAnimationFrame(waveAnimationFrame);
    waveAnimationFrame = 0;
    drawPlayerWave();
  }

  function playStation(station) {
    currentStation = station;
    isLoading = true;
    isPlaying = false;
    retryCount = 0;
    triedSnapshotStream = false;
    updatePlayerUI();

    playerBar.classList.remove('hidden');

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
    playerBar.classList.toggle('is-playing', isPlaying);
    playerBar.classList.toggle('is-loading', isLoading);
    btnPlay.setAttribute('aria-label', isLoading ? 'Loading station' : isPlaying ? 'Pause' : 'Play');

    updatePlayerFavButton();

    $$('.station-row').forEach((row) => {
      row.classList.toggle('playing', row.dataset.id === currentStation.id && isPlaying);
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
    startPlayerWave();
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    isLoading = false;
    updatePlayerUI();
    stopPlayerWave();
  });

  audio.addEventListener('waiting', () => {
    isLoading = true;
    updatePlayerUI();
    stopPlayerWave();
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
          attemptPlay(proxiedStreamUrl(saved.streamUrl));
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
    volumeSlider.style.setProperty('--volume-level', `${vol}%`);
  }

  function setVolume(val) {
    audio.volume = val / 100;
    localStorage.setItem(VOL_KEY, val);
    volumeSlider.style.setProperty('--volume-level', `${val}%`);
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
    volumeSlider.style.setProperty('--volume-level', `${volumeSlider.value}%`);
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

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    searchTrigger.addEventListener('click', () => openPalette());
    btnSurprise.addEventListener('click', surpriseMe);
    btnFavorites.addEventListener('click', toggleFavoritesPanel);
    $('#favorites-close').addEventListener('click', closeFavorites);
    $('#palette-close').addEventListener('click', closePalette);
    scrim.addEventListener('click', closeOverlay);

    paletteInput.addEventListener('input', (e) => runPalette(e.target.value));

    paletteInput.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          movePaletteSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          movePaletteSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          choosePalette();
          break;
        case 'Escape':
          e.preventDefault();
          closePalette();
          break;
      }
    });

    paletteResults.addEventListener('click', (e) => {
      const row = e.target.closest('.palette-row');
      if (row) choosePalette(Number(row.dataset.idx));
    });

    paletteResults.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.palette-row');
      if (!row) return;
      const idx = Number(row.dataset.idx);
      if (idx === paletteIndex) return;
      paletteIndex = idx;
      paletteResults.querySelectorAll('.palette-row').forEach((el) => {
        const active = Number(el.dataset.idx) === paletteIndex;
        el.classList.toggle('active', active);
        el.setAttribute('aria-selected', String(active));
      });
    });

    btnPlay.addEventListener('click', togglePlayPause);
    btnPrev.addEventListener('click', playPrev);
    btnNext.addEventListener('click', playNext);
    btnFavPlayer.addEventListener('click', () => {
      if (currentStation) toggleFavorite(currentStation);
    });

    // Find the station you are hearing on the globe.
    btnLocate.addEventListener('click', () => {
      if (!currentStation) return;
      btnLocate.disabled = true;
      showStationOnGlobe(currentStation)
        .catch((err) => {
          console.error('Failed to locate station:', err);
          showToast('The globe could not be loaded. Please try again.');
        })
        .finally(() => {
          btnLocate.disabled = false;
        });
    });

    volumeSlider.addEventListener('input', (e) => setVolume(e.target.value));
    btnMute.addEventListener('click', toggleMute);

    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd+K opens search from anywhere, including from inside a field.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (activeOverlay === 'palette') closePalette();
        else openPalette();
        return;
      }

      if (e.key === 'Escape') {
        closeOverlay();
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;

      switch (e.key) {
        case ' ':
          // Never steal Space from a focused control: it activates buttons.
          if (e.target.closest('button')) return;
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
          volumeSlider.value = Math.min(100, parseInt(volumeSlider.value, 10) + 5);
          setVolume(volumeSlider.value);
          break;
        case 'ArrowDown':
          e.preventDefault();
          volumeSlider.value = Math.max(0, parseInt(volumeSlider.value, 10) - 5);
          setVolume(volumeSlider.value);
          break;
        case 'm':
          toggleMute();
          break;
        case '/':
          e.preventDefault();
          openPalette();
          break;
        case 's':
          surpriseMe();
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
