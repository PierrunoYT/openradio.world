# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and topic
rather than by version number. Newest first.

---

## 2026-07-15 — CORS-safe API access

### Fixed

- **Same-origin API proxy** — deployed JSON requests for places, channels, and
  search now pass through a restricted Cloudflare Pages Function instead of
  calling Radio Garden directly from the browser, avoiding blocked CORS
  responses without exposing an open proxy.
- **Clean local development** — plain-HTTP development servers use the bundled
  places and stations snapshots immediately, avoiding repeated failed live API
  requests and console errors.

---

## 2026-07-15 — Globe

### Changed

- **MapLibre globe renderer** — the globe now uses MapLibre GL JS with
  `projection: "globe"`, matching Radio Garden's current public architecture.
- **High-resolution satellite Earth** — Esri World Imagery is loaded as a
  level-of-detail tile pyramid up to level 19, so finer imagery streams in as
  the camera approaches instead of stretching one global image.
- **High-visibility place markers** — all 12,326 places are rendered in native
  MapLibre GeoJSON circle layers with compact station-weighted sizes, a bright
  outline, and a soft glow that remains legible over satellite imagery.
- **Extruded marker columns** — every place now has a slim octagonal MapLibre
  fill extrusion rising clearly above the globe, with shaded walls and
  station-weighted height. Balanced footprints keep them prominent without
  returning to the oversized block look, while ground circles fade cleanly.
- **Forgiving marker interaction** — rendered-feature picking uses a 12-pixel
  tolerance around the pointer, making even small and densely packed places
  easier to hover and select while remaining aligned with the globe.
- **Synchronized loading** — the loader remains visible until initial imagery
  tiles and station points have rendered together.
- **Cursor-anchored globe zoom** — wheel input uses MapLibre's native
  screen-space anchor so the location beneath the pointer stays in place,
  while the buttons move one level immediately. Zoom levels 0 through 19 match
  the satellite imagery.
- **Readable attribution** — Esri imagery credits now use a high-contrast dark
  control with light text and links.
- **Lower background cost** — animation stops whenever another app view is
  open, and render resolution is capped on high-DPI screens.
- **Faster first open** — MapLibre warms during browser idle time, while the
  globe still loads only the places snapshot rather than the station catalog.

### Fixed

- **Reliable marker startup** — the place source and marker layers are loaded
  with the initial MapLibre style, preventing missing-layer interaction errors.
- **Globe-only marker picking** — hover and click candidates must be on the
  visible hemisphere and within 12 screen pixels of their exact projected
  coordinates, preventing location tooltips from appearing outside the globe.
- **Versioned marker style assets** — the application script URL is versioned
  so cached copies of an older invalid marker expression are not reused after
  a globe deployment.
- **Smaller place circles** — marker and glow radii are half their previous
  size, reducing overlap without shrinking their forgiving interaction area.
- **Stable station loading** — station data now loads before the results panel
  opens, with existing results left in place during updates. Removing the
  forced loading modal prevents the page from shifting between temporary and
  final content heights.
- **Polished imagery credit** — the Esri attribution now uses a compact glass
  pill with clean spacing and responsive sizing instead of an overlapping info
  toggle and text box.
- **Stable globe viewport** — opening station results no longer shrinks or
  resizes the map; result cards flow below its fixed desktop or mobile height.
- **Natural single-station cards** — the completed results grid no longer
  inherits the loading panel's height, so a lone station keeps normal card
  proportions instead of stretching into a large block.
- **Results bottom spacing** — the globe station panel now leaves breathing
  room below its final card instead of ending flush against the scroll edge.

### Added

- **Globe view** — an interactive 3D globe in the style of radio.garden as
  a new sidebar entry: drag to spin, scroll or use the +/−
  buttons to zoom, hover a city for its name and station count, click a
  city to list and play its stations. A live badge shows the loaded place and
  station totals, and the globe slowly rotates until touched.

---

## 2026-07-15 — Streams on HTTPS

### Added

- **Mixed-content stream proxy** — a Cloudflare Pages Function at `/listen`
  pipes plain-`http://` radio streams through the site's own HTTPS origin,
  so the ~4,000 stations with insecure streams play on the deployed site
  instead of being blocked by the browser. The player routes insecure
  streams through it automatically; on plain-HTTP local development nothing
  is proxied.
- The proxy only accepts Radio Garden station ids or stream hosts present
  in the crawled snapshot (`data/stream-hosts.json`), so it cannot be
  abused as an open proxy.

---

## 2026-07-15 — Offline resilience

### Added

- **Full directory snapshot** — `tools/snapshot.mjs`, a resumable crawler
  that archives every place (12,326) and station (38,103) including each
  station's resolved direct stream URL into `data/`. The direct URLs point
  at the broadcasters themselves, not Radio Garden.
- **Automatic snapshot fallback** — if the live API is unreachable (e.g.
  ever locked down), browsing, search, and playback transparently switch to
  the local snapshot, with a one-time notice. Playback even falls back to
  the snapshot's direct stream URL if the live redirect endpoint fails
  mid-session.

---

## 2026-07-15 — Site launch

### Added

- Deployed to Cloudflare Pages and connected the custom domain
  **openradio.world** (registered at hosttech, DNS on Cloudflare).
- Private GitHub repository `PierrunoYT/openradio.world`.

### Changed

- README rewritten for the new project identity; open-source wording
  removed while the repository is private (the MIT license file remains,
  ready for a future public release).

---

## 2026-07-15 — New backend: Radio Garden

### Changed

- **Rebuilt the app on the (unofficial) Radio Garden API**, replacing the
  Radio Browser backend of the predecessor project. Stations are now
  organized geographically, matching the radio.garden globe:
  - **Discover** shows stations from a rotating selection of featured
    cities, different on every visit.
  - **Search** queries Radio Garden stations and places.
  - **Browse by Country** drills down country → city → stations.
  - **Browse by City** lists all places sorted by station count, with
    Load More paging.
  - Playback goes through Radio Garden's `listen` endpoint, which always
    redirects to the station's current stream URL.

### Added

- Automatic migration of favorites saved by the earlier Radio Browser-based
  app — they keep playing through their stored stream URLs.

### Removed

- Browse by Genre and Browse by Language (Radio Garden has no genre or
  language data), and station bitrate/codec/artwork display.

### Carried over

- Favorites (localStorage), full audio player with previous/next, volume
  and mute, Media Session integration (lock-screen/OS controls), keyboard
  shortcuts, responsive dark theme, and the no-build-step architecture.
