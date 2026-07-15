// Snapshot the Radio Garden directory into data/ so the app can keep
// working from a local copy if the API is ever locked down.
//
//   node tools/snapshot.mjs
//
// Produces:
//   data/places.json    — all places: { id, title, country, size, boost, geo }
//   data/stations.json  — all stations: { id, name, place, placeId, country,
//                          website, secure, streamUrl }
//
// The crawl is resumable: progress is checkpointed to data/.snapshot-progress.json
// after every batch, so rerunning the script continues where it left off.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const PLACES_FILE = join(DATA_DIR, 'places.json');
const STATIONS_FILE = join(DATA_DIR, 'stations.json');
const PROGRESS_FILE = join(DATA_DIR, '.snapshot-progress.json');

const API_BASE = 'https://radio.garden/api';
// Cloudflare challenges non-browser user agents; identify as a browser
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const CONCURRENCY = 6;
const CHECKPOINT_EVERY = 300;

mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(path, attempt = 1) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { 'User-Agent': UA } });
    if (res.status === 403 || res.status === 429) {
      if (attempt > 4) throw new Error(`Blocked (${res.status}) on ${path}`);
      const wait = 15000 * attempt;
      console.log(`  rate limited (${res.status}), backing off ${wait / 1000}s...`);
      await sleep(wait);
      return apiFetch(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return await res.json();
  } catch (err) {
    if (attempt > 4) throw err;
    await sleep(3000 * attempt);
    return apiFetch(path, attempt + 1);
  }
}

// Resolve the listen redirect to the station's real stream URL
async function resolveStream(id, attempt = 1) {
  try {
    const res = await fetch(`${API_BASE}/ara/content/listen/${id}/channel.mp3`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': UA },
    });
    if (res.status === 403 || res.status === 429) {
      if (attempt > 4) return null;
      await sleep(15000 * attempt);
      return resolveStream(id, attempt + 1);
    }
    if (res.status >= 300 && res.status < 400) {
      return res.headers.get('location');
    }
    return null;
  } catch {
    if (attempt > 4) return null;
    await sleep(3000 * attempt);
    return resolveStream(id, attempt + 1);
  }
}

// Run tasks over items with a fixed number of workers
async function pool(items, worker) {
  let next = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return { donePlaces: [], stations: {} };
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { donePlaces: [], stations: {} };
  }
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
}

async function main() {
  console.log('=== Phase 1: places ===');
  const placesData = await apiFetch('/ara/content/places');
  const places = placesData.data.list
    .filter((p) => p.title && p.country)
    .map((p) => ({ id: p.id, title: p.title, country: p.country, size: p.size, boost: !!p.boost, geo: p.geo }));
  writeFileSync(PLACES_FILE, JSON.stringify(places));
  console.log(`${places.length} places -> data/places.json`);

  const progress = loadProgress();
  const donePlaces = new Set(progress.donePlaces);
  const stations = progress.stations; // id -> station record

  console.log('=== Phase 2: stations per place ===');
  const todo = places.filter((p) => !donePlaces.has(p.id));
  console.log(`${todo.length} places to crawl (${donePlaces.size} already done)`);
  let crawled = 0;

  await pool(todo, async (place) => {
    try {
      const data = await apiFetch(`/ara/content/page/${place.id}/channels`);
      (data.data.content || []).forEach((block) => {
        (block.items || []).forEach((item) => {
          const page = item.page;
          if (!page || page.type !== 'channel') return;
          const id = page.url.split('/').pop();
          stations[id] = {
            id,
            name: page.title,
            place: place.title,
            placeId: place.id,
            country: page.country ? page.country.title : place.country,
            website: page.website || '',
            secure: !!page.secure,
            streamUrl: stations[id] ? stations[id].streamUrl : null,
          };
        });
      });
      donePlaces.add(place.id);
    } catch (err) {
      console.log(`  FAILED place ${place.title}: ${err.message}`);
    }
    crawled++;
    if (crawled % CHECKPOINT_EVERY === 0) {
      progress.donePlaces = [...donePlaces];
      saveProgress(progress);
      console.log(`  ${crawled}/${todo.length} places, ${Object.keys(stations).length} stations so far`);
    }
  });

  progress.donePlaces = [...donePlaces];
  saveProgress(progress);
  console.log(`${Object.keys(stations).length} stations collected`);

  console.log('=== Phase 3: resolve stream URLs ===');
  const unresolved = Object.values(stations).filter((s) => !s.streamUrl);
  console.log(`${unresolved.length} streams to resolve`);
  let resolved = 0;

  await pool(unresolved, async (station) => {
    station.streamUrl = await resolveStream(station.id);
    resolved++;
    if (resolved % (CHECKPOINT_EVERY * 4) === 0) {
      saveProgress(progress);
      console.log(`  ${resolved}/${unresolved.length} streams resolved`);
    }
  });

  saveProgress(progress);

  const all = Object.values(stations);
  const withStream = all.filter((s) => s.streamUrl).length;
  writeFileSync(STATIONS_FILE, JSON.stringify(all));
  console.log('=== Done ===');
  console.log(`${all.length} stations (${withStream} with resolved stream URLs) -> data/stations.json`);
}

main().catch((err) => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
