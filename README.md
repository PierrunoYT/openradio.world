# 📻 OpenRadio

**A free internet radio player for listening to worldwide radio stations — right in your browser.**

No accounts, no ads, no tracking. Just open and listen.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Dependencies](https://img.shields.io/badge/dependencies-MapLibre-brightgreen.svg)
![Build](https://img.shields.io/badge/build-none_needed-brightgreen.svg)

**GitHub:** [https://github.com/PierrunoYT/openradio.world](https://github.com/PierrunoYT/openradio.world)

---

## What's New

OpenRadio ships continuously — every push to `main` deploys. See the
[changelog](CHANGELOG.md) for a full, dated log of what changed and when.

---

## Features

- **Thousands of stations in 12,000+ cities** worldwide via the [Radio Garden](https://radio.garden/) API
- **Discover** — Stations from a rotating selection of featured cities around the globe
- **Globe** — A Radio Garden-style MapLibre globe with tiled satellite imagery and glowing green dots for every city; spin, zoom, and click a dot to tune in
- **Search** — Real-time search by station name or place
- **Browse by Country** — Drill down from country to city to stations
- **Browse by City** — Every city on the Radio Garden globe, sorted by station count
- **Favorites** — Save your favorite stations locally (persisted in localStorage)
- **Full Audio Player** — Play/pause, previous/next, volume control, mute toggle
- **Media Session Integration** — Controls appear in your OS notification area and lock screen
- **Keyboard Shortcuts** — Navigate and control playback without touching the mouse
- **Responsive Design** — Works on desktop, tablet, and mobile, including safe-area support for notched phones
- **Installable PWA** — Web app manifest with full icon set, so it can be added to your home screen or dock
- **Dark Theme** — Modern dark UI with Inter typography, purple accents, and animated equalizer
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
├── assets/           # Brand icons, OG link-preview image, screenshots
├── data/             # Local places, stations, and stream-host snapshots
├── functions/        # Restricted Cloudflare API and audio proxies
├── index.html        # App structure, layout, and SEO/social meta
├── style.css         # Dark theme styling and responsive design
├── app.js            # Application logic, API calls, audio player
├── site.webmanifest  # PWA manifest (installable app)
├── robots.txt        # Crawler rules
├── sitemap.xml       # Sitemap for search engines
├── README.md         # This file
└── CHANGELOG.md      # Version history
```

## Technology

- **HTML5 Audio** for stream playback
- **Radio Garden API** — the (unofficial) API behind the radio.garden globe
- **Cloudflare Pages Functions** — same-origin JSON and mixed-content audio proxies
- **CSS Grid & Flexbox** for layout
- **CSS Custom Properties** for theming
- **Media Session API** for OS-level media controls
- **localStorage** for favorites and preferences
- **MapLibre GL JS** — globe projection, GPU marker rendering, and native feature picking
- **Esri World Imagery** — tiled satellite imagery that increases in detail while zooming
- **Vanilla JavaScript** — no frameworks, no transpilers, no bundlers

## API

OpenRadio uses the internal API behind [Radio Garden](https://radio.garden/), the interactive globe of live radio:

On the deployed HTTPS site, JSON requests pass through a restricted same-origin
Cloudflare Pages Function at `/api`. Plain-HTTP local development uses the
bundled directory snapshots directly, because Radio Garden does not provide
browser CORS access and `python -m http.server` cannot run Pages Functions.

| Endpoint | Purpose |
|---|---|
| `/api/ara/content/places` | All places (cities) with country, coordinates, and station count |
| `/api/ara/content/page/{placeId}/channels` | Stations in a place |
| `/api/search?q=...` | Search stations and places |
| `https://radio.garden/api/ara/content/listen/{channelId}/channel.mp3` | Redirects to the station's live stream |

> **⚠️ Unofficial API:** The Radio Garden API is **not official** — it is the internal, undocumented API behind radio.garden. It is not affiliated with, endorsed by, or supported by Radio Garden, and it **may be changed, restricted, or removed at any time without notice**. If that happens, parts of OpenRadio may stop working until the app is updated. The same-origin proxy only permits the three JSON endpoints listed above; the audio redirect remains a direct Radio Garden request.
>
> If you run into any problems, please report them directly via [GitHub Issues](https://github.com/PierrunoYT/openradio.world/issues).

Live API playback uses Radio Garden's `listen` endpoint so streams resolve to
their current URL. Snapshot playback uses its archived direct URL, with
plain-HTTP streams routed through the restricted `/listen` proxy on HTTPS.

## Browser Support

Any modern browser with HTML5 Audio support:

- Chrome / Edge 80+
- Firefox 78+
- Safari 14+
- Opera 67+

> **Note:** Some radio streams may not work in all browsers due to codec support (e.g., HLS streams). The vast majority of stations use MP3 or AAC which work everywhere.

## Support & Issues

Found a bug, a broken station, or something that stopped working (e.g., after a
Radio Garden API change)? Please contact us directly by opening a
[GitHub Issue](https://github.com/PierrunoYT/openradio.world/issues) — that is
the fastest way to get help and the only official support channel.

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
