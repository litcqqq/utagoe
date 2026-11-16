/**
 * Site adapter for Spotify Web Player (open.spotify.com)
 */

(function (root, factory) {
  const adapter = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = adapter;
  }
  if (root) {
    root.SpotifySiteAdapter = adapter;
    root.SiteAdapters = root.SiteAdapters || [];
    if (!root.SiteAdapters.some(a => a.name === adapter.name)) {
      root.SiteAdapters.push(adapter);
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LYRIC_LINE_SELECTOR = '[data-testid="lyrics-line"], [data-testid="fullscreen-lyric-line"], .lyrics-lyricsContent-lyric';
  const LYRIC_CONTAINER_SELECTOR = '[data-testid="lyrics-container"], [data-testid="fullscreen-lyric"], .lyrics-lyricsContainer-LyricsBackground';

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
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.childNodes.push(c); return c; },
      prepend(c) { this.childNodes.unshift(c); }
    };
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

  function matches(url) {
    const target = typeof url === 'string'
      ? url
      : (url && typeof url.href === 'string' ? url.href : (typeof location !== 'undefined' ? location.href : ''));
    return /^https?:\/\/open\.spotify\.com(\/|$|\?)/i.test(target);
  }

  function getTrackInfo(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    let title = '';
    let artist = '';
    if (!d) return { title, artist };

    const titleEl = typeof d.querySelector === 'function'
      ? d.querySelector('[data-testid="context-item-info-title"]')
      : null;
    if (titleEl) {
      title = (titleEl.innerText || titleEl.textContent || '').trim();
    }

    const artistEl = typeof d.querySelector === 'function'
      ? d.querySelector('[data-testid="context-item-info-artist"], [data-testid="context-item-info-subtitles"]')
      : null;
    if (artistEl) {
      artist = (artistEl.innerText || artistEl.textContent || '').trim();
    }

    // Use document.title only as a fallback when the player element is not ready
    if (!title && d.title) {
      const parts = d.title
        .split(/[•\-–—|]/)
        .map(s => s.trim())
        .filter(s => s && s.toLowerCase() !== 'spotify');
      if (parts.length >= 2) {
        title = parts[0];
        artist = parts[1];
      }
    }

    return { title, artist };
  }

  function getLyricsContainer(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof d.querySelector !== 'function') return null;

    const container = d.querySelector(LYRIC_CONTAINER_SELECTOR);
    if (container) return container;

    const firstLine = d.querySelector(LYRIC_LINE_SELECTOR);
    return firstLine ? (firstLine.parentElement || firstLine) : null;
  }

  // Read the original text without the injected .spotify-romaji-line elements
  function extractOriginalText(lineEl) {
    if (!lineEl) return '';
    const existingRomaji = typeof lineEl.querySelector === 'function'
      ? lineEl.querySelector('.spotify-romaji-line')
      : null;

    if (lineEl.childNodes && lineEl.childNodes.length > 0) {
      let text = '';
      for (const node of lineEl.childNodes) {
        if (node !== existingRomaji && node.textContent) {
          text += node.textContent;
        }
      }
      return text.trim();
    }

    return (lineEl.textContent || '').trim();
  }

  function getLineElements(container, doc) {
    const d = (container && container.ownerDocument) || doc || (typeof document !== 'undefined' ? document : null);
    const root = container || d;
    if (!root) return [];

    if (typeof root.querySelectorAll === 'function') {
      let lines = Array.from(root.querySelectorAll(LYRIC_LINE_SELECTOR));
      if (lines.length === 0 && d && root !== d && typeof d.querySelectorAll === 'function') {
        lines = Array.from(d.querySelectorAll(LYRIC_LINE_SELECTOR));
      }
      if (lines.length > 0) return lines;
    }

    const targetContainer = container || getLyricsContainer(d);
    if (targetContainer && typeof targetContainer.querySelectorAll === 'function') {
      const candidates = Array.from(targetContainer.querySelectorAll('div[dir="auto"], p[dir="auto"]'));
      return candidates.filter(el => {
        const text = (el.innerText || el.textContent || '').trim();
        return text && text.length > 0 && (el.childElementCount === undefined || el.childElementCount <= 2);
      });
    }

    if (container && Array.isArray(container.childNodes)) {
      return container.childNodes.filter(n => !n.nodeType || n.nodeType === 1);
    }

    return [];
  }

  function getLyricLines(container, doc) {
    const targetContainer = container || getLyricsContainer(doc);
    const elements = getLineElements(targetContainer, doc);
    return elements.map(el => extractOriginalText(el));
  }

  function applyRomaji(container, lines) {
    if (!lines || !Array.isArray(lines)) return;
    const doc = (container && container.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    const lineElements = getLineElements(container, doc);

    for (let i = 0; i < lineElements.length && i < lines.length; i++) {
      const lineEl = lineElements[i];
      const item = lines[i];
      const romaji = typeof item === 'string'
        ? item
        : (item && typeof item === 'object' ? (item.romaji || '') : '');

      if (!romaji) continue;

      let romajiEl = typeof lineEl.querySelector === 'function'
        ? lineEl.querySelector('.spotify-romaji-line')
        : null;

      if (getAttr(lineEl, 'data-has-romaji') === 'true' && romajiEl &&
          getAttr(romajiEl, 'data-utagoe-source') === romaji) {
        continue;
      }

      setAttr(lineEl, 'data-has-romaji', 'true');

      if (!romajiEl) {
        romajiEl = createEl(doc, 'div');
        romajiEl.className = 'spotify-romaji-line';
        setAttr(romajiEl, 'dir', 'auto');
        setAttr(romajiEl, 'aria-hidden', 'true');
        // Stamped so the interaction layer can pair an element with its line
        // without relying on document order, which skips empty rows.
        setAttr(romajiEl, 'data-line-index', String(i));
        prependEl(lineEl, romajiEl);
      }

      // The rendered content is owned by the interaction layer (ruby markup,
      // per-word spans). The adapter records what it *intended* so this check
      // stays stable no matter what markup the element currently holds.
      setAttr(romajiEl, 'data-utagoe-source', romaji);
      if (romajiEl.textContent !== romaji && !getAttr(romajiEl, 'data-utagoe-managed')) {
        romajiEl.textContent = romaji;
      }
    }
  }

  function clearRomaji(container, doc) {
    const d = (container && container.ownerDocument) || doc || (typeof document !== 'undefined' ? document : null);
    const root = container || d;
    if (!root || typeof root.querySelectorAll !== 'function') return;

    root.querySelectorAll('.spotify-romaji-line').forEach(el => {
      if (typeof el.remove === 'function') el.remove();
    });
    root.querySelectorAll('[data-has-romaji]').forEach(el => {
      removeAttr(el, 'data-has-romaji');
    });
  }

  function needsProcessing(container, hasJapaneseFn) {
    const lineElements = getLineElements(container);
    if (lineElements.length === 0) return false;
    return lineElements.some(lineEl => {
      const text = extractOriginalText(lineEl);
      const hasJp = typeof hasJapaneseFn === 'function' ? hasJapaneseFn(text) : Boolean(text);
      const hasRomajiEl = typeof lineEl.querySelector === 'function' && Boolean(lineEl.querySelector('.spotify-romaji-line'));
      return hasJp && !hasRomajiEl;
    });
  }

  function shouldTriggerOnMutation(node) {
    if (!node || node.nodeType !== 1) return false;
    const selector = `${LYRIC_LINE_SELECTOR}, ${LYRIC_CONTAINER_SELECTOR}, [data-testid="now-playing-widget"]`;
    if (typeof node.matches === 'function' && node.matches(selector)) return true;
    if (typeof node.querySelector === 'function' && node.querySelector(`${LYRIC_LINE_SELECTOR}, [dir="auto"]`)) return true;
    return false;
  }

  return {
    name: 'spotify',
    matches,
    getTrackInfo,
    getLyricsContainer,
    getLyricLines,
    applyRomaji,
    clearRomaji,
    needsProcessing,
    shouldTriggerOnMutation,
    extractOriginalText
  };
});
