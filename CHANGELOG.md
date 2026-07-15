# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and topic
rather than by version number. Newest first.

---

## 2026-07-15 — Globe

### Changed

- **Faster first globe open** — globe code and country geometry now warm in
  browser idle time, the user sees a loading indicator when needed, and the
  rendered country mesh uses a display-optimized copy with roughly 75% fewer
  boundary vertices while retaining the full-resolution source data.
- **Vector globe** — the globe now renders country shapes from Natural Earth
  vector data (50m resolution) on a dark stylized sphere with an atmosphere
  glow, instead of a satellite photo texture. Vector shapes stay razor sharp
  at every zoom level, which fixed the pixelation when zooming in close.
- **City points scale with zoom** — the 12,000+ city dots shrink as the
  camera gets closer, so a zoomed-in view shows fine dots instead of fat
  cylinders, with a size floor so they never vanish. The merged point
  geometry rebuilds debounced to keep zooming smooth.
- **Smoother interaction** — globe.gl's built-in pointer raycasting (which
  tested the whole tessellated country geometry on every mouse move) is
  disabled; hover and click are resolved with a single cheap ray-vs-sphere
  test plus a nearest-city lookup. Render resolution is capped on very
  high-DPI screens and the renderer requests the high-performance GPU.
- **GPU rendering** — the globe runs on WebGL via a vendored copy of
  [globe.gl](https://github.com/vasturiano/globe.gl) (MIT, three.js bundled,
  loaded lazily the first time the view opens). This replaced two earlier
  same-day iterations that rendered on the CPU 2D canvas (first city dots
  only, then a per-pixel projected NASA texture) and stuttered while
  dragging and zooming.

### Added

- **Globe view** — an interactive 3D globe in the style of radio.garden as
  a new sidebar entry: drag to spin (with inertia), scroll or use the +/−
  buttons to zoom, hover a city for its name and station count, click a
  city to list and play its stations. Featured cities render as larger
  dots; the globe slowly rotates until touched.

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
