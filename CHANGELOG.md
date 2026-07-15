# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and topic
rather than by version number. Newest first.

---

## 2026-07-15 — Globe

### Changed

- **Radio Garden-style place markers** — the complete directory of 12,326
  places is represented by bright green, screen-space dots that stay crisp
  and visible at every distance. Geographic level-of-detail clustering keeps
  the world view readable and progressively reveals every place while
  zooming; marker size reflects the number of nearby stations.
- **Fast marker rendering** — city points moved from thousands of 3D
  cylinders to one lightweight canvas pass over the WebGL earth. Only
  front-facing markers are projected, globe.gl's expensive pointer raycasting
  remains disabled, and hover/click use a sphere hit plus nearest-place lookup.
- **Blue Marble globe** — the current earth uses locally served 4K NASA Blue
  Marble imagery, a 2K topology bump map, and an atmosphere glow. This
  supersedes the earlier same-day CPU-textured and Natural Earth vector
  iterations while retaining smooth GPU interaction.
- **Lower background cost** — render resolution is capped on high-DPI
  screens, the high-performance GPU is requested, and the globe animation
  pauses whenever another app view is open.
- **Faster first and offline open** — globe code and textures warm during
  browser idle time. If the live API is unavailable, the globe now loads only
  the places snapshot instead of also parsing the 10 MB station catalog.

### Added

- **Globe view** — an interactive 3D globe in the style of radio.garden as
  a new sidebar entry: drag to spin (with inertia), scroll or use the +/−
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
