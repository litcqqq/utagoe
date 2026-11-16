/**
 * Utagoe - Reading engine.
 *
 * Splits a Japanese lyric line into individually addressable words and gives
 * each one its kana reading, its romaji, and a provenance tag. Everything that
 * renders lyrics (romaji line, furigana ruby, tap-to-fix targets, confidence
 * badges, vocabulary export) reads from this single token stream so that the
 * four views can never disagree with each other.
 *
 * Two things make the naive "convert each token on its own" approach unusable
 * for Japanese, and both are handled here:
 *
 *  1. Kuromoji splits inflected verbs into a stem plus auxiliary tokens
 *     (待っ て た). Romanising each fragment in isolation yields "matsu te ta",
 *     so auxiliaries are folded back into the word they belong to.
 *  2. Romaji depends on context across a word boundary in ways that only show
 *     up in the whole string (学校 へ renders "gakkō e", not "gakkou he").
 *     Readings are therefore taken as slices of one conversion of the full
 *     line, which keeps them identical to what a context-aware conversion
 *     would produce.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LyricReadings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KATAKANA_OFFSET = 0x30a1 - 0x3041;

  // Kuromoji detaches auxiliaries from the verb they belong to; a lone っ has
  // no pronunciation of its own and must always be folded in.
  //
  // Folding only 助動詞 is not enough for everyday lyric Japanese:
  //   溶けて   -> 溶け(動詞) + て(助詞/接続助詞)      => "toke te"
  //   食べている -> 食べ + て + いる(動詞/非自立)      => "tabe te iru"
  //   読んでいた -> 読ん + で(助詞) + いた(動詞/非自立) => "yon de ita"
  // A connective particle (接続助詞) and a dependent verb (非自立) are, for
  // pronunciation purposes, part of the word in front of them.
  const MERGE_POS = { '助動詞': true };

  function shouldFoldToken(token) {
    if (!token) return false;
    if (MERGE_POS[token.pos] === true) return true;
    const detail = token.pos_detail_1 || '';
    if (token.pos === '助詞' && detail === '接続助詞') return true;
    return false;
  }

  // ゆく / いる / しまう and friends are tagged 動詞/非自立, but they are
  // auxiliary verbs, not the head word: the previous token is still the verb
  // being conjugated. They are folded in only when they follow a verb, so
  // 溶けて + ゆく stays "tokete yuku" while 読んで + いた becomes "yondeita".
  const DEPENDENT_VERB_FUSIONS = {
    'いる': true, 'いた': true, 'います': true, 'いない': true, 'いて': true, 'い': true,
    'しまう': true, 'しまった': true, 'しまい': true,
    'おく': true, 'おいた': true, 'おいて': true,
    'みる': true, 'みた': true, 'みて': true,
    'ある': true, 'あった': true, 'あり': true,
    'いく': true, 'いった': true, 'くる': true, 'きた': true,
    'てる': true, 'てた': true
  };

  function isFusableAuxiliaryVerb(token, previous) {
    if (!token || !previous) return false;
    if (token.pos !== '動詞' || token.pos_detail_1 !== '非自立') return false;
    if (previous.pos !== '動詞') return false;
    return DEPENDENT_VERB_FUSIONS[token.surface_form] === true;
  }

  const KANJI_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const JAPANESE_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  let kuroshiro = null;

  /**
   * Locate the ateji module without assuming a global exists: the extension
   * loads it as a plain <script> global, while the Node tests load it through
   * require, and a missing table must degrade gracefully rather than throw.
   */
  function getAtejiModule() {
    if (typeof self !== 'undefined' && self.LyricAteji) return self.LyricAteji;
    if (typeof globalThis !== 'undefined' && globalThis.LyricAteji) return globalThis.LyricAteji;
    return null;
  }

  function toHiragana(text) {
    if (!text) return '';
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      out += (code >= 0x30a1 && code <= 0x30f6)
        ? String.fromCharCode(code - KATAKANA_OFFSET)
        : ch;
    }
    return out;
  }

  function toKatakana(text) {
    if (!text) return '';
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      out += (code >= 0x3041 && code <= 0x3096)
        ? String.fromCharCode(code + KATAKANA_OFFSET)
        : ch;
    }
    return out;
  }

  function hasJapanese(text) {
    return JAPANESE_PATTERN.test(text || '');
  }

  function hasKanji(text) {
    return KANJI_PATTERN.test(text || '');
  }

  // The shipped ateji table (ateji.js) stores romaji, but furigana and kana
  // modes need the reading itself. Same words, kana form, so that every output
  // mode shows the identical artistic reading instead of falling back to the
  // dictionary reading in three modes out of four.
  const ATEJI_KANA = {
    '運命': 'さだめ',
    '宿命': 'さだめ',
    '本気': 'まじ',
    '未来': 'あす',
    '地球': 'ほし',
    '宇宙': 'そら',
    '瞬間': 'とき',
    '永遠': 'とわ',
    '時代': 'とき',
    '強敵': 'とも',
    '真実': 'ほんとう',
    '記憶': 'おもい',
    '生命': 'いのち',
    '現在': 'いま',
    '本音': 'ほんね'
  };

  function init(kuroshiroInstance) {
    kuroshiro = kuroshiroInstance || null;
  }

  function isReady() {
    return Boolean(kuroshiro);
  }

  // Romaji of a kana slice is requested once per token boundary, and again on
  // every re-render and settings change, so it is cached aggressively.
  const romajiCache = new Map();
  const ROMAJI_CACHE_LIMIT = 2000;

  async function romajiOf(kana, romajiSystem) {
    if (!kana) return '';
    if (!hasJapanese(kana)) return kana;

    const key = `${romajiSystem}\u0000${kana}`;
    const hit = romajiCache.get(key);
    if (hit !== undefined) return hit;

    const value = await kuroshiro.convert(kana, {
      to: 'romaji',
      mode: 'normal',
      romajiSystem: romajiSystem || 'hepburn'
    });

    if (romajiCache.size >= ROMAJI_CACHE_LIMIT) {
      const oldest = romajiCache.keys().next().value;
      if (oldest !== undefined) romajiCache.delete(oldest);
    }
    romajiCache.set(key, value);
    return value;
  }

  function clearCache() {
    romajiCache.clear();
  }

  /**
   * Fold auxiliaries and orphaned sokuon into the preceding word so that each
   * returned unit is something a learner would actually look up.
   */
  function mergeTokens(parsed, slices) {
    const merged = [];

    for (let i = 0; i < parsed.length; i++) {
      const token = parsed[i];
      const surface = token.surface_form || '';
      const sliceRomaji = slices[i] || '';
      const previous = merged[merged.length - 1];

      const isSokuonOnly = surface === 'っ' || surface === 'ッ';
      const shouldMerge = Boolean(previous) && (
        isSokuonOnly || shouldFoldToken(token) || sliceRomaji === '' ||
        isFusableAuxiliaryVerb(token, parsed[i - 1])
      );

      if (shouldMerge) {
        previous.surface += surface;
        previous.kana += token.reading ? toHiragana(token.reading) : surface;
        previous.romaji += sliceRomaji;
        continue;
      }

      merged.push({
        surface,
        kana: token.reading ? toHiragana(token.reading) : surface,
        romaji: sliceRomaji,
        pos: token.pos || ''
      });
    }

    return merged;
  }

  /**
   * Read the line as a single conversion and cut it at token boundaries. This
   * is what makes cross-word sandhi (gakkō e, not gakkou he) come out right
   * while still letting each word keep its own romaji.
   */
  async function sliceByBoundaries(fullKana, boundaries, romajiSystem) {
    const fullRomaji = await romajiOf(fullKana, romajiSystem);
    const slices = [];
    let previousLength = 0;

    for (const boundary of boundaries) {
      const prefixRomaji = await romajiOf(fullKana.slice(0, boundary), romajiSystem);
      // A shortened prefix must never run past the full string, and must never
      // move backwards on an unstable conversion.
      const end = Math.max(previousLength, Math.min(prefixRomaji.length, fullRomaji.length));
      slices.push(fullRomaji.slice(previousLength, end).trim());
      previousLength = end;
    }

    return slices;
  }

  /**
   * Look up a word in the user dictionary, then in the built-in ateji table.
   * User entries always win: they are the only source a learner can correct.
   */
  function resolveReading(surface, defaultKana, options) {
    const overrides = options.customOverrides || {};

    if (Object.prototype.hasOwnProperty.call(overrides, surface)) {
      const custom = String(overrides[surface] || '').trim();
      if (custom) {
        // Accept a kana reading or a ready-made romaji value so the dictionary
        // stays usable from either output mode.
        const isKana = hasJapanese(custom);
        return {
          kana: isKana ? toHiragana(custom) : defaultKana,
          romaji: isKana ? null : custom,
          source: 'user'
        };
      }
    }

    if (options.enableAteji !== false) {
      const ateji = getAtejiModule();
      const table = (ateji && ateji.COMMON_ATEJI_MAP) || null;

      if (table && Object.prototype.hasOwnProperty.call(table, surface)) {
        // Prefer the kana form when we have it so furigana mode annotates the
        // artistic reading; fall back to the romaji entry otherwise.
        const kana = ATEJI_KANA[surface];
        if (kana) return { kana, romaji: null, source: 'dictionary' };
        const romaji = table[surface];
        if (romaji) return { kana: defaultKana, romaji, source: 'dictionary' };
      }
    }

    return { kana: defaultKana, romaji: null, source: 'auto' };
  }

  /**
   * Turn one lyric line into display tokens.
   *
   * @param {string} line      Original Japanese text.
   * @param {Object} options   { romajiSystem, customOverrides, enableAteji, verified }
   * @returns {Promise<Array>} Tokens: { surface, kana, romaji, source }
   */
  async function tokenize(line, options) {
    const opts = options || {};
    const text = (line || '').trim();
    if (!text || !kuroshiro) return [];

    const romajiSystem = opts.romajiSystem || 'hepburn';

    let parsed;
    try {
      parsed = await kuroshiro._analyzer.parse(text);
    } catch (err) {
      return [];
    }
    if (!parsed || parsed.length === 0) return [];

    let fullKana = '';
    const boundaries = [];
    for (const token of parsed) {
      fullKana += token.reading ? toHiragana(token.reading) : (token.surface_form || '');
      boundaries.push(fullKana.length);
    }

    const slices = await sliceByBoundaries(fullKana, boundaries, romajiSystem);
    const merged = mergeTokens(parsed, slices);

    const tokens = [];
    for (const word of merged) {
      const resolved = resolveReading(word.surface, word.kana, opts);

      let romaji = resolved.romaji;
      if (romaji === null) {
        romaji = (hasJapanese(resolved.kana) && resolved.kana !== word.kana)
          ? await romajiOf(resolved.kana, romajiSystem)
          : word.romaji;
        if (!romaji) romaji = await romajiOf(resolved.kana, romajiSystem);
      }

      tokens.push({
        surface: word.surface,
        kana: resolved.kana,
        romaji,
        // A user correction outranks a verified lyric: the dot should say the
        // reading came from the learner, not from Lrclib.
        source: resolved.source === 'user' ? 'user' : (opts.verified ? 'verified' : resolved.source),
        pos: word.pos,
        hasKanji: hasKanji(word.surface)
      });
    }

    return tokens;
  }

  /**
   * A line's confidence is the weakest token in it: one auto-guessed word makes
   * the whole line a guess, because the user reads the line as a unit.
   */
  const SOURCE_RANK = { verified: 3, user: 2, dictionary: 1, auto: 0 };

  function lineConfidence(tokens) {
    // Start from the strongest possible rank and let tokens lower it, but never
    // report "verified" for a line with no Japanese words at all: an empty line
    // has no reading to be confident about.
    let weakest = null;
    let sawJapanese = false;

    for (const token of tokens || []) {
      if (!hasJapanese(token.surface)) continue;
      sawJapanese = true;
      const rank = SOURCE_RANK[token.source] || 0;
      if (weakest === null || rank < (SOURCE_RANK[weakest] || 0)) {
        weakest = token.source;
      }
    }

    return sawJapanese && weakest ? weakest : '';
  }

  /**
   * Build the ruby HTML for one line. Only kanji-bearing words are annotated;
   * annotating kana would double the visual weight of the line for no gain.
   */
  function furiganaHtml(tokens) {
    if (!tokens || tokens.length === 0) return '';
    return tokens.map((token) => {
      const surface = escapeHtml(token.surface);
      if (!token.hasKanji || !token.kana || token.kana === token.surface) return surface;
      return `<ruby>${surface}<rt>${escapeHtml(token.kana)}</rt></ruby>`;
    }).join('');
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render a token stream in the requested output mode.
   * Returns { text, html } where `html` is only meaningful for furigana.
   */
  function render(tokens, mode) {
    if (!tokens || tokens.length === 0) return { text: '', html: '' };

    if (mode === 'hiragana') {
      return { text: tokens.map((t) => t.kana).join(''), html: '' };
    }
    if (mode === 'katakana') {
      return { text: tokens.map((t) => toKatakana(t.kana)).join(''), html: '' };
    }
    if (mode === 'furigana') {
      return { text: tokens.map((t) => t.kana).join(''), html: furiganaHtml(tokens) };
    }

    // Romaji: keep Japanese punctuation attached to the preceding word instead
    // of letting it float on its own with a space around it.
    let out = '';
    for (const token of tokens) {
      if (!hasJapanese(token.surface)) {
        out += token.romaji;
        continue;
      }
      out += (out && !out.endsWith(' ') ? ' ' : '') + token.romaji;
    }
    return { text: out.trim().replace(/\s+([,.!?;:])/g, '$1'), html: '' };
  }

  /**
   * Vocabulary list for export: unique kanji-bearing words in the order they
   * first appear, which is the order a learner would add them to a deck.
   */
  function collectVocabulary(lines) {
    const seen = new Set();
    const words = [];

    for (const line of lines || []) {
      for (const token of line.tokens || []) {
        if (!token.hasKanji) continue;
        const key = token.surface;
        if (seen.has(key)) continue;
        seen.add(key);
        words.push({
          surface: token.surface,
          kana: token.kana,
          romaji: token.romaji,
          line: line.text
        });
      }
    }

    return words;
  }

  return {
    init,
    isReady,
    tokenize,
    render,
    furiganaHtml,
    lineConfidence,
    collectVocabulary,
    clearCache,
    toHiragana,
    toKatakana,
    hasJapanese,
    hasKanji,
    SOURCE_RANK
  };
});
