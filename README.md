# 📻 OpenRadio

**A free internet radio player for listening to worldwide radio stations — right in your browser.**

No accounts, no ads, no tracking. Just open and listen.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Dependencies](https://img.shields.io/badge/dependencies-MapLibre-brightgreen.svg)
![Build](https://img.shields.io/badge/build-none_needed-brightgreen.svg)

**GitHub:** [https://github.com/PierrunoYT/openradio.world](https://github.com/PierrunoYT/openradio.world)

---

## Today's Changes

### 2026-07-15

- **Globe** — Uses MapLibre GL JS globe projection with tiled Esri satellite
  imagery, native GPU station markers, and synchronized loading.
- **Streams on HTTPS** — Added a restricted `/listen` proxy so stations using
  plain-HTTP streams can play securely on the deployed HTTPS site.
- **Offline resilience** — Added a resumable full-directory snapshot and
  automatic fallbacks for browsing, search, and station playback when the
  live Radio Garden API is unavailable.
- **Site launch** — Deployed OpenRadio to Cloudflare Pages, connected
  **openradio.world**, and established the project repository.
- **New backend: Radio Garden** — Rebuilt discovery, search, country and city
  browsing, playback, and favorite migration around the unofficial Radio
  Garden API.

For complete details, see the [changelog](CHANGELOG.md).

---

## Features

- **Thousands of stations in 12,000+ cities** worldwide via the [Radio Garden](https://radio.garden/) API
- **Discover** — Stations from a rotating selection of featured cities around the globe
- **Globe** — A Radio Garden-style MapLibre globe with tiled satellite imagery and GPU station markers; spin, zoom, and click a city to tune in
- **Search** — Real-time search by station name or place
- **Browse by Country** — Drill down from country to city to stations
- **Browse by City** — Every city on the Radio Garden globe, sorted by station count
- **Favorites** — Save your favorite stations locally (persisted in localStorage)
- **Full Audio Player** — Play/pause, previous/next, volume control, mute toggle
- **Media Session Integration** — Controls appear in your OS notification area and lock screen
- **Keyboard Shortcuts** — Navigate and control playback without touching the mouse
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Dark Theme** — Modern dark UI with purple accents and animated equalizer
- **No Build Step** — Plain HTML, CSS, and JavaScript; MapLibre loads from a pinned CDN release
- **Stream Retry Logic** — Automatic retries when a stream fails to start

## Getting Started

### Option 1: Just Open It

1. Download or clone this repository
2. Open `index.html` in any modern browser
3. Start listening

```bash
git clone https://github.com/PierrunoYT/openradio.world.git
cd openradio.world
# Open index.html in your browser
start index.html        # Windows
open index.html         # macOS
xdg-open index.html     # Linux
```

### Option 2: Serve It Locally

Use any static file server:

```bash
# Python
python -m http.server 8000

# Node.js (npx, no install needed)
npx serve .

# PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` | Previous station |
| `→` | Next station |
| `↑` | Volume up |
| `↓` | Volume down |
| `M` | Mute / Unmute |
| `/` | Jump to search |
| `F` | Toggle favorite |

## Project Structure

```
OpenRadio/
├── assets/       # Screenshots and images
├── index.html    # App structure and layout
├── style.css     # Dark theme styling and responsive design
├── app.js        # Application logic, API calls, audio player
├── README.md     # This file
└── CHANGELOG.md  # Version history
```

## Technology

- **HTML5 Audio** for stream playback
- **Radio Garden API** — the (unofficial) API behind the radio.garden globe
- **CSS Grid & Flexbox** for layout
- **CSS Custom Properties** for theming
- **Media Session API** for OS-level media controls
- **localStorage** for favorites and preferences
- **MapLibre GL JS** — globe projection, GPU marker rendering, and native feature picking
- **Esri World Imagery** — tiled satellite imagery that increases in detail while zooming
- **Vanilla JavaScript** — no frameworks, no transpilers, no bundlers

## API

OpenRadio uses the internal API behind [Radio Garden](https://radio.garden/), the interactive globe of live radio:

| Endpoint | Purpose |
|---|---|
| `/api/ara/content/places` | All places (cities) with country, coordinates, and station count |
| `/api/ara/content/page/{placeId}/channels` | Stations in a place |
| `/api/search?q=...` | Search stations and places |
| `/api/ara/content/listen/{channelId}/channel.mp3` | Redirects to the station's live stream |

> **Note:** This API is unofficial and undocumented — Radio Garden may change or restrict it at any time.

Playback never touches stream URLs directly: the app points the audio element at the `listen` endpoint and the browser follows the redirect, so streams always resolve to the station's current URL.

## Browser Support

Any modern browser with HTML5 Audio support:

- Chrome / Edge 80+
- Firefox 78+
- Safari 14+
- Opera 67+

> **Note:** Some radio streams may not work in all browsers due to codec support (e.g., HLS streams). The vast majority of stations use MP3 or AAC which work everywhere.

## Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m "Add my feature"`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

This project is licensed under the [MIT License](LICENSE).

---

**OpenRadio** — Free Forever.
