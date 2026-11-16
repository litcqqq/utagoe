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
const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const TRANSLATE_TIMEOUT_MS = 12000;

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

/**
 * Translation proxy.
 *
 * Same CORS reasoning as Lrclib: translate.googleapis.com cannot be called from
 * a content script on open.spotify.com, so the request is made here. The GTX
 * endpoint returns `[[["text","source",...],...],...]` and splits a
 * newline-joined batch into one segment per line, which is how multiple lyric
 * lines are translated in a single round trip.
 */
async function translateTexts(texts, targetLang, sourceLang) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { ok: false, error: 'Empty translation request' };
  }
  if (!targetLang) {
    return { ok: false, error: 'Missing target language' };
  }

  const sanitized = texts.map(line => String(line == null ? '' : line).replace(/\r?\n/g, ' ').trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

  async function requestOne(query, signal) {
    const url = `${GOOGLE_TRANSLATE_ENDPOINT}?client=gtx` +
      `&sl=${encodeURIComponent(sourceLang || 'ja')}` +
      `&tl=${encodeURIComponent(targetLang)}` +
      `&dt=t&q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Unexpected response format from translation endpoint');
    }

    let out = '';
    for (const segment of data[0]) {
      if (Array.isArray(segment) && typeof segment[0] === 'string') out += segment[0];
    }
    return out;
  }

  try {
    if (sanitized.length === 1) {
      const single = await requestOne(sanitized[0], controller.signal);
      return { ok: true, translations: [single.trim()] };
    }

    const joined = sanitized.join('\n');
    const batch = await requestOne(joined, controller.signal);
    const split = batch.split(/\r?\n/);

    if (split.length === sanitized.length) {
      return { ok: true, translations: split.map(line => line.trim()) };
    }

    // Google sometimes merges or drops newline boundaries. Translating line by
    // line is slower but preserves the caller's index alignment, which matters
    // because each result is attached to a specific lyric line.
    const perLine = [];
    for (const line of sanitized) {
      const translated = await requestOne(line, controller.signal);
      perLine.push(translated.trim());
    }
    return { ok: true, translations: perLine };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'Timed out while contacting translation service'
        : String((err && err.message) || err)
    };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'UTAGOE_TRANSLATE') {
    translateTexts(message.texts, message.targetLang, message.sourceLang)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type !== 'LRCLIB_SEARCH') return false;

  searchLrclib(message.query)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, status: 0, error: String(err && err.message || err) }));

  // Keep the channel open for the async response
  return true;
});
