/**
 * Spotify Japanese Lyrics Romaji Extension
 * External Validator Module (Lrclib Community API integration)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LyricsValidator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const cache = new Map();

  /**
   * Lyrics lookup transport.
   *
   * Content scripts inherit the page origin, so a direct fetch() to lrclib.net
   * is CORS-blocked ("Domains, protocols and ports must match") even when the
   * domain is listed in host_permissions. The correct path is to message the
   * service worker, which does hold cross-origin access.
   */
  async function requestSearch(query) {
    const hasRuntime = typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function';

    if (hasRuntime) {
      const res = await chrome.runtime.sendMessage({ type: 'LRCLIB_SEARCH', query });
      if (!res || typeof res !== 'object') {
        return { ok: false, status: 0, error: 'No response from the service worker' };
      }
      return res;
    }

    // Fallback: used by Node tests and contexts without an extension runtime
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const items = await res.json();
    return { ok: true, status: res.status, items: Array.isArray(items) ? items : [] };
  }

  // Test if a string of lyrics is primarily written in Romanized alphabet (Latin characters)
  const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

  function isRomanizedText(text) {
    if (!text || text.trim().length === 0) return false;
    // Should NOT contain Japanese characters
    if (JAPANESE_CHAR_REGEX.test(text)) return false;

    // Must contain letters
    const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
    return latinCount > 15;
  }

  /**
   * Lrclib plainLyrics often starts with a header line, e.g. "Lemon - Kenshi
   * Yonezu" or "[Verse 1]". That line is not a lyric. If it is counted, every
   * Romaji line shifts by one against its Kanji counterpart. Strip the header
   * before use.
   */
  function stripHeaderLines(lines, trackName, artistName) {
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const title = norm(trackName);
    const artist = norm(artistName);

    const isHeader = (line) => {
      const t = norm(line);
      if (!t) return true;
      // LRC structure marker line
      if (/^\[.*\]$/.test(t)) return true;
      // Title + artist combination, in either order
      if (title && artist && t.includes(title) && t.includes(artist)) return true;
      if (title && t === title) return true;

      // "Artist - Title" / "Title - Artist" with a separator
      const parts = t.split(/\s+[-–—|]\s+/);
      if (parts.length === 2) {
        const [a, b] = parts;
        if ((title && (a === title || b === title)) && (artist && (a === artist || b === artist))) {
          return true;
        }
        if (title && (a === title || b === title)) return true;
      }
      return false;
    };

    let start = 0;
    while (start < lines.length && isHeader(lines[start])) start++;
    // Never empty the whole list purely because of the header heuristic.
    return start >= lines.length ? lines : lines.slice(start);
  }

  /**
   * stripHeaderLines variant for synced lines ({timeMs, text}).
   * Title lines usually carry no timestamp, so filtering is done on the text
   * rather than on time.
   */
  function stripHeaderSyncedLines(syncedLines, trackName, artistName) {
    if (!Array.isArray(syncedLines) || syncedLines.length === 0) return syncedLines;

    const texts = syncedLines.map(l => l.text);
    const stripped = stripHeaderLines(texts, trackName, artistName);
    const removed = texts.length - stripped.length;
    if (removed <= 0) return syncedLines;
    return syncedLines.slice(removed);
  }

  // Parse LRC formatted synced lyrics: [mm:ss.xx] Lyric text
  function parseSyncedLrc(syncedLrcString) {
    const lines = [];
    const rawLines = syncedLrcString.split('\n');

    for (const raw of rawLines) {
      const match = raw.match(/^\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\](.*)$/);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseFloat(match[2]);
        const timeMs = Math.round((min * 60 + sec) * 1000);
        const text = match[3].trim();
        if (text.length > 0) {
          lines.push({ timeMs, text });
        }
      }
    }

    return lines;
  }

  /**
   * Search Lrclib for human-verified Romanized lyrics
   * @param {string} trackName - Song title
   * @param {string} artistName - Artist name
   * @returns {Promise<Object|null>} Verified lyrics package or null
   */
  async function searchVerifiedLyrics(trackName, artistName) {
    if (!trackName) return null;

    const cacheKey = `${artistName || ''} - ${trackName}`.toLowerCase().trim();
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const queries = [];
    if (artistName) {
      queries.push(`${artistName} ${trackName}`);
      queries.push(`${artistName} ${trackName} romanized`);
    } else {
      queries.push(trackName);
    }

    for (const query of queries) {
      try {
        const res = await requestSearch(query);
        if (!res || !res.ok) continue;

        const items = res.items;
        if (!Array.isArray(items) || items.length === 0) continue;

        for (const item of items) {
          // Check if this item has romanized lyrics
          const rawLyrics = item.syncedLyrics || item.plainLyrics || '';
          if (isRomanizedText(rawLyrics)) {
            const plainLines = stripHeaderLines(
              (item.plainLyrics || '')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('[') && !l.endsWith(']')),
              item.trackName || trackName,
              item.artistName || artistName
            );

            // Synced lyrics can start with a header line too; if it is not removed,
            // syncedLines indices shift against the Kanji lines on the page.
            const syncedLines = item.syncedLyrics
              ? stripHeaderSyncedLines(
                  parseSyncedLrc(item.syncedLyrics),
                  item.trackName || trackName,
                  item.artistName || artistName
                )
              : null;

            const result = {
              source: 'lrclib',
              trackName: item.trackName,
              artistName: item.artistName,
              hasSync: !!item.syncedLyrics,
              syncedLines,
              plainLines
            };

            cache.set(cacheKey, result);
            return result;
          }
        }
      } catch (err) {
        console.warn('[Spotify-Romaji] Validator network check skipped:', err.message);
      }
    }

    cache.set(cacheKey, null);
    return null;
  }

  return {
    searchVerifiedLyrics,
    isRomanizedText,
    parseSyncedLrc,
    stripHeaderLines
  };
});
