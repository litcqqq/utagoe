/**
 * Spotify Japanese Lyrics Romaji Extension
 * Stacked Romaji lyrics directly above Kanji/Kana original lyrics.
 * Includes 3-Tier Validation & Correction:
 *  - Tier 1: Lrclib Community-Verified Human Romaji
 *  - Tier 2: Local Song Ateji & Particle Rulebook
 *  - Tier 3: User Custom Dictionary Overrides
 */

(function () {
  'use strict';

  // State & Settings
  const state = {
    enabled: true,
    romajiSystem: 'hepburn', // 'hepburn' | 'passport'
    fontSizeRatio: 0.65,     // 0.50 - 0.90
    casing: 'normal',        // 'normal' | 'lowercase'
    enableValidator: true,   // Lrclib community validator
    enableAteji: true,       // Built-in song ateji rules
    customOverrides: {},     // User custom word mappings { kanji: romaji }
    
    // Runtime track & validator state
    currentTrackTitle: '',
    currentArtist: '',
    verifiedLyrics: null,    // Lrclib verified lines if available
    currentSource: 'kuroshiro', // 'lrclib' | 'kuroshiro'

    kuroshiroReady: false,
    kuroshiroLoading: false,
    conversionQueue: new Map(),
    cache: new Map()
  };

  let kuroshiro = null;
  let analyzer = null;

  // Detect Japanese characters (Kanji, Hiragana, Katakana)
  const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  function hasJapanese(text) {
    return JAPANESE_CHAR_REGEX.test(text);
  }

  // Clean and format Romaji output
  function cleanRomaji(str) {
    if (!str) return '';
    return str
      .replace(/\s+([,.\?!:;\)\]\}])/g, '$1')
      .replace(/([\(\[\{])\s+/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Extract Track Title and Artist from Spotify DOM
  function getSpotifyTrackInfo() {
    let title = '';
    let artist = '';

    const titleEl = document.querySelector('[data-testid="context-item-info-title"]');
    if (titleEl) {
      title = titleEl.innerText?.trim() || '';
    }

    const artistEl = document.querySelector('[data-testid="context-item-info-artist"], [data-testid="context-item-info-subtitles"]');
    if (artistEl) {
      artist = artistEl.innerText?.trim() || '';
    }

    if (!title) {
      const parts = document.title.split(/[•\-–—|]/).map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'spotify');
      if (parts.length >= 2) {
        title = parts[0];
        artist = parts[1];
      }
    }

    return { title, artist };
  }

  // Check track changes and query Lrclib validator
  async function checkTrackUpdate() {
    const { title, artist } = getSpotifyTrackInfo();
    if (!title) return;

    if (title === state.currentTrackTitle && artist === state.currentArtist) {
      return;
    }

    state.currentTrackTitle = title;
    state.currentArtist = artist;
    state.verifiedLyrics = null;
    state.currentSource = 'kuroshiro';

    if (state.enableValidator && window.LyricsValidator) {
      try {
        const verified = await window.LyricsValidator.searchVerifiedLyrics(title, artist);
        if (verified && (verified.syncedLines || verified.plainLines)) {
          state.verifiedLyrics = verified;
          state.currentSource = 'lrclib';
          console.log(`[Spotify-Romaji] Verified community lyrics found for "${title}" via Lrclib!`);
        }
      } catch (err) {
        console.warn('[Spotify-Romaji] Validator check error:', err);
      }
    }

    // Save status for popup badge
    chrome.storage.local.set({
      lastTrackStatus: {
        title: state.currentTrackTitle,
        artist: state.currentArtist,
        source: state.currentSource
      }
    });

    scheduleScan();
  }

  // Initialize Kuroshiro with local Kuromoji dictionary
  async function initKuroshiro() {
    if (state.kuroshiroReady) return true;
    if (state.kuroshiroLoading) return false;

    state.kuroshiroLoading = true;

    try {
      if (typeof window.Kuroshiro === 'undefined' || typeof window.KuromojiAnalyzer === 'undefined') {
        state.kuroshiroLoading = false;
        return false;
      }

      kuroshiro = new window.Kuroshiro();
      const dictPath = chrome.runtime.getURL('dict/');
      analyzer = new window.KuromojiAnalyzer({ dictPath });

      await kuroshiro.init(analyzer);
      state.kuroshiroReady = true;
      state.kuroshiroLoading = false;
      console.log('[Spotify-Romaji] Morphological engine ready with local dictionary.');
      
      scanAndProcessLyrics();
      return true;
    } catch (err) {
      console.error('[Spotify-Romaji] Failed to initialize Kuroshiro:', err);
      state.kuroshiroLoading = false;
      return false;
    }
  }

  // Convert a single line with caching & Ateji / Overrides
  async function convertToRomaji(japaneseText, lineIndex) {
    // 1. Check Lrclib verified community lyrics first
    if (state.verifiedLyrics) {
      const v = state.verifiedLyrics;
      let verifiedLine = '';
      if (v.syncedLines && v.syncedLines[lineIndex]) {
        verifiedLine = v.syncedLines[lineIndex].text;
      } else if (v.plainLines && v.plainLines[lineIndex]) {
        verifiedLine = v.plainLines[lineIndex];
      }

      if (verifiedLine && verifiedLine.length > 0) {
        // Apply any user custom overrides on top of community lyrics if desired
        if (window.LyricAteji) {
          verifiedLine = window.LyricAteji.applyAtejiAndOverrides(
            japaneseText,
            verifiedLine,
            state.customOverrides,
            false // Ateji already in community lyrics
          );
        }
        return cleanRomaji(verifiedLine);
      }
    }

    // 2. Fallback to Kuroshiro + Ateji engine
    const cacheKey = `${japaneseText}:${state.romajiSystem}:${JSON.stringify(state.customOverrides)}:${state.enableAteji}`;
    if (state.cache.has(cacheKey)) {
      return state.cache.get(cacheKey);
    }

    if (state.conversionQueue.has(cacheKey)) {
      return state.conversionQueue.get(cacheKey);
    }

    if (!state.kuroshiroReady) {
      await initKuroshiro();
      if (!state.kuroshiroReady) return null;
    }

    const task = (async () => {
      try {
        const rawResult = await kuroshiro.convert(japaneseText, {
          to: 'romaji',
          mode: 'spaced',
          romajiSystem: state.romajiSystem
        });

        let formatted = cleanRomaji(rawResult);

        // Apply Layer 2 (Ateji) & Layer 3 (User Overrides)
        if (window.LyricAteji) {
          formatted = window.LyricAteji.applyAtejiAndOverrides(
            japaneseText,
            formatted,
            state.customOverrides,
            state.enableAteji
          );
        }

        state.cache.set(cacheKey, formatted);
        return formatted;
      } catch (err) {
        console.error('[Spotify-Romaji] Conversion error for line:', japaneseText, err);
        return null;
      } finally {
        state.conversionQueue.delete(cacheKey);
      }
    })();

    state.conversionQueue.set(cacheKey, task);
    return task;
  }

  // Apply CSS variables to root
  function updateCSSVariables() {
    document.documentElement.style.setProperty(
      '--spotify-romaji-font-size',
      `${state.fontSizeRatio}em`
    );
    if (state.enabled) {
      document.body.classList.remove('spotify-romaji-disabled');
    } else {
      document.body.classList.add('spotify-romaji-disabled');
    }
  }

  // Extract original text from line element
  function extractOriginalText(lineEl) {
    const existingRomaji = lineEl.querySelector('.spotify-romaji-line');
    let text = '';
    for (let node of lineEl.childNodes) {
      if (node !== existingRomaji && node.textContent) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  // Process a single lyric line element
  async function processLineElement(lineEl, index) {
    if (!state.enabled) {
      const existing = lineEl.querySelector('.spotify-romaji-line');
      if (existing) existing.remove();
      lineEl.removeAttribute('data-has-romaji');
      return;
    }

    const originalText = extractOriginalText(lineEl);
    if (!originalText || !hasJapanese(originalText)) {
      return;
    }

    lineEl.setAttribute('data-has-romaji', 'true');

    const romaji = await convertToRomaji(originalText, index);
    if (!romaji) return;

    let displayRomaji = romaji;
    if (state.casing === 'lowercase') {
      displayRomaji = displayRomaji.toLowerCase();
    }

    let romajiEl = lineEl.querySelector('.spotify-romaji-line');
    if (!romajiEl) {
      romajiEl = document.createElement('div');
      romajiEl.className = 'spotify-romaji-line';
      romajiEl.setAttribute('dir', 'auto');
      romajiEl.setAttribute('aria-hidden', 'true');
      lineEl.prepend(romajiEl);
    }

    if (romajiEl.textContent !== displayRomaji) {
      romajiEl.textContent = displayRomaji;
    }
  }

  // Find all lyric lines
  function getLyricLines() {
    let lines = Array.from(document.querySelectorAll(
      '[data-testid="lyrics-line"], [data-testid="fullscreen-lyric-line"], .lyrics-lyricsContent-lyric'
    ));

    if (lines.length > 0) {
      return lines;
    }

    const container = document.querySelector(
      '[data-testid="lyrics-container"], [data-testid="fullscreen-lyric"], .lyrics-lyricsContainer-LyricsBackground'
    );

    if (container) {
      const candidates = Array.from(container.querySelectorAll('div[dir="auto"], p[dir="auto"]'));
      return candidates.filter(el => {
        const text = el.innerText?.trim();
        return text && text.length > 0 && el.childElementCount <= 2;
      });
    }

    return [];
  }

  // Scan and process all visible lyric lines
  function scanAndProcessLyrics() {
    checkTrackUpdate();

    const lines = getLyricLines();
    if (lines.length === 0) return;

    let foundJapanese = false;
    for (const line of lines) {
      const text = extractOriginalText(line);
      if (hasJapanese(text)) {
        foundJapanese = true;
        break;
      }
    }

    if (foundJapanese && !state.kuroshiroReady && !state.kuroshiroLoading) {
      initKuroshiro();
    }

    lines.forEach((line, index) => {
      processLineElement(line, index);
    });
  }

  let scanTimeout = null;
  function scheduleScan() {
    if (scanTimeout) cancelAnimationFrame(scanTimeout);
    scanTimeout = requestAnimationFrame(() => {
      scanAndProcessLyrics();
    });
  }

  // Setup DOM MutationObserver
  function initObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.matches?.('[data-testid="lyrics-line"], [data-testid="fullscreen-lyric-line"], [data-testid="lyrics-container"], [data-testid="fullscreen-lyric"], [data-testid="now-playing-widget"]') ||
                node.querySelector?.('[data-testid="lyrics-line"], [data-testid="fullscreen-lyric-line"], [dir="auto"]')
              ) {
                shouldScan = true;
                break;
              }
            }
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        scheduleScan();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(() => {
      checkTrackUpdate();
      const lines = getLyricLines();
      if (lines.length > 0) {
        const needsProcessing = lines.some(line => {
          const text = extractOriginalText(line);
          return hasJapanese(text) && !line.querySelector('.spotify-romaji-line');
        });
        if (needsProcessing) {
          scheduleScan();
        }
      }
    }, 1500);
  }

  // Load and listen to settings
  function initSettings() {
    chrome.storage.local.get([
      'enabled',
      'romajiSystem',
      'fontSizeRatio',
      'casing',
      'enableValidator',
      'enableAteji',
      'customOverrides'
    ], (res) => {
      if (res.enabled !== undefined) state.enabled = res.enabled;
      if (res.romajiSystem) state.romajiSystem = res.romajiSystem;
      if (res.fontSizeRatio !== undefined) state.fontSizeRatio = res.fontSizeRatio;
      if (res.casing) state.casing = res.casing;
      if (res.enableValidator !== undefined) state.enableValidator = res.enableValidator;
      if (res.enableAteji !== undefined) state.enableAteji = res.enableAteji;
      if (res.customOverrides) state.customOverrides = res.customOverrides;

      updateCSSVariables();
      scheduleScan();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      let needsReconversion = false;

      if (changes.enabled) {
        state.enabled = changes.enabled.newValue;
        updateCSSVariables();
        if (!state.enabled) {
          document.querySelectorAll('.spotify-romaji-line').forEach(el => el.remove());
          document.querySelectorAll('[data-has-romaji]').forEach(el => el.removeAttribute('data-has-romaji'));
        } else {
          needsReconversion = true;
        }
      }

      if (changes.fontSizeRatio) {
        state.fontSizeRatio = changes.fontSizeRatio.newValue;
        updateCSSVariables();
      }

      if (changes.romajiSystem) {
        state.romajiSystem = changes.romajiSystem.newValue;
        needsReconversion = true;
      }

      if (changes.casing) {
        state.casing = changes.casing.newValue;
        needsReconversion = true;
      }

      if (changes.enableValidator) {
        state.enableValidator = changes.enableValidator.newValue;
        state.verifiedLyrics = null;
        needsReconversion = true;
      }

      if (changes.enableAteji) {
        state.enableAteji = changes.enableAteji.newValue;
        needsReconversion = true;
      }

      if (changes.customOverrides) {
        state.customOverrides = changes.customOverrides.newValue || {};
        needsReconversion = true;
      }

      if (needsReconversion && state.enabled) {
        state.cache.clear();
        scheduleScan();
      }
    });
  }

  // Bootstrapping
  function start() {
    initSettings();
    initObserver();
    scheduleScan();
    console.log('[Spotify-Romaji] Extension active with 3-Layer Validator pipeline.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
