/**
 * Utagoe Lyrics Romaji Extension
 * Lyric Translation Module (Stacked translation line under Romaji)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LyricTranslate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_CACHE_ENTRIES = 400;
  const REQUEST_TIMEOUT_MS = 12000;
  const DEFAULT_SOURCE_LANG = 'ja';
  const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

  // Matches any Unicode letter across scripts (Hiragana, Katakana, Han, Latin, etc.)
  const LETTER_REGEX = /\p{L}/u;

  /**
   * Languages offered in the Utagoe translation selector UI.
   * @type {Array<{code: string, label: string}>}
   */
  const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'id', label: 'Indonesian' },
    { code: 'ko', label: 'Korean' },
    { code: 'zh', label: 'Chinese Simplified' },
    { code: 'es', label: 'Spanish' },
    { code: 'th', label: 'Thai' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' }
  ];

  /** @type {Map<string, string>} */
  const cache = new Map();

  /**
   * Build a deterministic composite cache key scoping translations by target language
   * so switching languages never returns stale text from another language.
   * @param {string} targetLang - Target language code
   * @param {string} text - Source lyric line
   * @returns {string} Composite cache key
   */
  function buildCacheKey(targetLang, text) {
    return targetLang + '\u0000' + text;
  }

  /**
   * Store a translated line in the bounded cache, evicting the oldest entry
   * once capacity reaches MAX_CACHE_ENTRIES to bound memory growth in long sessions.
   * @param {string} key - Composite cache key
   * @param {string} value - Translated text
   */
  function cacheSet(key, value) {
    if (cache.has(key)) {
      cache.delete(key);
    } else if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
    cache.set(key, value);
  }

  /**
   * Clear all cached translations from memory when the user resets state or tests run.
   */
  function clearCache() {
    cache.clear();
  }

  /**
   * Determine whether a lyric line contains actual letters worth translating,
   * allowing pure punctuation, musical symbols, and whitespace to be skipped.
   * @param {string} text - Input lyric line
   * @returns {boolean} True when the string contains at least one letter
   */
  function isTranslatableLine(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    return LETTER_REGEX.test(trimmed);
  }

  /**
   * Reassemble the translated string from the nested array structure returned
   * by the Google Translate GTX endpoint (`data[0][i][0]`).
   * @param {*} data - Parsed JSON payload from Google Translate
   * @returns {string} Concatenated translated text
   */
  function extractGoogleTranslatedText(data) {
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Unexpected response format from translation endpoint');
    }

    let output = '';
    for (const segment of data[0]) {
      if (Array.isArray(segment) && typeof segment[0] === 'string') {
        output += segment[0];
      }
    }
    return output;
  }

  /**
   * Perform a single HTTP GET against the Google Translate endpoint with an
   * AbortController timeout so unresponsive connections fail predictably within 12s.
   * @param {string} queryText - Single line or newline-joined batch of lines
   * @param {string} targetLang - Target language code
   * @param {string} sourceLang - Source language code
   * @returns {Promise<string>} Raw translated text from the endpoint
   */
  async function fetchGoogleSingleRequest(queryText, targetLang, sourceLang) {
    const url = `${GOOGLE_TRANSLATE_ENDPOINT}?client=gtx` +
      `&sl=${encodeURIComponent(sourceLang)}` +
      `&tl=${encodeURIComponent(targetLang)}` +
      `&dt=t&q=${encodeURIComponent(queryText)}`;

    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      return extractGoogleTranslatedText(data);
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      if (aborted) {
        throw new Error('Timed out while contacting translation service');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Direct fetch fallback for Node tests and environments without a Chrome extension
   * runtime. Batches lines with newline separators and falls back to per-line fetches
   * if the endpoint merges or drops newline boundaries.
   * @param {string[]} texts - Deduplicated non-empty lines to translate
   * @param {string} targetLang - Target language code
   * @param {string} sourceLang - Source language code
   * @returns {Promise<string[]>} Translated lines matching `texts` length and order
   */
  async function requestGoogleFallback(texts, targetLang, sourceLang) {
    if (texts.length === 0) return [];

    const sanitized = texts.map(function (line) {
      return line.replace(/\r?\n/g, ' ').trim();
    });

    if (sanitized.length === 1) {
      const single = await fetchGoogleSingleRequest(sanitized[0], targetLang, sourceLang);
      return [single.trim()];
    }

    const joined = sanitized.join('\n');
    const batchRaw = await fetchGoogleSingleRequest(joined, targetLang, sourceLang);
    const splitLines = batchRaw.split(/\r?\n/);

    if (splitLines.length === sanitized.length) {
      return splitLines.map(function (line) {
        return line.trim();
      });
    }

    // Fallback to individual line requests when batch line count mismatches
    const perLineResults = [];
    for (const line of sanitized) {
      const translated = await fetchGoogleSingleRequest(line, targetLang, sourceLang);
      perLineResults.push(translated.trim());
    }
    return perLineResults;
  }

  /**
   * Translation transport that routes requests through the extension service worker
   * to avoid page-origin CORS restrictions on Spotify and YouTube Music, while
   * falling back to direct fetch in Node test environments.
   * @param {string[]} texts - Deduplicated lines requiring translation
   * @param {string} targetLang - Target language code
   * @param {string} sourceLang - Source language code
   * @returns {Promise<string[]>} Array of translated lines matching `texts`
   */
  async function requestTranslations(texts, targetLang, sourceLang) {
    const hasRuntime = typeof chrome !== 'undefined' &&
      chrome &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function';

    if (hasRuntime) {
      const controller = new AbortController();
      let timer = null;

      const timeoutPromise = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          controller.abort();
          reject(new Error('Timed out while waiting for translation service worker'));
        }, REQUEST_TIMEOUT_MS);
      });

      try {
        const res = await Promise.race([
          chrome.runtime.sendMessage({
            type: 'UTAGOE_TRANSLATE',
            texts,
            targetLang,
            sourceLang
          }),
          timeoutPromise
        ]);

        if (!res || typeof res !== 'object') {
          throw new Error('No response from the service worker');
        }
        if (!res.ok) {
          throw new Error(res.error || 'Translation request failed');
        }
        if (!Array.isArray(res.translations) || res.translations.length !== texts.length) {
          throw new Error('Mismatched translation count from service worker');
        }

        return res.translations.map(function (item) {
          return typeof item === 'string' ? item.trim() : '';
        });
      } finally {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }
    }

    return requestGoogleFallback(texts, targetLang, sourceLang);
  }

  /**
   * Translate an array of Japanese lyric lines into the requested target language.
   * Deduplicates identical lines per call, skips non-letter lines, serves hits
   * from a 400-entry LRU-like FIFO cache, and never rejects on failure.
   * @param {string[]} lines - Array of Japanese lyric strings
   * @param {{targetLang: string, sourceLang?: string}} options - Translation options
   * @returns {Promise<string[]>} Translated strings of the same length and order as `lines`
   */
  async function translateLines(lines, options) {
    if (!Array.isArray(lines)) return [];
    if (lines.length === 0) return [];

    const opts = options && typeof options === 'object' ? options : {};
    const targetLang = typeof opts.targetLang === 'string' ? opts.targetLang.trim() : '';
    const sourceLang = typeof opts.sourceLang === 'string' && opts.sourceLang.trim()
      ? opts.sourceLang.trim()
      : DEFAULT_SOURCE_LANG;

    if (!targetLang) {
      return lines.map(function () {
        return '';
      });
    }

    const results = new Array(lines.length).fill('');
    const missingTexts = [];
    const missingIndexMap = new Map();

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!isTranslatableLine(rawLine)) {
        results[i] = '';
        continue;
      }

      const key = buildCacheKey(targetLang, rawLine);
      if (cache.has(key)) {
        results[i] = cache.get(key);
        continue;
      }

      if (!missingIndexMap.has(rawLine)) {
        missingIndexMap.set(rawLine, [i]);
        missingTexts.push(rawLine);
      } else {
        missingIndexMap.get(rawLine).push(i);
      }
    }

    if (missingTexts.length === 0) {
      return results;
    }

    try {
      const translatedUnique = await requestTranslations(missingTexts, targetLang, sourceLang);

      for (let j = 0; j < missingTexts.length; j++) {
        const sourceText = missingTexts[j];
        const translatedText = typeof translatedUnique[j] === 'string' ? translatedUnique[j] : '';
        const key = buildCacheKey(targetLang, sourceText);
        cacheSet(key, translatedText);

        const indices = missingIndexMap.get(sourceText) || [];
        for (const idx of indices) {
          results[idx] = translatedText;
        }
      }

      return results;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.warn('[Utagoe] Translation failed:', message);
      return lines.map(function () {
        return '';
      });
    }
  }

  return {
    translateLines,
    clearCache,
    SUPPORTED_LANGUAGES
  };
});
