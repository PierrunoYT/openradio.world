// Cloudflare Pages Function: restricted same-origin proxy for the Radio Garden
// JSON endpoints used by the app. Radio Garden does not allow browser CORS.

const API_BASE = 'https://radio.garden/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function apiPath(params) {
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  return `/${segments.filter(Boolean).join('/')}`;
}

export async function onRequestGet({ request, params }) {
  const path = apiPath(params);
  const isPlaces = path === '/ara/content/places';
  const isChannels = /^\/ara\/content\/page\/[A-Za-z0-9_-]{4,32}\/channels$/.test(path);
  const isSearch = path === '/search';
  if (!isPlaces && !isChannels && !isSearch) {
    return new Response('Not found', { status: 404 });
  }

  const target = new URL(`${API_BASE}${path}`);
  if (isSearch) {
    const query = new URL(request.url).searchParams.get('q')?.trim();
    if (!query || query.length > 200) {
      return new Response('Invalid search query', { status: 400 });
    }
    target.searchParams.set('q', query);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
      },
    });
  } catch {
    return new Response('Upstream fetch failed', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(`Upstream error ${upstream.status}`, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  headers.set('Cache-Control', isPlaces ? 'public, max-age=300' : 'no-store');
  return new Response(upstream.body, { status: 200, headers });
}
