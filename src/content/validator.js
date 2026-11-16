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
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Spotify-Lyrics-Romaji-Ext/1.0.0' } });
        if (!res.ok) continue;

        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) continue;

        for (const item of items) {
          // Check if this item has romanized lyrics
          const rawLyrics = item.syncedLyrics || item.plainLyrics || '';
          if (isRomanizedText(rawLyrics)) {
            const result = {
              source: 'lrclib',
              trackName: item.trackName,
              artistName: item.artistName,
              hasSync: !!item.syncedLyrics,
              syncedLines: item.syncedLyrics ? parseSyncedLrc(item.syncedLyrics) : null,
              plainLines: (item.plainLyrics || '')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('[') && !l.endsWith(']'))
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
    parseSyncedLrc
  };
});
