/**
 * Utagoe - Japanese Lyrics Romaji for Spotify Web & YouTube Music
 * Renders Romaji stacked directly above the original Kanji/Kana lyrics.
 * Backed by a 3-layer validation and correction pipeline:
 *  - Layer 1: Community-verified Romaji lyrics from Lrclib
 *  - Layer 2: Local ateji and lyric-particle dictionary
 *  - Layer 3: User-defined custom correction dictionary
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

    outputMode: 'romaji',        // 'romaji' | 'hiragana' | 'katakana' | 'furigana'
    tapToFix: true,              // tap a word to correct its reading
    showBadges: true,            // per-line confidence dot
    translationEnabled: false,   // stacked translation line
    translationLang: 'en',

    currentTrackTitle: '',
    currentArtist: '',
    verifiedLyrics: null,
    currentSource: 'kuroshiro',
    lastLines: [],               // last rendered lines, for vocabulary export

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

  // Pick the site adapter matching the current URL
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

  // Detect track changes and query the Lrclib validator
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
    clearActiveRomaji(adapter);

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

  // Initialize Kuroshiro with the bundled Kuromoji dictionary
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
        // The reading engine shares the same dictionary instance so tokenising,
        // furigana, tap-to-fix and export all read from one analysis.
        if (window.LyricReadings) window.LyricReadings.init(kuroshiro);
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

  // Convert a single lyric line using the cache, ateji rules, and the user dictionary
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

  // Decide how a line's words are laid out for the active output mode. Returns
  // both the plain text (what the adapters compare for idempotency) and the
  // rich markup, so a re-render can never disagree with the cached text.
  function buildLineView(tokens, casing) {
    const mode = state.outputMode;
    const withCasing = (value) => (casing === 'lowercase' ? value.toLowerCase() : value);

    if (mode === 'furigana') {
      const plain = tokens.map((t) => t.kana).join('');
      const html = tokens.map((token) => {
        const surface = escapeHtml(token.surface);
        if (!token.hasKanji || !token.kana || token.kana === token.surface) {
          return `<span class="utagoe-word" data-surface="${escapeHtml(token.surface)}">${surface}</span>`;
        }
        return `<span class="utagoe-word" data-surface="${escapeHtml(token.surface)}">` +
          `<ruby>${surface}<rt>${escapeHtml(token.kana)}</rt></ruby></span>`;
      }).join('');
      return { text: plain, html };
    }

    if (mode === 'hiragana' || mode === 'katakana') {
      const convert = mode === 'katakana' ? window.LyricReadings.toKatakana : (v) => v;
      const parts = tokens.map((t) => {
        const kana = convert(t.kana);
        const label = escapeHtml(kana);
        return `<span class="utagoe-word" data-surface="${escapeHtml(t.surface)}">${label}</span>`;
      });
      const plain = tokens.map((t) => convert(t.kana)).join('');
      return { text: withCasing(plain), html: parts.join('') };
    }

    // Romaji: Japanese punctuation sticks to the word before it rather than
    // floating on its own with spaces around it.
    const pieces = [];
    let plain = '';
    for (const token of tokens) {
      if (!window.LyricReadings.hasJapanese(token.surface)) {
        pieces.push(escapeHtml(token.romaji));
        plain += token.romaji;
        continue;
      }
      const needsSpace = plain && !plain.endsWith(' ');
      if (needsSpace) plain += ' ';
      plain += token.romaji;
      const label = escapeHtml(token.romaji);
      pieces.push((needsSpace ? ' ' : '') +
        `<span class="utagoe-word" data-surface="${escapeHtml(token.surface)}">${label}</span>`);
    }

    const trimmed = plain.trim().replace(/\s+([,.!?;:])/g, '$1');
    return { text: withCasing(trimmed), html: pieces.join('') };
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Turn every visible lyric line into tokens, then into display lines.
  async function buildConvertedLines(rawLines) {
    const results = new Array(rawLines.length);
    let lyricIndex = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const text = rawLines[i] || '';
      const trimmed = text.trim();

      if (!trimmed || !hasJapanese(trimmed)) {
        results[i] = { text, romaji: '', output: '', html: '', badge: '', translation: '' };
        continue;
      }

      const idx = lyricIndex++;
      const verified = Boolean(state.verifiedLyrics);
      const tokens = window.LyricReadings
        ? await window.LyricReadings.tokenize(trimmed, {
            romajiSystem: state.romajiSystem,
            customOverrides: state.customOverrides,
            enableAteji: state.enableAteji,
            verified
          })
        : [];

      if (!tokens || tokens.length === 0) {
        results[i] = { text, romaji: '', output: '', html: '', badge: '', translation: '' };
        continue;
      }

      const view = buildLineView(tokens, state.casing);
      // `romaji` stays the plain romaji string because the adapters and the
      // idempotency check still compare against it.
      const romajiText = state.outputMode === 'romaji'
        ? view.text
        : (await convertToRomaji(trimmed, idx)) || '';

      results[i] = {
        text,
        romaji: romajiText,
        output: view.text,
        html: view.html,
        mode: state.outputMode,
        confBadge: state.showBadges ? window.LyricReadings.lineConfidence(tokens) : '',
        translation: '',
        tokens
      };
    }

    return results;
  }

  // Fill in translations for the lines that need them. Failure is silent: a
  // missing translation must never take the romaji line down with it.
  async function attachTranslations(lines) {
    if (!state.translationEnabled || !window.LyricTranslate) return lines;

    const sources = lines.map((line) => (line.tokens && line.tokens.length ? line.text : ''));
    if (!sources.some(Boolean)) return lines;

    try {
      const translated = await window.LyricTranslate.translateLines(sources, {
        targetLang: state.translationLang
      });
      for (let i = 0; i < lines.length; i++) {
        const value = translated[i];
        if (typeof value === 'string' && value.trim()) lines[i].translation = value.trim();
      }
    } catch (err) {
      console.warn('[Utagoe] Translation unavailable:', err && err.message);
    }

    return lines;
  }

  /**
   * The site adapters own the plain stacked romaji line. Everything that needs
   * structure the adapters do not model — rich markup per word, the confidence
   * dot, the translation line, and tap targets — is attached here afterwards,
   * by locating the romaji elements the adapter just wrote and upgrading them
   * in place. Keeping this separate means a site redesign only breaks one
   * unwrapping rule instead of the whole render path.
   */
  function applyInteractionLayer(lines) {
    const needsRich = state.outputMode !== 'romaji' || state.translationEnabled ||
      state.showBadges || state.tapToFix;
    if (!needsRich) return;

    const doc = document;
    const romajiEls = Array.from(doc.querySelectorAll('.spotify-romaji-line'));

    for (const el of romajiEls) {
      // Pair by stamped index, not by position: empty lyric rows create no
      // romaji element, so a positional walk would drift out of sync.
      const raw = el.getAttribute('data-line-index');
      const index = raw === null ? NaN : Number(raw);
      const line = Number.isInteger(index) ? lines[index] : null;
      if (!line || !line.tokens || line.tokens.length === 0) continue;

      upgradeRomajiElement(el, line, doc);
      applyTranslationLine(el, line, doc);
      applyConfidenceBadge(el, line, doc);
    }

    if (state.tapToFix) bindTapHandler(doc);
  }

  // Replace the adapter's plain text with per-word markup so words can be
  // addressed individually, and switch to ruby markup in furigana mode.
  function upgradeRomajiElement(el, line, doc) {
    const wantHtml = line.html || '';

    // Marked managed so the site adapter stops overwriting textContent with the
    // plain romaji once richer markup is in place.
    if (wantHtml) el.setAttribute('data-utagoe-managed', 'true');

    // Compare the markup itself, never a signature: the site adapter rewrites
    // textContent on each pass, so a signature-only guard would leave the plain
    // romaji in place and the richer markup would never be restored.
    if (wantHtml && el.innerHTML !== wantHtml) {
      el.innerHTML = wantHtml;
    }

    if (line.mode === 'furigana') {
      el.classList.add('utagoe-furigana');
    } else {
      el.classList.remove('utagoe-furigana');
    }
  }

  // The translation line sits below the original text, which visually groups it
  // with the lyric it explains rather than with the romaji above it.
  function applyTranslationLine(romajiEl, line, doc) {
    const parent = romajiEl.parentElement;
    if (!parent) return;

    let el = parent.querySelector(':scope > .utagoe-translation-line');
    const text = line.translation || '';

    if (!text) {
      if (el) el.remove();
      return;
    }

    if (!el) {
      el = doc.createElement('div');
      el.className = 'utagoe-translation-line';
      el.setAttribute('dir', 'auto');
      el.setAttribute('aria-hidden', 'true');
      parent.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }

  const BADGE_LABELS = {
    verified: 'Verified lyrics from Lrclib',
    user: 'Reading from your own corrections',
    dictionary: 'Reading from the ateji dictionary',
    auto: 'Machine reading, may be inaccurate'
  };

  function applyConfidenceBadge(romajiEl, line, doc) {
    const parent = romajiEl.parentElement;
    if (!parent) return;

    const existing = parent.querySelector(':scope > .utagoe-badge');
    const source = line.confBadge;

    if (!state.showBadges || !source) {
      if (existing) existing.remove();
      return;
    }

    const badge = existing || doc.createElement('span');
    if (!existing) {
      badge.className = 'utagoe-badge';
      parent.appendChild(badge);
    }
    badge.setAttribute('data-source', source);
    badge.title = BADGE_LABELS[source] || BADGE_LABELS.auto;
    badge.textContent = '';
  }

  let tapHandlerBound = false;

  function bindTapHandler(doc) {
    if (tapHandlerBound) return;
    tapHandlerBound = true;

    doc.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const word = target.closest('.utagoe-word');
      if (!word) return;

      const surface = word.getAttribute('data-surface');
      if (!surface || !hasJapanese(surface)) return;

      // The lyrics list seeks on click; a correction tap must not jump the track.
      event.preventDefault();
      event.stopPropagation();

      openReadingEditor(word, surface, doc);
    }, true);
  }

  /**
   * Inline editor instead of window.prompt: prompt() is blocked in some
   * embedded contexts and cannot be styled or dismissed by tapping away.
   */
  function openReadingEditor(wordEl, surface, doc) {
    closeReadingEditor(doc);

    const current = state.customOverrides[surface] || '';
    const rect = wordEl.getBoundingClientRect ? wordEl.getBoundingClientRect() : null;

    const pop = doc.createElement('div');
    pop.className = 'utagoe-editor';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Fix reading for ' + surface);
    if (rect) {
      pop.style.setProperty('--utagoe-editor-top', `${Math.round(rect.bottom + 6)}px`);
      pop.style.setProperty('--utagoe-editor-left', `${Math.round(rect.left)}px`);
    }

    const title = doc.createElement('div');
    title.className = 'utagoe-editor-title';
    title.textContent = surface;
    pop.appendChild(title);

    const input = doc.createElement('input');
    input.className = 'utagoe-editor-input';
    input.type = 'text';
    input.value = current;
    input.placeholder = 'reading, e.g. sadame';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    pop.appendChild(input);

    const actions = doc.createElement('div');
    actions.className = 'utagoe-editor-actions';

    const save = doc.createElement('button');
    save.className = 'utagoe-editor-save';
    save.type = 'button';
    save.textContent = 'Save';

    const cancel = doc.createElement('button');
    cancel.className = 'utagoe-editor-cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';

    actions.appendChild(save);
    actions.appendChild(cancel);
    pop.appendChild(actions);
    doc.body.appendChild(pop);

    const commit = () => {
      const value = input.value.trim();
      const next = Object.assign({}, state.customOverrides);
      if (value) {
        next[surface] = value;
      } else {
        delete next[surface];
      }
      state.customOverrides = next;
      safeStorageSet({ customOverrides: next });
      closeReadingEditor(doc);
      // Storage listeners do not fire in the same document, so re-render here.
      state.cache.clear();
      scheduleScan();
    };

    save.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      commit();
    });

    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeReadingEditor(doc);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeReadingEditor(doc);
      }
    });

    setTimeout(() => {
      if (typeof input.focus === 'function') input.focus();
      if (typeof input.select === 'function') input.select();
    }, 0);
  }

  function closeReadingEditor(doc) {
    const existing = (doc || document).querySelectorAll('.utagoe-editor');
    existing.forEach((el) => el.remove());
  }

  /**
   * Export the currently displayed song's kanji vocabulary as a CSV. Exposed on
   * the page as LyricRomaji.exportVocabulary() so the popup can trigger it with
   * a single message, keeping the DOM knowledge in the content script.
   */
  function exportVocabulary() {
    if (!window.LyricExport || !window.LyricReadings) return false;

    const words = window.LyricReadings.collectVocabulary(state.lastLines);
    if (words.length === 0) return false;

    const csv = window.LyricExport.buildCsv(words, {
      songTitle: state.currentTrackTitle,
      artist: state.currentArtist
    });
    const filename = window.LyricExport.suggestFilename(
      state.currentTrackTitle,
      state.currentArtist
    );
    window.LyricExport.downloadCsv(csv, filename);
    return true;
  }

  // Scan and process every visible lyric line through the active site adapter
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
    if (!rawLines || rawLines.length === 0) {
      clearActiveRomaji(adapter, container);
      return;
    }

    const foundJapanese = rawLines.some(line => hasJapanese(line));
    if (!foundJapanese) {
      clearActiveRomaji(adapter, container);
      return;
    }

    if (!state.kuroshiroReady) {
      const ready = await initKuroshiro();
      if (!ready) return;
    }

    const convertedLines = await buildConvertedLines(rawLines);
    await attachTranslations(convertedLines);

    if (!state.enabled) return;
    state.lastLines = convertedLines.filter((line) => line.tokens && line.tokens.length);
    adapter.applyRomaji(container, convertedLines);
    applyInteractionLayer(convertedLines);
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
        if (m.type === 'childList') {
          if (
            m.target &&
            m.target.nodeType === Node.ELEMENT_NODE &&
            typeof currentAdapter.shouldTriggerOnMutation === 'function' &&
            currentAdapter.shouldTriggerOnMutation(m.target)
          ) {
            shouldScan = true;
            break;
          }
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
        } else if (m.type === 'characterData') {
          const parent = m.target && m.target.parentElement;
          if (
            parent &&
            typeof currentAdapter.shouldTriggerOnMutation === 'function' &&
            currentAdapter.shouldTriggerOnMutation(parent)
          ) {
            shouldScan = true;
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
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-selected']
    });

    // Lightweight fallback poll: bail out early when the lyrics container is absent
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
      'customOverrides',
      'outputMode',
      'tapToFix',
      'showBadges',
      'translationEnabled',
      'translationLang'
    ], (res) => {
      if (res.enabled !== undefined) state.enabled = res.enabled;
      if (res.romajiSystem) state.romajiSystem = res.romajiSystem;
      if (res.fontSizeRatio !== undefined) state.fontSizeRatio = res.fontSizeRatio;
      if (res.casing) state.casing = res.casing;
      if (res.enableValidator !== undefined) state.enableValidator = res.enableValidator;
      if (res.enableAteji !== undefined) state.enableAteji = res.enableAteji;
      if (res.customOverrides) state.customOverrides = res.customOverrides;
      if (res.outputMode) state.outputMode = res.outputMode;
      if (res.tapToFix !== undefined) state.tapToFix = res.tapToFix;
      if (res.showBadges !== undefined) state.showBadges = res.showBadges;
      if (res.translationEnabled !== undefined) state.translationEnabled = res.translationEnabled;
      if (res.translationLang) state.translationLang = res.translationLang;

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

      if (changes.outputMode) {
        state.outputMode = changes.outputMode.newValue || 'romaji';
        needsReconversion = true;
      }

      if (changes.tapToFix) {
        state.tapToFix = changes.tapToFix.newValue !== false;
        needsReconversion = true;
      }

      if (changes.showBadges) {
        state.showBadges = changes.showBadges.newValue !== false;
        needsReconversion = true;
      }

      if (changes.translationEnabled) {
        state.translationEnabled = changes.translationEnabled.newValue === true;
        needsReconversion = true;
      }

      if (changes.translationLang) {
        state.translationLang = changes.translationLang.newValue || 'en';
        if (window.LyricTranslate) window.LyricTranslate.clearCache();
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
    initMessageBridge();
    scheduleScan();
  }

  // The popup cannot touch the page DOM, so it asks the content script to run
  // the export and reports back whether there was anything to export.
  function initMessageBridge() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== 'UTAGOE_EXPORT_VOCABULARY') return false;

      let ok = false;
      try {
        ok = exportVocabulary();
      } catch (err) {
        console.warn('[Utagoe] Vocabulary export failed:', err && err.message);
        ok = false;
      }
      sendResponse({ ok, count: state.lastLines.length });
      return true;
    });
  }

  // Test seam: the content script is an IIFE with no exports, so its internals
  // would otherwise be reachable only by hand-testing in a browser. Exposed only
  // when a test sets the flag before load, never in a normal page.
  if (typeof window !== 'undefined' && window.__UTAGOE_TEST__) {
    window.__utagoeInternals = {
      state,
      buildLineView,
      upgradeRomajiElement,
      applyTranslationLine,
      applyConfidenceBadge,
      openReadingEditor,
      closeReadingEditor,
      bindTapHandler,
      exportVocabulary,
      getLastLines: () => state.lastLines
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
