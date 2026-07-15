# Changelog

All notable changes to OpenRadio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.2.0] - 2026-07-15

### Changed

- **Globe is now GPU-rendered** via a vendored copy of globe.gl (MIT, three.js-based, loaded lazily when the view opens), replacing the CPU canvas renderer — smooth dragging and zooming with inertia, always sharp, with an atmosphere glow. City dots are merged into a single geometry for performance; clicks resolve to the nearest city with a zoom-aware radius.

---

## [1.1.0] - 2026-07-15

### Added

- **Globe view** — an interactive 3D globe in the style of radio.garden, rendered dependency-free on a canvas with real NASA Blue Marble satellite imagery texture-mapped onto the sphere (per-pixel inverse orthographic projection). The 12,000+ clickable city dots are drawn on top. Drag to spin, scroll or use buttons to zoom, hover for city names, click a city to list and play its stations. The globe slowly rotates until touched and drops to a lower sampling resolution while moving for smooth interaction.

---

## [1.0.0] - 2026-07-15

Initial release.

### Added

- **Radio Garden API** as the station backend — thousands of stations across 12,000+ cities, organized geographically like the radio.garden globe
- **Discover** — stations from a rotating selection of featured cities, different on every visit
- **Search** — real-time search for stations and places
- **Browse by Country** — drill down country → city → stations
- **Browse by City** — every place on the globe, sorted by station count, with Load More paging
- **Favorites** — save stations locally (persisted in localStorage)
- **Full audio player** — play/pause, previous/next, volume control, mute toggle, stream retry logic
- **Media Session integration** — playback controls in the OS notification area and lock screen
- **Keyboard shortcuts** — space, arrows, `M`, `/`, `F`
- **Responsive dark theme** — works on desktop, tablet, and mobile
- **Zero dependencies** — pure HTML, CSS, and JavaScript; no frameworks, no build step
