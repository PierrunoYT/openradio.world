# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and topic
rather than by version number. Newest first.

---

## 2026-07-15 — Globe

### Changed

- **Reliable globe.gl renderer** — the globe uses a locally vendored release
  of the established globe.gl WebGL library instead of a custom globe engine.
- **High-resolution vector Earth** — the full Natural Earth country dataset
  is rendered as GPU-accelerated globe.gl polygons, keeping coastlines and
  borders sharp at every zoom level without a stretched raster Earth image.
- **Radio Garden-style place markers** — all 12,326 places are represented by
  bright screen-space points. Geographic level-of-detail clustering keeps the
  world view readable and progressively reveals every place while zooming.
- **Fast rendering and interaction** — the Earth stays on the GPU while city
  markers are drawn in one Canvas overlay. Expensive scene raycasting remains
  disabled, and hover/click use a screen-space marker index with
  animation-frame throttling.
- **Synchronized markers** — the globe and its first marker frame are revealed
  together after the vector Earth is ready, preventing the globe from
  appearing before its green place dots.
- **Accurate marker selection** — dots and hit testing now use the same surface
  projection and screen-space marker index, so hover and clicks stay aligned
  with the visible green dots at close zoom and clustered world views.
- **Expanded zoom range** — wheel, pinch, and button zoom now share an
  altitude range of `0.02` to `12`, allowing near-surface detail and a much
  farther world view without the previous camera restriction.
- **Lower background cost** — animation stops whenever another app view is
  open, and render resolution is capped on high-DPI screens.
- **Faster first and offline open** — the library and local country geometry
  warm during browser idle time, and offline globe loading only needs the
  places snapshot rather than the full station catalog.

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
