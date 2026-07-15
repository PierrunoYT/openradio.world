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
  let placesPromise = null;
  let refreshGlobeMarkers = null;

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

    // Warm the globe library and vector country geometry once the initial view
    // has settled so opening the globe does not start those downloads.
    const warmGlobe = () => loadMapLibre().catch(() => {
      // Opening the Globe view retries and displays an error if loading fails.
    });
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warmGlobe, { timeout: 2000 });
    } else {
      setTimeout(warmGlobe, 1200);
    }
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
        if (!snapshotNotified) {
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

    // Pause the GPU render loop whenever the globe is not visible.
    if (window.__globe) {
      if (view === 'globe') window.__globe.resumeAnimation();
      else window.__globe.pauseAnimation();
    }

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
        loadMapLibreGlobe();
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
        showPlaceStations(hit, stationsEl, 'Back to Globe', () => {
          stationsEl.classList.add('hidden');
        });
        stationsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // MapLibre uses the same public architecture as Radio Garden: globe
  // projection, raster imagery tiles, and markers rendered in the map scene.
  const MAPLIBRE_VERSION = '5.24.0';
  const MAPLIBRE_BASE = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
  let mapLibrePromise = null;
  let mapLibreGlobePromise = null;

  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibrePromise) return mapLibrePromise;
    if (!document.querySelector('link[data-maplibre]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${MAPLIBRE_BASE}/maplibre-gl.css`;
      link.dataset.maplibre = '';
      document.head.appendChild(link);
    }
    mapLibrePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${MAPLIBRE_BASE}/maplibre-gl.js`;
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
      const byId = new Map(markers.map((place) => [place.id, place]));
      const markerData = {
        type: 'FeatureCollection',
        features: markers.map((place) => ({
          type: 'Feature',
          id: place.id,
          properties: {
            id: place.id,
            size: Number(place.size) || 0,
            boost: place.boost ? 1 : 0,
          },
          geometry: { type: 'Point', coordinates: place.geo },
        })),
      };
      const markerRadius = [
        'interpolate', ['linear'], ['zoom'],
        0, ['+', 5, ['*', 0.55, ['ln', ['+', 1, ['get', 'size']]]]],
        5, ['+', 7, ['*', 0.75, ['ln', ['+', 1, ['get', 'size']]]]],
        12, ['+', 10, ['*', 0.9, ['ln', ['+', 1, ['get', 'size']]]]],
      ];
      const markerGlowRadius = [
        'interpolate', ['linear'], ['zoom'],
        0, ['+', 11, ['*', 0.55, ['ln', ['+', 1, ['get', 'size']]]]],
        5, ['+', 13, ['*', 0.75, ['ln', ['+', 1, ['get', 'size']]]]],
        12, ['+', 16, ['*', 0.9, ['ln', ['+', 1, ['get', 'size']]]]],
      ];
      const map = new maplibregl.Map({
        container,
        center: [8, 35],
        zoom: 1.15,
        minZoom: 0,
        maxZoom: 19,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        doubleClickZoom: false,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
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
            places: {
              type: 'geojson',
              data: markerData,
            },
          },
          layers: [
            { id: 'ocean', type: 'background', paint: { 'background-color': '#071a2c' } },
            { id: 'satellite', type: 'raster', source: 'satellite' },
            {
              id: 'places-glow',
              type: 'circle',
              source: 'places',
              paint: {
                'circle-color': '#43f58d',
                'circle-radius': markerGlowRadius,
                'circle-opacity': 0.42,
                'circle-blur': 0.75,
              },
            },
            {
              id: 'places',
              type: 'circle',
              source: 'places',
              paint: {
                'circle-color': '#55f59a',
                'circle-stroke-color': '#effff5',
                'circle-stroke-width': 1.5,
                'circle-radius': markerRadius,
                'circle-opacity': 1,
              },
            },
          ],
          sky: {
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
          },
        },
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
      map.touchZoomRotate.disableRotation();

      await map.once('load');

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
      container.addEventListener('wheel', stopAutoRotate, { passive: true });

      function placeFromFeature(feature) {
        return feature ? byId.get(feature.properties.id) : null;
      }
      function featureNear(point) {
        if (!map.getLayer('places')) return null;
        const hitRadius = 12;
        return map.queryRenderedFeatures([
          [point.x - hitRadius, point.y - hitRadius],
          [point.x + hitRadius, point.y + hitRadius],
        ], { layers: ['places'] })[0] || null;
      }
      map.on('mousemove', (event) => {
        const feature = featureNear(event.point);
        const place = placeFromFeature(feature);
        map.getCanvas().style.cursor = place ? 'pointer' : '';
        if (!place) {
          tooltip.classList.add('hidden');
          return;
        }
        tooltip.textContent = `${place.title}, ${place.country} · ${place.size} station${place.size === 1 ? '' : 's'}`;
        tooltip.style.left = `${event.point.x + 14}px`;
        tooltip.style.top = `${event.point.y - 10}px`;
        tooltip.classList.remove('hidden');
      });
      map.on('mouseout', () => {
        map.getCanvas().style.cursor = '';
        tooltip.classList.add('hidden');
      });
      map.on('click', (event) => {
        const place = placeFromFeature(featureNear(event.point));
        if (!place) return;
        showPlaceStations(place, stationsEl, 'Back to Globe', () => {
          stationsEl.classList.add('hidden');
        });
        stationsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      await Promise.race([
        map.once('idle'),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      wrap.classList.remove('is-loading');

      function zoomBy(delta) {
        stopAutoRotate();
        map.easeTo({ zoom: Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta)), duration: 250 });
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
