# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and topic
rather than by version number. Newest first.

---

## 2026-07-15 — Globe

### Changed

- **MapLibre globe renderer** — the globe now uses MapLibre GL JS with
  `projection: "globe"`, matching Radio Garden's current public architecture.
- **High-resolution satellite Earth** — Esri World Imagery is loaded as a
  level-of-detail tile pyramid up to level 19, so finer imagery streams in as
  the camera approaches instead of stretching one global image.
- **Radio Garden-style place markers** — all 12,326 places are rendered in a
  native MapLibre GeoJSON circle layer with station-weighted sizes.
- **Accurate interaction** — markers and Earth share MapLibre's projection,
  so native rendered-feature picking stays aligned at every zoom.
- **Synchronized loading** — the loader remains visible until initial imagery
  tiles and station points have rendered together.
- **Expanded zoom range** — wheel, pinch, and button zoom use MapLibre levels
  0 through 19, matching the available satellite imagery detail.
- **Lower background cost** — animation stops whenever another app view is
  open, and render resolution is capped on high-DPI screens.
- **Faster first open** — MapLibre warms during browser idle time, while the
  globe still loads only the places snapshot rather than the station catalog.

### Added

- **Globe view** — an interactive 3D globe in the style of radio.garden as
  a new sidebar entry: drag to spin, scroll or use the +/−
  buttons to zoom, hover a city for its name and station count, click a
  city to list and play its stations. A live badge shows the loaded place and
  station totals, featured cities render as larger dots, and the globe slowly
  rotates until touched.

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
