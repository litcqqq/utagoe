/**
 * Site adapter for YouTube Music (music.youtube.com)
 */

(function (root, factory) {
  const adapter = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = adapter;
  }
  if (root) {
    root.YouTubeMusicSiteAdapter = adapter;
    root.SiteAdapters = root.SiteAdapters || [];
    if (!root.SiteAdapters.some(a => a.name === adapter.name)) {
      root.SiteAdapters.push(adapter);
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LYRICS_SHELF_SELECTOR = 'ytmusic-description-shelf-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]';
  const DESCRIPTION_SELECTOR = 'yt-formatted-string.description';

  function getAttr(el, name) {
    if (!el) return null;
    if (typeof el.getAttribute === 'function') return el.getAttribute(name);
    if (el.attributes && Object.prototype.hasOwnProperty.call(el.attributes, name)) {
      return el.attributes[name];
    }
    return null;
  }

  function setAttr(el, name, val) {
    if (!el) return;
    if (typeof el.setAttribute === 'function') {
      el.setAttribute(name, val);
    } else if (el.attributes) {
      el.attributes[name] = String(val);
    }
  }

  function removeAttr(el, name) {
    if (!el) return;
    if (typeof el.removeAttribute === 'function') {
      el.removeAttribute(name);
    } else if (el.attributes) {
      delete el.attributes[name];
    }
  }

  function createEl(doc, tag) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (d && typeof d.createElement === 'function') {
      return d.createElement(tag);
    }
    return {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      className: '',
      textContent: '',
      attributes: {},
      childNodes: [],
      get children() {
        return this.childNodes.filter(n => !n.nodeType || n.nodeType === 1);
      },
      get childElementCount() {
        return this.children.length;
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.childNodes.push(c); return c; },
      prepend(c) { this.childNodes.unshift(c); },
      querySelector(sel) {
        return this.childNodes.find(n => {
          if (!n || typeof n.className !== 'string') return false;
          if (sel === '.spotify-romaji-line') return n.className.split(/\s+/).includes('spotify-romaji-line');
          if (sel === '.ytm-original-line') return n.className.split(/\s+/).includes('ytm-original-line');
          return false;
        }) || null;
      }
    };
  }

  function appendEl(parent, child) {
    if (typeof parent.appendChild === 'function') {
      parent.appendChild(child);
    } else if (Array.isArray(parent.childNodes)) {
      parent.childNodes.push(child);
    }
  }

  function prependEl(parent, child) {
    if (typeof parent.prepend === 'function') {
      parent.prepend(child);
    } else if (typeof parent.insertBefore === 'function' && parent.firstChild) {
      parent.insertBefore(child, parent.firstChild);
    } else if (typeof parent.appendChild === 'function') {
      parent.appendChild(child);
    } else if (Array.isArray(parent.childNodes)) {
      parent.childNodes.unshift(child);
    }
  }

  function getChildElements(el) {
    if (!el) return [];
    if (el.children && typeof el.children.length === 'number') {
      return Array.from(el.children);
    }
    if (Array.isArray(el.childNodes)) {
      return el.childNodes.filter(n => !n.nodeType || n.nodeType === 1);
    }
    return [];
  }

  function matches(url) {
    const target = typeof url === 'string'
      ? url
      : (url && typeof url.href === 'string' ? url.href : (typeof location !== 'undefined' ? location.href : ''));
    return /^https?:\/\/music\.youtube\.com(\/|$|\?)/i.test(target);
  }

  function getTrackInfo(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    let title = '';
    let artist = '';
    if (!d) return { title, artist };

    // YouTube Music ships several layout variants and not all of them have a
    // ytmusic-player-bar. The miniplayer/track-info variant uses
    // ytmusic-track-info; both must be tried before falling back to document.title.
    const readText = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');

    const titleSelectors = [
      'ytmusic-track-info .ytmusicTrackInfoTitle',
      'ytmusic-player-bar #layout .title',
      'ytmusic-player-bar .title',
      'ytmusic-player-page .ytmusicTrackInfoTitle',
    ];
    for (const sel of titleSelectors) {
      if (typeof d.querySelector !== 'function') break;
      const el = d.querySelector(sel);
      const txt = readText(el);
      if (txt) { title = txt; break; }
    }

    const bylineSelectors = [
      'ytmusic-track-info .ytmusicTrackInfoByline',
      'ytmusic-player-bar #layout .byline',
      'ytmusic-player-bar .byline',
    ];
    for (const sel of bylineSelectors) {
      if (typeof d.querySelector !== 'function') break;
      const txt = readText(d.querySelector(sel));
      if (txt) {
        // Byline looks like "Artist • 1B views • 3.5M likes": keep the artist part only
        artist = txt.split(/[•|]/)[0].trim();
        break;
      }
    }

    // Last resort: document.title has the form "Song Name - Artist"
    if (!title && d.title) {
      const cleaned = d.title.replace(/\s*-\s*YouTube Music\s*$/i, '').trim();
      const parts = cleaned.split(/\s+-\s+|\s*[•–—|]\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        title = parts[0];
        if (!artist) artist = parts[1];
      } else if (parts.length === 1 && cleaned.toLowerCase() !== 'youtube music') {
        title = parts[0];
      }
    }

    return { title, artist };
  }

  function getLyricsContainer(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return null;

    let shelf = typeof d.querySelector === 'function'
      ? d.querySelector(LYRICS_SHELF_SELECTOR)
      : null;

    if (!shelf && typeof d.querySelectorAll === 'function') {
      const shelves = Array.from(d.querySelectorAll('ytmusic-description-shelf-renderer'));
      shelf = shelves.find(s => getAttr(s, 'page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS') || null;
    }

    if (!shelf || typeof shelf.querySelectorAll !== 'function') return null;

    const descriptions = shelf.querySelectorAll(DESCRIPTION_SELECTOR);
    if (!descriptions || descriptions.length === 0) return null;

    // YouTube Music renders two yt-formatted-string.description nodes; only the last one is visible
    return descriptions[descriptions.length - 1];
  }

  function getExistingRows(container) {
    const children = getChildElements(container);
    if (children.length > 0) {
      const marked = children.filter(c =>
        getAttr(c, 'data-lyric-line') === 'true' ||
        getAttr(c, 'data-has-romaji') !== null ||
        (typeof c.className === 'string' && c.className.includes('ytm-lyric-line'))
      );
      if (marked.length > 0) return marked;
    }
    if (container && typeof container.querySelectorAll === 'function') {
      const queried = Array.from(container.querySelectorAll('[data-lyric-line="true"], .ytm-lyric-line'));
      if (queried.length > 0) return queried;
    }
    return [];
  }

  function extractRowOriginalText(row) {
    const attrText = getAttr(row, 'data-original-text');
    if (attrText !== null && attrText !== undefined) return attrText;

    const origEl = typeof row.querySelector === 'function'
      ? row.querySelector('.ytm-original-line')
      : null;
    if (origEl) return origEl.textContent || '';

    const romajiEl = typeof row.querySelector === 'function'
      ? row.querySelector('.spotify-romaji-line')
      : null;
    if (row.childNodes && row.childNodes.length > 0) {
      let text = '';
      for (const node of row.childNodes) {
        if (node !== romajiEl && node.textContent) {
          text += node.textContent;
        }
      }
      return text;
    }

    return row.textContent || '';
  }

  function getLyricLines(container, doc) {
    const target = container || getLyricsContainer(doc);
    if (!target) return [];

    const existingRows = getExistingRows(target);
    if (existingRows.length > 0) {
      const preserved = getAttr(target, 'data-original-lyrics');
      if (preserved !== null && preserved !== undefined && preserved.length > 0) {
        const splitPreserved = preserved.split(/\r?\n/);
        if (splitPreserved.length === existingRows.length) {
          return splitPreserved;
        }
      }
      return existingRows.map(row => extractRowOriginalText(row));
    }

    const rawText = target.textContent || '';
    if (!rawText) return [];
    return rawText.split(/\r?\n/);
  }

  function applyRomaji(container, lines) {
    if (!container) return;
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const existingRows = getExistingRows(container);

    // If rows were rendered before, skip the ones already marked data-has-romaji="true"
    if (existingRows.length > 0) {
      for (let i = 0; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (getAttr(row, 'data-has-romaji') === 'true') {
          continue;
        }

        const originalText = extractRowOriginalText(row);
        setAttr(row, 'data-lyric-line', 'true');
        setAttr(row, 'data-original-text', originalText);

        if (originalText.trim() === '') {
          setAttr(row, 'data-has-romaji', 'true');
          continue;
        }

        const item = Array.isArray(lines) ? lines[i] : null;
        const romaji = typeof item === 'string'
          ? item
          : (item && typeof item === 'object' ? (item.romaji || '') : '');

        if (getChildElements(row).length === 0) {
          row.textContent = '';
          if (Array.isArray(row.childNodes)) row.childNodes.length = 0;
          const origEl = createEl(doc, 'div');
          origEl.className = 'ytm-original-line';
          origEl.textContent = originalText;
          appendEl(row, origEl);
        }

        if (romaji) {
          let romajiEl = typeof row.querySelector === 'function'
            ? row.querySelector('.spotify-romaji-line')
            : null;
          if (!romajiEl) {
            romajiEl = createEl(doc, 'div');
            romajiEl.className = 'spotify-romaji-line';
            setAttr(romajiEl, 'dir', 'auto');
            setAttr(romajiEl, 'aria-hidden', 'true');
            prependEl(row, romajiEl);
          }
          romajiEl.textContent = romaji;
        }

        setAttr(row, 'data-has-romaji', 'true');
      }
      return;
    }

    // First injection: capture the original text, then split it per line (\r?\n)
    const rawText = container.textContent || '';
    const rawLines = rawText.length > 0 ? rawText.split(/\r?\n/) : [];
    const totalLen = Math.max(rawLines.length, Array.isArray(lines) ? lines.length : 0);
    if (totalLen === 0) return;

    const pairs = [];
    for (let i = 0; i < totalLen; i++) {
      const item = Array.isArray(lines) ? lines[i] : undefined;
      let originalText = rawLines[i] !== undefined ? rawLines[i] : '';
      let romaji = '';

      if (typeof item === 'string') {
        if (rawLines.length > 0) {
          romaji = item;
        } else {
          originalText = item;
        }
      } else if (item && typeof item === 'object') {
        if (item.text !== undefined) originalText = item.text;
        else if (item.original !== undefined) originalText = item.original;
        romaji = item.romaji || '';
      }

      pairs.push({ originalText, romaji });
    }

    const preservedLyrics = rawText || pairs.map(p => p.originalText).join('\n');
    setAttr(container, 'data-original-lyrics', preservedLyrics);

    container.textContent = '';
    if (Array.isArray(container.childNodes)) {
      container.childNodes.length = 0;
    }

    for (const { originalText, romaji } of pairs) {
      const row = createEl(doc, 'div');
      setAttr(row, 'data-lyric-line', 'true');
      setAttr(row, 'data-original-text', originalText);

      if (originalText.trim() === '') {
        row.className = 'ytm-lyric-line ytm-lyric-empty';
        setAttr(row, 'data-has-romaji', 'true');
        appendEl(container, row);
        continue;
      }

      row.className = 'ytm-lyric-line';

      if (romaji) {
        const romajiEl = createEl(doc, 'div');
        romajiEl.className = 'spotify-romaji-line';
        setAttr(romajiEl, 'dir', 'auto');
        setAttr(romajiEl, 'aria-hidden', 'true');
        romajiEl.textContent = romaji;
        appendEl(row, romajiEl);
      }

      const origEl = createEl(doc, 'div');
      origEl.className = 'ytm-original-line';
      origEl.textContent = originalText;
      appendEl(row, origEl);

      setAttr(row, 'data-has-romaji', 'true');
      appendEl(container, row);
    }
  }

  function clearRomaji(container, doc) {
    const target = container || getLyricsContainer(doc);
    if (!target) return;

    const rows = getExistingRows(target);
    rows.forEach(row => {
      if (typeof row.querySelector === 'function') {
        const romajiEl = row.querySelector('.spotify-romaji-line');
        if (romajiEl && typeof romajiEl.remove === 'function') {
          romajiEl.remove();
        } else if (romajiEl && Array.isArray(row.childNodes)) {
          const idx = row.childNodes.indexOf(romajiEl);
          if (idx !== -1) row.childNodes.splice(idx, 1);
        }
      }
      removeAttr(row, 'data-has-romaji');
    });
  }

  function needsProcessing(container, hasJapaneseFn) {
    if (!container) return false;
    const existingRows = getExistingRows(container);
    if (existingRows.length === 0) {
      const rawText = container.textContent || '';
      return typeof hasJapaneseFn === 'function' ? hasJapaneseFn(rawText) : Boolean(rawText.trim());
    }
    return existingRows.some(row => {
      const text = extractRowOriginalText(row);
      const hasJp = typeof hasJapaneseFn === 'function' ? hasJapaneseFn(text) : Boolean(text.trim());
      return hasJp && getAttr(row, 'data-has-romaji') !== 'true';
    });
  }

  function isLyricsTab(el) {
    if (!el) return false;
    const text = (el.innerText || el.textContent || '').trim();
    return /^lyrics$/i.test(text);
  }

  function findLyricsTabFromTarget(target) {
    if (!target) return null;
    if (typeof target.closest === 'function') {
      const tab = target.closest('tp-yt-paper-tab');
      if (tab && isLyricsTab(tab)) return tab;
    }
    let curr = target;
    while (curr) {
      const tag = (curr.tagName || curr.nodeName || '').toLowerCase();
      if (tag === 'tp-yt-paper-tab' && isLyricsTab(curr)) {
        return curr;
      }
      curr = curr.parentElement || curr.parentNode || null;
    }
    return null;
  }

  function setupNavigationHooks(onTrigger, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof d.addEventListener !== 'function' || typeof onTrigger !== 'function') return;

    // Navigasi SPA antar lagu di YouTube Music
    d.addEventListener('yt-navigate-finish', () => {
      onTrigger();
      if (typeof setTimeout === 'function') {
        setTimeout(onTrigger, 300);
      }
    });

    // Clicking the Lyrics tab: re-run once aria-selected flips to "true"
    d.addEventListener('click', (event) => {
      const tab = findLyricsTabFromTarget(event && event.target);
      if (!tab) return;

      const runIfSelected = () => {
        if (getAttr(tab, 'aria-selected') === 'true') {
          onTrigger();
          return true;
        }
        return false;
      };

      runIfSelected();
      if (typeof setTimeout === 'function') {
        setTimeout(runIfSelected, 50);
        setTimeout(runIfSelected, 200);
        setTimeout(runIfSelected, 500);
      }
    });
  }

  function shouldTriggerOnMutation(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = (node.tagName || '').toLowerCase();
    if (
      tag === 'ytmusic-description-shelf-renderer' ||
      tag === 'yt-formatted-string' ||
      tag === 'tp-yt-paper-tab'
    ) {
      return true;
    }
    if (typeof node.matches === 'function' && node.matches(`${LYRICS_SHELF_SELECTOR}, ${DESCRIPTION_SELECTOR}`)) {
      return true;
    }
    if (typeof node.querySelector === 'function' && node.querySelector(`${LYRICS_SHELF_SELECTOR}, ${DESCRIPTION_SELECTOR}`)) {
      return true;
    }
    return false;
  }

  return {
    name: 'youtubemusic',
    matches,
    getTrackInfo,
    getLyricsContainer,
    getLyricLines,
    applyRomaji,
    clearRomaji,
    needsProcessing,
    setupNavigationHooks,
    shouldTriggerOnMutation,
    isLyricsTab
  };
});
