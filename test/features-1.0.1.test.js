/**
 * End-to-end checks for the 1.0.1 feature set, exercised against the built
 * extension in dist/ so the shipped code path is what gets tested.
 *
 * Feature map:
 *   1. Furigana / kana output modes  -> ruby markup, hiragana, katakana
 *   2. Tap-a-word correction         -> inline editor, vocabulary persistence
 *   3. Translation line              -> rendering, cache, toggle
 *   4. Confidence badges             -> 4 ranks, weakest-wins
 *   5. Vocabulary CSV export         -> escaping, de-duplication, filename
 */

const fs = require('fs');
const path = require('path');
const { check, checkAsync, assert, DIST, ROOT } = require('./dom-harness');

const harness = require('./dom-harness');

const readDist = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');

// Load the shipped content modules in the same order the manifest declares, so
// ordering bugs (a module reading a global before it exists) surface here.
function loadContentModules() {
  const sources = [
    'content/ateji.js',
    'content/validator.js',
    'content/readings.js',
    'content/translate.js',
    'content/export.js'
  ];

  // Deliberately no `module` in the sandbox: these files are UMD and would take
  // the CommonJS branch, never attaching themselves to the global — which is the
  // opposite of how the browser loads them via manifest.json.
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    // The translation module aborts stale requests; without this the sandbox
    // throws and every lookup silently resolves to an empty string.
    AbortController,
    fetch: () => { throw new Error('fetch must be injected per test'); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const vm = require('vm');
  const context = vm.createContext(sandbox);

  for (const rel of sources) {
    vm.runInContext(readDist(rel), context, { filename: rel });
  }

  return sandbox;
}

async function main() {
  console.log('====================================================');
  console.log('   UTAGOE 1.0.1 - FEATURE VERIFICATION SUITE       ');
  console.log('====================================================\n');

  const mods = loadContentModules();

  // -------------------------------------------------------------------------
  console.log('Feature 1 - Output modes (romaji / furigana / hiragana / katakana)');
  // -------------------------------------------------------------------------

  const kuroshiro = await buildKuroshiro();
  mods.window.LyricReadings.init(kuroshiro);

  await checkAsync('romaji mode yields romaji for every word', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('沈むように', { romajiSystem: 'hepburn' });
    assert(tokens.length > 0, 'no tokens');
    const joined = tokens.map(t => t.romaji).join(' ').toLowerCase();
    assert(joined.includes('shizumu'), `expected shizumu, got "${joined}"`);
  });

  await checkAsync('kana is available for furigana ruby', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('沈む', {});
    const target = tokens.find(t => t.hasKanji);
    assert(target, 'no kanji token');
    assert(/[ぁ-んァ-ヶ]/.test(target.kana), `kana missing: ${target.kana}`);
  });

  await checkAsync('hiragana mode is katakana-free for a kanji word', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('学校', {});
    const t = tokens.find(x => x.surface === '学校') || tokens[0];
    assert(t, 'no token for 学校');
    assert(!/[ァ-ヶ]/.test(t.kana), `expected hiragana, got ${t.kana}`);
    assert(t.kana.includes('がっこう'), `expected がっこう, got ${t.kana}`);
  });

  // -------------------------------------------------------------------------
  console.log('\nFeature 1b - Verb conjugation is not split into fragments');
  // -------------------------------------------------------------------------

  // Kuromoji tags the pieces of a conjugated verb separately, and romanising
  // them one by one produces text no Japanese speaker would write.
  const CONJUGATION_CASES = [
    { input: '溶けてゆく', expect: 'tokete yuku', why: 'te-form + auxiliary verb' },
    { input: '食べている', expect: 'tabete iru', why: 'progressive te-iru' },
    { input: '読んでいた', expect: 'yonde ita', why: 'voiced te-form past' },
    { input: '待ってた', expect: 'matteta', why: 'contracted te-ita' },
    { input: '走った', expect: 'hashitta', why: 'past tense' },
    { input: '愛してる', expect: 'aishiteru', why: 'contracted progressive' }
  ];

  for (const testCase of CONJUGATION_CASES) {
    await checkAsync(`${testCase.input} reads "${testCase.expect}" (${testCase.why})`, async () => {
      const tokens = await mods.window.LyricReadings.tokenize(testCase.input, {});
      const joined = tokens
        .filter((t) => t.romaji)
        .map((t) => t.romaji.trim())
        .join(' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        .trim();
      assert(joined === testCase.expect, `got "${joined}"`);
    });
  }

  await checkAsync('a particle phrase keeps its own word boundaries', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('沈むように', {});
    const surfaces = tokens.map((t) => t.surface).join('|');
    assert(surfaces.includes('沈む'), `verb lost: ${surfaces}`);
    assert(surfaces.includes('よう'), `よう lost: ${surfaces}`);
    assert(!surfaces.includes('沈むように'), `over-merged into one token: ${surfaces}`);
  });

  // -------------------------------------------------------------------------
  console.log('\nFeature 2 - Tap-a-word correction');
  // -------------------------------------------------------------------------

  await checkAsync('custom override replaces the machine reading', async () => {
    const base = await mods.window.LyricReadings.tokenize('今日', {});
    const fixed = await mods.window.LyricReadings.tokenize('今日', {
      customOverrides: { '今日': 'きょう' }
    });
    const a = base.find(t => t.surface === '今日');
    const b = fixed.find(t => t.surface === '今日');
    assert(a && b, 'missing 今日 token');
    assert(b.kana === 'きょう', `expected きょう, got ${b.kana}`);
    assert(b.source === 'user', `expected source=user, got ${b.source}`);
    assert(b.romaji === 'kyō' || b.romaji === 'kyou', `got romaji ${b.romaji}`);
  });

  await checkAsync('an override does not leak into other words', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('今日は晴れ', {
      customOverrides: { '今日': 'きょう' }
    });
    const others = tokens.filter(t => t.surface !== '今日' && t.source === 'user');
    assert(others.length === 0, `override leaked into ${others.map(t => t.surface).join(',')}`);
  });

  // -------------------------------------------------------------------------
  console.log('\nFeature 3 - Translation line');
  // -------------------------------------------------------------------------

  await checkAsync('translation results are cached per line', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return {
        ok: true,
        json: async () => ([[['translated line', 'original']]]),
        text: async () => ''
      };
    };
    // translate.js calls the global fetch, so the stub replaces it on the
    // module's own global rather than being passed as a per-call option.
    mods.window.fetch = fakeFetch;
    mods.window.LyricTranslate.clearCache();

    const first = await mods.window.LyricTranslate.translateLines(['こんにちは'], { targetLang: 'en' });
    const second = await mods.window.LyricTranslate.translateLines(['こんにちは'], { targetLang: 'en' });

    assert(Array.isArray(first) && first.length === 1, 'first call did not return one line');
    assert(first[0] === 'translated line', `unexpected translation: ${first[0]}`);
    assert(second.length === 1, 'second call did not return one line');
    assert(calls === 1, `expected 1 network call after caching, got ${calls}`);
    return true;
  });

  // -------------------------------------------------------------------------
  console.log('\nFeature 4 - Confidence badges');
  // -------------------------------------------------------------------------

  await checkAsync('machine-only line is the weakest rank', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('沈む', {});
    const rank = mods.window.LyricReadings.lineConfidence(tokens);
    assert(rank === 'auto', `expected auto, got "${rank}"`);
  });

  await checkAsync('user correction lifts the line to user rank', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('今日', {
      customOverrides: { '今日': 'きょう' }
    });
    const rank = mods.window.LyricReadings.lineConfidence(tokens);
    assert(rank === 'user', `expected user, got "${rank}"`);
  });

  await checkAsync('empty line reports no confidence instead of verified', async () => {
    const tokens = await mods.window.LyricReadings.tokenize('   ', {});
    const rank = mods.window.LyricReadings.lineConfidence(tokens);
    assert(rank === '', `expected empty rank, got "${rank}"`);
  });

  // -------------------------------------------------------------------------
  console.log('\nFeature 5 - Vocabulary CSV export');
  // -------------------------------------------------------------------------

  await checkAsync('CSV escapes commas and quotes', async () => {
    const csv = mods.window.LyricExport.buildCsv([
      { surface: 'a,b', kana: 'x"y', romaji: 'z' }
    ]);
    assert(csv.includes('"a,b"'), `comma field not quoted: ${csv}`);
    assert(csv.includes('"x""y"'), `quote field not doubled: ${csv}`);
  });

  await checkAsync('filename is derived from the song', async () => {
    // A Japanese-only title has no ASCII to slugify, so the artist is what
    // survives — still a recognisable, filesystem-safe name.
    const name = mods.window.LyricExport.suggestFilename('夜に駆ける', 'YOASOBI');
    assert(name.endsWith('.csv'), `not a csv name: ${name}`);
    assert(/yoasobi/.test(name), `unexpected name: ${name}`);
    assert(!/[^a-z0-9\-.]/i.test(name), `name is not filesystem-safe: ${name}`);

    const latin = mods.window.LyricExport.suggestFilename('Yoru ni Kakeru', 'YOASOBI');
    assert(/yoru-ni-kakeru/.test(latin), `title not used when ASCII: ${latin}`);
  });

  await checkAsync('vocabulary excludes kana-only and duplicate words', async () => {
    const lines = [
      { tokens: [
        { surface: '沈む', kana: 'しずむ', romaji: 'shizumu', hasKanji: true },
        { surface: '沈む', kana: 'しずむ', romaji: 'shizumu', hasKanji: true },
        { surface: 'ように', kana: 'ように', romaji: 'yō ni', hasKanji: false }
      ] }
    ];
    const vocab = mods.window.LyricReadings.collectVocabulary(lines);
    assert(vocab.length === 1, `expected 1 word, got ${vocab.length}`);
    assert(vocab[0].surface === '沈む', `wrong word: ${vocab[0].surface}`);
  });

  // -------------------------------------------------------------------------
  console.log('\nIntegration - manifest and packaging');
  // -------------------------------------------------------------------------

  check('manifest loads the new content modules in dependency order', () => {
    const manifest = JSON.parse(readDist('manifest.json'));
    const scripts = manifest.content_scripts[0].js;
    const order = ['content/readings.js', 'content/translate.js', 'content/export.js', 'content/content.js'];
    let last = -1;
    for (const rel of order) {
      const idx = scripts.indexOf(rel);
      assert(idx >= 0, `${rel} missing from manifest`);
      assert(idx > last, `${rel} declared out of order`);
      last = idx;
    }
  });

  check('every referenced script exists in dist', () => {
    const manifest = JSON.parse(readDist('manifest.json'));
    const refs = []
      .concat(manifest.content_scripts[0].js)
      .concat(manifest.background.service_worker ? [manifest.background.service_worker] : []);
    for (const rel of refs) {
      assert(fs.existsSync(path.join(DIST, rel)), `missing ${rel}`);
    }
  });

  check('translation host permission is declared', () => {
    const manifest = JSON.parse(readDist('manifest.json'));
    assert(
      manifest.host_permissions.includes('https://translate.googleapis.com/*'),
      'translate host permission missing'
    );
  });

  check('popup exposes a single display-mode dropdown with translation optgroup and no separate toggle', () => {
    const popupHtml = readDist('popup/popup.html');
    const popupJs = readDist('popup/popup.js');
    assert(popupHtml.includes('id="select-output-mode"'), 'select-output-mode missing');
    assert(popupHtml.includes('<optgroup label="Translation">'), 'Translation optgroup missing');
    for (const code of ['en', 'th', 'zh', 'id', 'ko', 'es', 'vi', 'fr', 'de', 'pt']) {
      assert(popupHtml.includes(`value="translate:${code}"`), `missing option translate:${code}`);
    }
    assert(!popupHtml.includes('toggle-translation'), 'legacy toggle-translation still present in popup.html');
    assert(!popupHtml.includes('select-translation-lang'), 'legacy select-translation-lang still present in popup.html');
    assert(!popupJs.includes('toggleTranslation'), 'legacy toggleTranslation still present in popup.js');
    assert(!popupJs.includes('translationEnabled'), 'legacy translationEnabled still present in popup.js');
  });

  check('package.json and manifest.json declare the same version', () => {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const manVersion = JSON.parse(readDist('manifest.json')).version;
    assert(/^\d+\.\d+\.\d+$/.test(pkgVersion), `package.json version is not semver: ${pkgVersion}`);
    assert(
      pkgVersion === manVersion,
      `version drift: package.json is ${pkgVersion}, manifest.json is ${manVersion}`
    );
  });

  console.log('\n====================================================');
  if (harness.failed === 0) {
    console.log(`  ALL FEATURE CHECKS PASSED (${harness.passed} checks)`);
  } else {
    console.log(`  ${harness.passed} passed, ${harness.failed} FAILED`);
    for (const f of harness.failures) console.log(`   - ${f}`);
  }
  console.log('====================================================\n');

  process.exit(harness.failed === 0 ? 0 : 1);
}

// Kuroshiro is heavy, so it is built once and reused by every check.
async function buildKuroshiro() {
  const Kuroshiro = require('kuroshiro');
  const Analyzer = require('kuroshiro-analyzer-kuromoji');
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new Analyzer({ dictPath: path.join(ROOT, 'node_modules/kuromoji/dict') }));
  return kuroshiro;
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
