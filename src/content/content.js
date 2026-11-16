/**
 * Ekstensi Lirik Romaji Jepang untuk Spotify Web & YouTube Music
 * Menampilkan Romaji bertingkat tepat di atas lirik asli Kanji/Kana.
 * Dilengkapi Validasi & Koreksi 3 Lapis:
 *  - Lapis 1: Lirik Romaji komunitas terverifikasi via Lrclib
 *  - Lapis 2: Kamus Ateji & partikel lagu lokal
 *  - Lapis 3: Kamus koreksi kustom pengguna
 */

(function () {
  'use strict';

  const state = {
    enabled: true,
    romajiSystem: 'hepburn', // 'hepburn' | 'passport'
    fontSizeRatio: 0.65,     // 0.50 - 0.90
    casing: 'normal',        // 'normal' | 'lowercase'
    enableValidator: true,
    enableAteji: true,
    customOverrides: {},

    currentTrackTitle: '',
    currentArtist: '',
    verifiedLyrics: null,
    currentSource: 'kuroshiro',

    kuroshiroReady: false,
    kuroshiroLoading: false,
    conversionQueue: new Map(),
    cache: new Map()
  };

  let kuroshiro = null;
  let analyzer = null;
  let kuroshiroInitPromise = null;
  let kuroshiroFailedAt = 0;
  const KUROSHIRO_RETRY_MS = 30000;

  let observer = null;
  let pollInterval = null;
  let tornDown = false;

  // After the extension is reloaded or updated, the old content script keeps running
  // but every chrome.* call throws "Extension context invalidated".
  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    if (observer) observer.disconnect();
    if (pollInterval) clearInterval(pollInterval);
    if (scanTimeout) cancelAnimationFrame(scanTimeout);
  }

  function ensureContext() {
    if (isContextValid()) return true;
    teardown();
    return false;
  }

  function safeStorageSet(items) {
    if (!ensureContext()) return;
    try {
      const result = chrome.storage.local.set(items);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (e) {
      teardown();
    }
  }

  const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  function hasJapanese(text) {
    return JAPANESE_CHAR_REGEX.test(text || '');
  }

  function cleanRomaji(str) {
    if (!str) return '';
    return str
      .replace(/\s+([,.\?!:;\)\]\}])/g, '$1')
      .replace(/([\(\[\{])\s+/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Pilih adaptor situs yang cocok dengan URL aktif
  function getActiveAdapter() {
    const adapters = window.SiteAdapters || [
      window.SpotifySiteAdapter,
      window.YouTubeMusicSiteAdapter
    ].filter(Boolean);
    const url = window.location ? window.location.href : '';
    return adapters.find(adapter => adapter && adapter.matches(url)) || null;
  }

  function clearActiveRomaji(adapter, container) {
    const targetAdapter = adapter || getActiveAdapter();
    if (targetAdapter && typeof targetAdapter.clearRomaji === 'function') {
      const targetContainer = container || targetAdapter.getLyricsContainer(document);
      targetAdapter.clearRomaji(targetContainer, document);
      return;
    }
    document.querySelectorAll('.spotify-romaji-line').forEach(el => el.remove());
    document.querySelectorAll('[data-has-romaji]').forEach(el => el.removeAttribute('data-has-romaji'));
  }

  // Periksa pergantian lagu dan kueri validator Lrclib
  async function checkTrackUpdate() {
    const adapter = getActiveAdapter();
    if (!adapter) return;

    const { title, artist } = adapter.getTrackInfo(document);
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
          clearActiveRomaji(adapter);
        }
      } catch (err) {
        if (!ensureContext()) return;
        console.warn('[Lyrics-Romaji] Validator check error:', err);
      }
    }

    safeStorageSet({
      lastTrackStatus: {
        title: state.currentTrackTitle,
        artist: state.currentArtist,
        source: state.currentSource
      }
    });

    scheduleScan();
  }

  // Inisialisasi Kuroshiro dengan kamus Kuromoji lokal
  async function initKuroshiro() {
    if (state.kuroshiroReady) return true;
    if (kuroshiroInitPromise) return kuroshiroInitPromise;
    // Don't hammer a failing init on every DOM mutation; retry after a cooldown.
    if (kuroshiroFailedAt && Date.now() - kuroshiroFailedAt < KUROSHIRO_RETRY_MS) return false;
    if (!ensureContext()) return false;

    state.kuroshiroLoading = true;

    kuroshiroInitPromise = (async () => {
      try {
        if (typeof window.Kuroshiro === 'undefined' || typeof window.KuromojiAnalyzer === 'undefined') {
          kuroshiroFailedAt = Date.now();
          return false;
        }

        kuroshiro = new window.Kuroshiro();
        const dictPath = chrome.runtime.getURL('dict/');
        analyzer = new window.KuromojiAnalyzer({ dictPath });

        await kuroshiro.init(analyzer);
        state.kuroshiroReady = true;
        kuroshiroFailedAt = 0;
        return true;
      } catch (err) {
        kuroshiroFailedAt = Date.now();
        if (!isContextValid()) {
          teardown();
          return false;
        }
        const detail = err && err.message ? err.message : String(err);
        console.error('[Lyrics-Romaji] Failed to initialize Kuroshiro:', detail);
        return false;
      } finally {
        state.kuroshiroLoading = false;
        kuroshiroInitPromise = null;
      }
    })();

    return kuroshiroInitPromise;
  }

  // Konversi satu baris lirik dengan cache, Ateji, dan kamus pengguna
  async function convertToRomaji(japaneseText, lineIndex) {
    if (state.verifiedLyrics) {
      const v = state.verifiedLyrics;
      let verifiedLine = '';
      if (v.syncedLines && v.syncedLines[lineIndex]) {
        verifiedLine = v.syncedLines[lineIndex].text;
      } else if (v.plainLines && v.plainLines[lineIndex]) {
        verifiedLine = v.plainLines[lineIndex];
      }

      if (verifiedLine && verifiedLine.length > 0) {
        if (window.LyricAteji) {
          verifiedLine = window.LyricAteji.applyAtejiAndOverrides(
            japaneseText,
            verifiedLine,
            state.customOverrides,
            false
          );
        }
        return cleanRomaji(verifiedLine);
      }
    }

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
        console.error('[Lyrics-Romaji] Conversion error for line:', japaneseText, err);
        return null;
      } finally {
        state.conversionQueue.delete(cacheKey);
      }
    })();

    state.conversionQueue.set(cacheKey, task);
    return task;
  }

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

  // Pindai dan proses seluruh baris lirik yang tampak melalui adaptor situs aktif
  async function scanAndProcessLyrics() {
    if (!ensureContext()) return;
    const adapter = getActiveAdapter();
    if (!adapter) return;

    checkTrackUpdate();

    const container = adapter.getLyricsContainer(document);
    if (!container) return;

    if (!state.enabled) {
      clearActiveRomaji(adapter, container);
      return;
    }

    if (typeof adapter.needsProcessing === 'function' && !adapter.needsProcessing(container, hasJapanese)) {
      return;
    }

    const rawLines = adapter.getLyricLines(container, document);
    if (!rawLines || rawLines.length === 0) return;

    const foundJapanese = rawLines.some(line => hasJapanese(line));
    if (!foundJapanese) return;

    if (!state.kuroshiroReady) {
      const ready = await initKuroshiro();
      if (!ready) return;
    }

    let lyricIndex = 0;
    const convertedLines = await Promise.all(
      rawLines.map(async (text) => {
        const trimmed = (text || '').trim();
        if (!trimmed) {
          return { text: text || '', romaji: '' };
        }
        const idx = lyricIndex++;
        if (!hasJapanese(trimmed)) {
          return { text, romaji: '' };
        }
        const romaji = await convertToRomaji(trimmed, idx);
        if (!romaji) {
          return { text, romaji: '' };
        }
        const displayRomaji = state.casing === 'lowercase' ? romaji.toLowerCase() : romaji;
        return { text, romaji: displayRomaji };
      })
    );

    if (!state.enabled) return;
    adapter.applyRomaji(container, convertedLines);
  }

  let scanTimeout = null;
  function scheduleScan() {
    if (tornDown) return;
    if (scanTimeout) cancelAnimationFrame(scanTimeout);
    scanTimeout = requestAnimationFrame(() => {
      scanAndProcessLyrics().catch(err => {
        if (!isContextValid()) {
          teardown();
          return;
        }
        console.warn('[Lyrics-Romaji] Scan error:', err);
      });
    });
  }

  function initObserver() {
    const adapter = getActiveAdapter();
    if (adapter && typeof adapter.setupNavigationHooks === 'function') {
      adapter.setupNavigationHooks(scheduleScan, document);
    }

    observer = new MutationObserver((mutations) => {
      if (!ensureContext()) return;
      const currentAdapter = getActiveAdapter();
      if (!currentAdapter) return;

      let shouldScan = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                typeof currentAdapter.shouldTriggerOnMutation === 'function' &&
                currentAdapter.shouldTriggerOnMutation(node)
              ) {
                shouldScan = true;
                break;
              }
            }
          }
        } else if (
          m.type === 'attributes' &&
          m.attributeName === 'aria-selected' &&
          m.target &&
          m.target.getAttribute('aria-selected') === 'true' &&
          typeof currentAdapter.isLyricsTab === 'function' &&
          currentAdapter.isLyricsTab(m.target)
        ) {
          shouldScan = true;
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        scheduleScan();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected']
    });

    // Polling cadangan yang ringan: keluar lebih awal jika shelf/kontainer lirik tidak ada
    pollInterval = setInterval(() => {
      if (!ensureContext()) return;
      const currentAdapter = getActiveAdapter();
      if (!currentAdapter) return;

      const container = currentAdapter.getLyricsContainer(document);
      if (!container) return;

      checkTrackUpdate();

      if (
        state.enabled &&
        typeof currentAdapter.needsProcessing === 'function' &&
        currentAdapter.needsProcessing(container, hasJapanese)
      ) {
        scheduleScan();
      }
    }, 1500);
  }

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
          clearActiveRomaji();
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
        clearActiveRomaji();
        scheduleScan();
      }
    });
  }

  function start() {
    initSettings();
    initObserver();
    scheduleScan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
