/**
 * Spotify Japanese Lyrics Romaji Extension
 * Common Ateji (当て字) and lyric reading dictionary for Japanese songs.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LyricAteji = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Common artistic lyric ateji where kanji are sung with alternative readings
  const COMMON_ATEJI_MAP = {
    '運命': 'sadame',
    '宿命': 'sadame',
    '本気': 'maji',
    '未来': 'asu',
    '地球': 'hoshi',
    '宇宙': 'sora',
    '瞬間': 'toki',
    '永遠': 'towa',
    '時代': 'toki',
    '強敵': 'tomo',
    '真実': 'hontou',
    '記憶': 'omoi',
    '生命': 'inochi',
    '現在': 'ima',
    '本音': 'honne'
  };

  /**
   * Apply ateji and custom overrides to a line
   * @param {string} japaneseText - Original Japanese text
   * @param {string} romajiText - Converted Romaji text
   * @param {Object} [customOverrides] - User-defined overrides { kanji: romaji }
   * @param {boolean} [enableAteji=true] - Whether to apply common ateji rules
   * @returns {string} Corrected romaji text
   */
  function applyAtejiAndOverrides(japaneseText, romajiText, customOverrides = {}, enableAteji = true) {
    if (!romajiText) return romajiText;

    let result = romajiText;

    // 1. Check user custom overrides first (highest priority)
    if (customOverrides && typeof customOverrides === 'object') {
      for (const [kanji, customRomaji] of Object.entries(customOverrides)) {
        if (!kanji || !customRomaji) continue;
        if (japaneseText.includes(kanji)) {
          // Replace common misreadings of this word
          // If the word was previously romanized, replace it
          const cleanCustom = customRomaji.trim();
          // Also allow direct regex replacement if the kanji has known romanization
          result = replaceRomajiSegment(japaneseText, result, kanji, cleanCustom);
        }
      }
    }

    // 2. Check common Ateji rules if enabled
    if (enableAteji) {
      for (const [kanji, atejiRomaji] of Object.entries(COMMON_ATEJI_MAP)) {
        // Skip if user explicitly overrode this kanji in custom overrides
        if (customOverrides && customOverrides[kanji]) continue;

        if (japaneseText.includes(kanji)) {
          result = replaceRomajiSegment(japaneseText, result, kanji, atejiRomaji);
        }
      }
    }

    return result;
  }

  /**
   * Helper to replace standard reading with ateji reading in romaji string
   */
  const KNOWN_READINGS_MAP = {
    '運命': ['unmei', 'un me i', 'un mei'],
    '宿命': ['shukumei', 'shuku mei'],
    '本気': ['honki', 'hon ki'],
    '未来': ['mirai', 'mi ra i', 'mi rai'],
    '地球': ['chikyuu', 'chikyū', 'chi kyu u', 'chi kyū'],
    '宇宙': ['uchuu', 'uchū', 'u chu u', 'u chū'],
    '瞬間': ['shunkan', 'shun kan'],
    '永遠': ['eien', 'ei en'],
    '時代': ['jidai', 'ji da i', 'ji dai'],
    '強敵': ['kyouteki', 'kyōteki', 'kyou teki', 'kyō teki'],
    '真実': ['shinjitsu', 'shin jitsu'],
    '記憶': ['kioku', 'ki o ku'],
    '生命': ['seimei', 'sei mei'],
    '現在': ['genzai', 'gen za i', 'gen zai'],
    '本音': ['honne', 'hon ne']
  };

  function replaceRomajiSegment(japaneseLine, romajiLine, kanji, targetReading) {
    let output = romajiLine;
    const knownReadings = KNOWN_READINGS_MAP[kanji] || [];

    for (const reading of knownReadings) {
      const reg = new RegExp(`\\b${reading.replace(/\s+/g, '\\s*')}\\b`, 'gi');
      if (reg.test(output)) {
        output = output.replace(reg, targetReading);
        return output;
      }
    }

    return output;
  }

  return {
    COMMON_ATEJI_MAP,
    applyAtejiAndOverrides
  };
});
