/**
 * Service worker: cross-origin proxy for Lrclib.
 *
 * Content scripts run on the page origin (music.youtube.com / open.spotify.com),
 * so fetch() to lrclib.net is CORS-blocked even when host_permissions lists the
 * domain. host_permissions grants cross-origin access to the service worker and
 * extension pages only, NOT to content scripts. Network requests therefore have
 * to be moved here.
 */

const LRCLIB_ENDPOINT = 'https://lrclib.net/api';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

/** @type {Map<string, {expires: number, payload: any}>} */
const responseCache = new Map();

function cacheGet(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
}

function buildSearchUrl(query) {
  return `${LRCLIB_ENDPOINT}/search?q=${encodeURIComponent(query)}`;
}

async function searchLrclib(query) {
  if (!query || typeof query !== 'string') {
    return { ok: false, status: 0, error: 'Empty query' };
  }

  const cached = cacheGet(query);
  if (cached) return { ...cached, cached: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(buildSearchUrl(query), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }

    const items = await res.json();
    const payload = { ok: true, status: res.status, items: Array.isArray(items) ? items : [] };
    cacheSet(query, payload);
    return payload;
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: aborted ? 'Timed out while contacting Lrclib' : String((err && err.message) || err)
    };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'LRCLIB_SEARCH') return false;

  searchLrclib(message.query)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, status: 0, error: String(err && err.message || err) }));

  // Keep the channel open for the async response
  return true;
});
