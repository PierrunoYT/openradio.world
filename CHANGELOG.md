# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and sorted by
commit order rather than by version number. Newest change first.

---

## 2026-07-15

- **Globe info button** — a round "!" button in the globe's bottom-left
  corner opens a glass info panel with usage hints (drag to spin, zoom
  dives toward the cursor, click a dot to tune in) and the imagery and
  station data credits. Closes on outside click or Escape.
- **Removed the imagery credit pill** — the Esri attribution control no
  longer overlays the globe's bottom-left corner; its credit moved into
  the info panel.
- **Solid globe again** — the green dots briefly rendered without depth
  testing, so far-side cities showed through the planet and drifted like a
  floating layer while zooming. Dots are depth-tested against the globe
  surface again (with a small bias so ground-hugging dots aren't swallowed
  by the curvature), and picking rejects far-hemisphere hits.
- **Radio Garden-style green dot markers** — the pink 3D spikes are replaced
  by the look the app was always chasing: flat, uniform, glowing green dots
  hugging the satellite surface at a constant screen size, matching
  radio.garden. The custom WebGL layer now draws a single instanced pass of
  camera-facing dots at ground level (no prisms, no depth pass), keeping the
  pixel-exact id-buffer picking. Verified in a headless browser: dots render
  across the whole visible hemisphere and hovering one shows its place
  tooltip.
- **Working asymmetric wheel zoom** — the previous zoom-out fix replaced the
  whole wheel handler, but MapLibre's `easeTo` ignores anchor points under
  globe projection, so the cursor-anchored dive was silently lost. Zooming
  in is back on MapLibre's native scroll handler (which anchors correctly on
  the globe); only downward wheel events are intercepted before MapLibre
  sees them and eased around the screen center. Verified in a headless
  browser: zoom-out recedes straight back, zoom-in pulls the center toward
  the pointer.
- **Straight-back zoom out** — cursor-anchored zooming now only applies when
  zooming in (diving toward the place under the pointer); zooming out
  recedes around the screen center, removing the orbit-like swing the globe
  made when the anchor point was held fixed while pulling back.
- **Visible head-on markers** — spikes point radially at the camera near the
  center of the visible hemisphere and collapsed to a subpixel cap, leaving
  the globe's face looking empty. Each spike tip now carries a screen-sized
  glowing dot (3.5–6.5 px, station-weighted) drawn as a second instanced
  pass and included in pixel picking, so every place is visible and
  clickable from any viewing angle.
- **Custom WebGL spike layer** — the station spikes are no longer MapLibre
  fill-extrusions: a custom layer draws all 12,326 octagonal spikes in a
  single instanced WebGL call inside MapLibre's render loop, using MapLibre's
  injected projection shader so they sit correctly on the globe, survive the
  globe-to-mercator transition at deep zoom, and clip behind the horizon.
  Spikes gain per-wall lighting and a brightened tip, and the map canvas is
  antialiased.
- **Pixel-exact marker picking** — hovering or clicking renders spike ids
  into an offscreen buffer and reads the pixel under the pointer, so the hit
  area is exactly the spike's visible body at any zoom, with correct
  front-to-back ordering, replacing the earlier screen-space approximation.
- **Thicker, high-visibility spikes** — footprints widened to 2.6–4.6 km and
  the color switched from muted green to hot pink at full opacity, a hue
  nothing in the satellite imagery competes with.
- **Full-body column clicks** — clicks anywhere along a column's projected
  screen segment selected its place, working around MapLibre only
  hit-testing the ground footprint of fill-extrusions.
- **Spike station markers** — all 12,326 places are rendered as thin octagonal
  MapLibre fill-extrusion spikes with station-weighted heights of 160–400 km,
  tall enough to read at the initial world view without zooming in. The spikes
  are the sole marker at every zoom level; the earlier ground circles and glow
  layers that blended into the column bases were removed.
- **Column-body interaction** — hovering or clicking anywhere along a spike's
  rendered body selects its place, instead of requiring the pointer near the
  base point, with a small pixel tolerance for thin columns.
- **Versioned marker style assets** — the application script URL is versioned
  so cached copies of an older invalid marker expression are not reused after
  a globe deployment.
- **Stable station loading** — station data now loads before the results panel
  opens, with existing results left in place during updates. Removing the
  forced loading modal prevents the page from shifting between temporary and
  final content heights.
- **Globe-only marker picking** — hover and click candidates must be on the
  visible hemisphere, preventing location tooltips from appearing outside the
  globe.
- **Results bottom spacing** — the globe station panel now leaves breathing
  room below its final card instead of ending flush against the scroll edge.
- **Natural single-station cards** — the completed results grid no longer
  inherits the loading panel's height, so a lone station keeps normal card
  proportions instead of stretching into a large block.
- **Stable globe viewport** — opening station results no longer shrinks or
  resizes the map; result cards flow below its fixed desktop or mobile height.
- **Polished imagery credit** — the Esri attribution now uses a compact glass
  pill with clean spacing and responsive sizing instead of an overlapping info
  toggle and text box.
- **Cursor-anchored globe zoom** — wheel input uses MapLibre's native
  screen-space anchor so the location beneath the pointer stays in place,
  while the buttons move one level immediately. Zoom levels 0 through 19 match
  the satellite imagery.
- **Same-origin API proxy** — deployed JSON requests for places, channels, and
  search now pass through a restricted Cloudflare Pages Function instead of
  calling Radio Garden directly from the browser, avoiding blocked CORS
  responses without exposing an open proxy.
- **Clean local development** — plain-HTTP development servers use the bundled
  places and stations snapshots immediately, avoiding repeated failed live API
  requests and console errors.
- **Readable attribution** — Esri imagery credits now use a high-contrast dark
  control with light text and links.
- **Reliable marker startup** — the place source and marker layers are loaded
  with the initial MapLibre style, preventing missing-layer interaction errors.
- **MapLibre globe renderer** — the globe now uses MapLibre GL JS with
  `projection: "globe"`, matching Radio Garden's current public architecture.
- **High-resolution satellite Earth** — Esri World Imagery is loaded as a
  level-of-detail tile pyramid up to level 19, so finer imagery streams in as
  the camera approaches instead of stretching one global image.
- **Synchronized loading** — the loader remains visible until initial imagery
  tiles and station points have rendered together.
- **Lower background cost** — animation stops whenever another app view is
  open, and render resolution is capped on high-DPI screens.
- **Faster first open** — MapLibre warms during browser idle time, while the
  globe still loads only the places snapshot rather than the station catalog.
- **Globe view** — an interactive 3D globe in the style of radio.garden as
  a new sidebar entry: drag to spin, scroll or use the +/−
  buttons to zoom, hover a city for its name and station count, click a
  city to list and play its stations. A live badge shows the loaded place and
  station totals, and the globe slowly rotates until touched.
- **Mixed-content stream proxy** — a Cloudflare Pages Function at `/listen`
  pipes plain-`http://` radio streams through the site's own HTTPS origin,
  so the ~4,000 stations with insecure streams play on the deployed site
  instead of being blocked by the browser. The player routes insecure
  streams through it automatically; on plain-HTTP local development nothing
  is proxied. The proxy only accepts Radio Garden station ids or stream hosts
  present in the crawled snapshot (`data/stream-hosts.json`), so it cannot be
  abused as an open proxy.
- **Full directory snapshot** — `tools/snapshot.mjs`, a resumable crawler
  that archives every place (12,326) and station (38,103) including each
  station's resolved direct stream URL into `data/`. The direct URLs point
  at the broadcasters themselves, not Radio Garden.
- **Automatic snapshot fallback** — if the live API is unreachable (e.g.
  ever locked down), browsing, search, and playback transparently switch to
  the local snapshot, with a one-time notice. Playback even falls back to
  the snapshot's direct stream URL if the live redirect endpoint fails
  mid-session.
- **Site launch** — deployed to Cloudflare Pages and connected the custom
  domain **openradio.world** (registered at hosttech, DNS on Cloudflare),
  with the private GitHub repository `PierrunoYT/openradio.world`. The README
  was rewritten for the new project identity; open-source wording removed
  while the repository is private (the MIT license file remains, ready for a
  future public release).
- **New backend: Radio Garden** — rebuilt the app on the (unofficial) Radio
  Garden API, replacing the Radio Browser backend of the predecessor project.
  Stations are now organized geographically, matching the radio.garden globe:
  - **Discover** shows stations from a rotating selection of featured
    cities, different on every visit.
  - **Search** queries Radio Garden stations and places.
  - **Browse by Country** drills down country → city → stations.
  - **Browse by City** lists all places sorted by station count, with
    Load More paging.
  - Playback goes through Radio Garden's `listen` endpoint, which always
    redirects to the station's current stream URL.
  - Favorites saved by the earlier Radio Browser-based app migrate
    automatically and keep playing through their stored stream URLs.
  - Removed Browse by Genre and Browse by Language (Radio Garden has no
    genre or language data), and station bitrate/codec/artwork display.
  - Carried over: favorites (localStorage), full audio player with
    previous/next, volume and mute, Media Session integration
    (lock-screen/OS controls), keyboard shortcuts, responsive dark theme,
    and the no-build-step architecture.
