/**
 * Utagoe Lyrics Romaji Extension
 * Vocabulary CSV Export Module (Anki & spreadsheet compatible)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LyricExport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UTF8_BOM = '\uFEFF';
  const CRLF = '\r\n';
  const CSV_HEADER = 'Word,Kana,Romaji,Source Line,Song';
  const DEFAULT_FILENAME = 'utagoe-vocabulary.csv';
  const FILENAME_PREFIX = 'utagoe-vocabulary-';
  const MAX_SLUG_LENGTH = 60;

  /**
   * Convert a value into a safely escaped CSV cell string.
   * Wraps the field in double quotes and doubles internal quotes only when
   * the field contains a comma, double quote, newline, or carriage return.
   * @param {*} value - Raw cell value
   * @returns {string} Escaped CSV field
   */
  function escapeCsvField(value) {
    if (value === null || value === undefined) {
      return '';
    }
    const text = String(value);
    if (text.length === 0) {
      return '';
    }
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  /**
   * Format the Song metadata column from optional songTitle and artist strings.
   * @param {{songTitle?: string, artist?: string}} [options] - Metadata options
   * @returns {string} Formatted song label
   */
  function formatSongColumn(options) {
    if (!options || typeof options !== 'object') {
      return '';
    }
    const title = typeof options.songTitle === 'string' ? options.songTitle.trim() : '';
    const artist = typeof options.artist === 'string' ? options.artist.trim() : '';

    if (title && artist) {
      return title + ' \u2014 ' + artist;
    }
    if (title) {
      return title;
    }
    if (artist) {
      return artist;
    }
    return '';
  }

  /**
   * Build an Anki/Excel-compatible CSV string from an array of vocabulary rows.
   * Preserves input row order, prefixes a UTF-8 BOM, and uses CRLF line endings.
   * @param {Array<{surface?: string, kana?: string, romaji?: string, line?: string}>} rows - Vocabulary entries
   * @param {{songTitle?: string, artist?: string}} [options] - Song metadata options
   * @returns {string} Complete CSV document with UTF-8 BOM and trailing CRLF
   */
  function buildCsv(rows, options) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const songLabel = formatSongColumn(options);
    const escapedSong = escapeCsvField(songLabel);

    const lines = [CSV_HEADER];

    for (let i = 0; i < safeRows.length; i++) {
      const item = safeRows[i] && typeof safeRows[i] === 'object' ? safeRows[i] : {};
      const word = escapeCsvField(item.surface);
      const kana = escapeCsvField(item.kana);
      const romaji = escapeCsvField(item.romaji);
      const sourceLine = escapeCsvField(item.line);

      lines.push(word + ',' + kana + ',' + romaji + ',' + sourceLine + ',' + escapedSong);
    }

    return UTF8_BOM + lines.join(CRLF) + CRLF;
  }

  /**
   * Generate a filesystem-safe lowercase ASCII `.csv` filename from song metadata.
   * Strips diacritics, collapses non-alphanumerics to single hyphens, caps the
   * slug at 60 characters, and falls back to `utagoe-vocabulary.csv` if empty.
   * @param {string} [songTitle] - Current song title
   * @param {string} [artist] - Current song artist
   * @returns {string} Safe `.csv` filename
   */
  function suggestFilename(songTitle, artist) {
    const parts = [];
    if (typeof songTitle === 'string' && songTitle.trim()) {
      parts.push(songTitle.trim());
    }
    if (typeof artist === 'string' && artist.trim()) {
      parts.push(artist.trim());
    }

    if (parts.length === 0) {
      return DEFAULT_FILENAME;
    }

    const raw = parts.join(' ');
    const normalized = typeof raw.normalize === 'function'
      ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : raw;

    let slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (slug.length > MAX_SLUG_LENGTH) {
      slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
    }

    if (!slug) {
      return DEFAULT_FILENAME;
    }

    return FILENAME_PREFIX + slug + '.csv';
  }

  /**
   * Trigger a browser file download for a CSV string via Blob and a temporary
   * `<a download>` element. Safely returns `false` in non-DOM environments (Node).
   * @param {string} csv - CSV content to download
   * @param {string} [filename] - Target filename for the download
   * @returns {boolean} True if download was triggered, false when DOM is unavailable
   */
  function downloadCsv(csv, filename) {
    if (
      typeof document === 'undefined' ||
      !document ||
      typeof document.createElement !== 'function' ||
      typeof Blob === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return false;
    }

    const content = typeof csv === 'string' ? csv : String(csv === null || csv === undefined ? '' : csv);
    const targetName = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : DEFAULT_FILENAME;

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = targetName;
      anchor.style.display = 'none';

      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(anchor);
      }
      if (typeof anchor.click === 'function') {
        anchor.click();
      }
      if (anchor.parentNode && typeof anchor.parentNode.removeChild === 'function') {
        anchor.parentNode.removeChild(anchor);
      }
      return true;
    } finally {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    }
  }

  return {
    buildCsv,
    downloadCsv,
    suggestFilename
  };
});
