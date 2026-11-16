/**
 * Service worker: cross-origin proxy untuk Lrclib.
 *
 * Content script berjalan dengan origin halaman (music.youtube.com / open.spotify.com),
 * sehingga fetch() ke lrclib.net diblokir CORS walaupun host_permissions sudah memuat
 * domain tersebut. host_permissions hanya memberi akses lintas origin kepada service
 * worker dan halaman extension, BUKAN kepada content script. Jadi permintaan jaringan
 * harus dipindahkan ke sini.
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
    return { ok: false, status: 0, error: 'Query kosong' };
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
      error: aborted ? 'Timeout saat menghubungi Lrclib' : String((err && err.message) || err)
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

  // Pertahankan channel tetap terbuka untuk respons asinkron
  return true;
});
