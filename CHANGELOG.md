# Changelog

A rolling log of notable changes to OpenRadio. The site ships continuously
(every push to `main` deploys), so entries are grouped by date and sorted by
commit order rather than by version number. Newest change first.

---

## 2026-07-15

- **Every station card now links back to the globe** — visible globe controls
  on search, country, city, Discover, and eligible favorite cards tune the
  selected station before opening its city at a close map zoom with the marker
  ring selected. The globe-side station panel opens alongside the marked
  location on desktop and in the existing stacked flow on mobile.

- **Discover can be refreshed in place** — a new Refresh button rerolls the
  featured cities and stations without requiring another sidebar click or a
  full page reload. The control shows its loading state and prevents duplicate
  refreshes while station data is being fetched. The app also creates the
  control defensively when an older cached page loads the latest script, so a
  mixed deployment cannot interrupt initialization.

- **Station browser now stays beside the selected place** — choosing a city
  from globe search or by clicking a marker now zooms to a city-level view
  and opens its stations in a dedicated, independently scrollable side panel
  on desktop, so the globe remains visible and interactive. Returning with
  **Back to Globe** expands the map again and re-centers it on the same city
  instead of losing the selected location. Smaller screens retain the stacked
  station flow, and the panel shows a loading indicator while stations are
  fetched. Clicking a station zooms further into its associated city marker
  while starting playback, and a thin high-contrast ring marks that location
  as selected.
- **Find a place on the globe** — the globe was drag/scroll-only with no
  way to jump straight to a country or city, so locating a specific place
  meant manually spinning and zooming. A search box in the globe's
  top-right corner now matches against all 12,326 places as you type
  (prioritizing name matches, then country matches, ranked by station
  count), and picking a result flies the camera there and opens its
  station list — the same flow as clicking a dot directly. Supports
  arrow-key navigation, Enter to pick the top match, and Escape/outside
  click to dismiss. Verified in a headless browser at desktop and mobile
  sizes.
- **Open Graph link-preview image copy fixed** — the redesign re-rendered
  `assets/og-image.png` in the new amber-on-navy style but kept the old
  tagline ("Listen live to radio stations from every corner of the
  world"), out of sync with the page's actual meta description. The
  image is rebuilt with matching copy, and the `og:image`/`twitter:image`
  URLs are now cache-busted so platforms that cache link previews by URL
  pick up the refresh.
- **Globe centered again after the zoom-in** — opening the globe bigger
  (previous entry) exposed a pre-existing offset: the camera's tilt
  (`pitch: 20`) shifts the rendered sphere downward relative to its
  geographic center point, which barely showed at the old small zoom but
  clipped the globe against the bottom of the view once it filled the
  container. The sphere is now nudged back up by a fraction of its own
  diameter so it sits centered on any screen size.
- **Complete visual redesign — the "Night Broadcast" theme** — the whole UI
  was rebuilt from scratch around a new design system. The purple
  Spotify-style look is gone; in its place: a deep ink-navy night sky, a
  warm amber "dial glow" primary accent, and live-signal green reserved
  for anything that is on air (the playing card's ring and equalizer now
  match the globe's green city dots). Headings, the logo, and station
  names use Space Grotesk alongside Inter for UI text. The player bar is
  now a floating broadcast dock with an amber play button, nav items get
  an amber tick and glow when active, section titles carry a dial-tick
  marker, and the sidebar footer sports a tuning-dial frequency ruler.
  The brand followed along: `assets/icon.svg`, every PNG icon (favicon,
  Apple touch, PWA set including the maskable variant), and the Open
  Graph link-preview image were re-rendered in the amber-on-navy style,
  and the browser/PWA theme color moved to the new background. All
  behavior, layout breakpoints, keyboard shortcuts, and safe-area
  handling are unchanged — this is a pure reskin, `app.js` untouched.
- **Globe opens big, like Radio Garden** — the globe view no longer starts
  as a small distant marble. The starting zoom is now computed from the
  container size so the planet spans about 95% of the shorter edge of the
  view on any screen, matching Radio Garden's opening framing (never
  zoomed out further than before on small screens).
- **GitHub link in the sidebar** — OpenRadio is open source, and the site
  now says so: the sidebar footer links to the project repository at
  [github.com/PierrunoYT/openradio.world](https://github.com/PierrunoYT/openradio.world),
  with a GitHub mark that highlights on hover. The README also dropped its
  hand-maintained "Today's Changes" section in favor of linking here, and
  its feature list and project structure were brought up to date (PWA
  install, SEO files, brand assets).
- **Brand icon, link previews, and SEO** — the site now has a real identity
  everywhere it appears. A new broadcast-waves mark (purple gradient on a
  dark tile, `assets/icon.svg`) replaces the 📻 emoji as the favicon, the
  sidebar logo, and the placeholder tile on station cards, with PNG
  renders for Apple touch icon, PWA manifest icons (including a maskable
  variant), and a 32px fallback favicon. Sharing a link now shows a proper
  preview card: a rendered 1200×630 Open Graph image plus full
  `og:*`/`twitter:*` meta tags. Search engines get a descriptive title and
  meta description, a canonical URL, JSON-LD `WebApplication` structured
  data, `robots.txt`, and `sitemap.xml`, and the app is installable via a
  new `site.webmanifest`.
- **Mobile responsiveness pass** — the app now behaves properly on phones
  and tablets. The layout sizes itself with dynamic viewport units so the
  player bar is never hidden behind a mobile browser's collapsing URL bar,
  and the player bar, topbar, sidebar, and content respect the safe-area
  insets of notched phones. A long station name no longer pushes the player
  bar past the viewport edge — it truncates with an ellipsis. Station-card
  favorite buttons are always visible on touch screens (any width) with a
  subtle press effect, the search field no longer triggers iOS Safari's
  auto-zoom on focus, and touch targets grew across the board (nav buttons,
  chips, play button, globe controls). Tablets get a narrower sidebar, the
  phone drawer is capped at 85% of the screen width and closes on Escape,
  and the mobile globe view uses dynamic viewport height. Verified in a
  headless browser at phone and tablet sizes with zero horizontal overflow.
- **UI polish pass** — the app-wide dark theme gained depth and hierarchy:
  Inter as the interface font, subtle purple/green ambient gradients behind
  the content, gradient-tinted station cards with accent hover glow,
  purple-tinted favicon tiles, a gradient active state and hover motion in
  the sidebar nav, a translucent blurred topbar, a glass player bar with an
  accent hairline and gradient play button, refined chips, thinner
  scrollbars, and visible keyboard focus outlines. The stylesheet is now
  cache-busted like app.js.
- **Fixed truncation under card icons** — a station card's place/country
  line now ellipsizes instead of running beneath the equalizer and favorite
  icons on the playing card.
- **No crash on cached pages** — browsers holding a cached index.html
  receive the newest app.js regardless of the cache-busting query, so the
  info-button wiring could hit missing markup and abort the whole script.
  The wiring is now guarded against absent elements.
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
- **Stable station loading (superseded)** — station data was changed to load
  before the below-globe results panel opened, with existing results left in
  place during updates. The newer side-panel flow described above now opens
  immediately with an in-panel loading indicator instead.
- **Globe-only marker picking** — hover and click candidates must be on the
  visible hemisphere, preventing location tooltips from appearing outside the
  globe.
- **Results bottom spacing** — the globe station panel now leaves breathing
  room below its final card instead of ending flush against the scroll edge.
- **Natural single-station cards** — the completed results grid no longer
  inherits the loading panel's height, so a lone station keeps normal card
  proportions instead of stretching into a large block.
- **Stable globe viewport (superseded on desktop)** — station results were
  moved below a fixed-size map to prevent viewport changes. The newer desktop
  layout described above intentionally gives the stations their own side pane;
  the stacked mobile layout still keeps results below the globe.
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
