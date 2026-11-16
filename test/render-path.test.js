/**
 * Render-path checks for content.js itself.
 *
 * The other suites test the modules in isolation; this one loads the real
 * content script against a stub DOM and a stub chrome.* API so the wiring
 * between tokens, markup, badges, the editor and export is exercised the way
 * the browser runs it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDocument, createElement, check, checkAsync, assert, DIST } = require('./dom-harness');
const harness = require('./dom-harness');

const readDist = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');

// Minimal chrome.* surface: the content script reads settings once on start and
// writes when the user corrects a reading. Anything unhandled is recorded so a
// missing API shows up as a test failure rather than a silent no-op.
function createChromeStub(settings) {
  const writes = [];
  const listeners = [];

  const store = Object.assign({
    enabled: true,
    romajiSystem: 'hepburn',
    fontSizeRatio: 0.65,
    casing: 'normal',
    enableValidator: true,
    enableAteji: true,
    customOverrides: {},
    outputMode: 'romaji',
    tapToFix: true,
    showBadges: true,
    translationEnabled: false,
    translationLang: 'en'
  }, settings || {});

  return {
    writes,
    listeners,
    store,
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg, cb) => { if (cb) cb({ ok: true }); },
      getURL: (p) => `chrome-extension://test/${p}`
    },
    storage: {
      local: {
        get: (keys, cb) => {
          if (typeof keys === 'function') return keys(store);
          if (typeof cb === 'function') return cb(store);
          return Promise.resolve(store);
        },
        set: (items, cb) => {
          writes.push(items);
          Object.assign(store, items);
          if (typeof cb === 'function') cb();
        }
      },
      onChanged: { addListener: () => {} }
    },
    tabs: { query: () => {}, sendMessage: () => {} }
  };
}

// Build a DOM whose Spotify lyric container holds one line per given text.
function buildSpotifyPage(doc, lyricTexts) {
  const container = doc.createElement('div');
  container.setAttribute('data-testid', 'fullscreen-lyric');
  doc.body.appendChild(container);

  for (const text of lyricTexts) {
    const line = doc.createElement('div');
    line.setAttribute('data-testid', 'fullscreen-lyric-line');
    line.textContent = text;
    container.appendChild(line);
  }

  return container;
}

async function loadContentScript(settings, doc, chromeStub) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    Date,
    Math,
    JSON,
    AbortController,
    fetch: async () => { throw new Error('no network in tests'); },
    document: doc,
    chrome: chromeStub,
    location: { hostname: 'open.spotify.com', href: 'https://open.spotify.com/lyrics' },
    navigator: { userAgent: 'node-test' },
    MutationObserver: function () {
      return { observe() {}, disconnect() {}, takeRecords: () => [] };
    },
    // The content script schedules work on an animation frame; without this the
    // whole script throws on start and every later check would be meaningless.
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    __UTAGOE_TEST__: true
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  // Adapters attach themselves to window and expect createElement helpers.
  const context = vm.createContext(sandbox);

  for (const rel of [
    'content/ateji.js',
    'content/validator.js',
    'content/readings.js',
    'content/translate.js',
    'content/export.js',
    'content/sites/spotify.js',
    'content/sites/youtubemusic.js'
  ]) {
    vm.runInContext(readDist(rel), context, { filename: rel });
  }

  vm.runInContext(readDist('content/content.js'), context, { filename: 'content/content.js' });

  return sandbox;
}

async function main() {
  console.log('====================================================');
  console.log('   UTAGOE 1.0.1 - RENDER PATH VERIFICATION         ');
  console.log('====================================================\n');

  const doc = createDocument();
  const chromeStub = createChromeStub();
  const page = buildSpotifyPage(doc, ['沈むように溶けてゆくように', '', '誰かの心臓になれたなら']);

  const sandbox = await loadContentScript({}, doc, chromeStub);

  const internals = sandbox.window.__utagoeInternals;
  check('content script exposes internals under the test flag', () => {
    assert(internals, 'no internals exposed');
    assert(typeof internals.buildLineView === 'function', 'buildLineView missing');
  });

  // -------------------------------------------------------------------------
  console.log('Markup - output modes');
  // -------------------------------------------------------------------------

  const Kuroshiro = require('kuroshiro');
  const Analyzer = require('kuroshiro-analyzer-kuromoji');
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new Analyzer({ dictPath: path.join(__dirname, '../node_modules/kuromoji/dict') }));
  sandbox.window.LyricReadings.init(kuroshiro);

  const tokens = await sandbox.window.LyricReadings.tokenize('沈むように', {});

  check('romaji markup wraps each word in a span', () => {
    internals.state.outputMode = 'romaji';
    const view = internals.buildLineView(tokens, 'normal');
    assert(view.html.includes('class="utagoe-word"'), `no word span: ${view.html}`);
    assert(view.html.includes('shizumu'), `romaji missing: ${view.html}`);
    assert(!view.html.includes('<ruby>'), 'romaji markup must not contain ruby');
  });

  check('furigana markup uses ruby/rt over kanji only', () => {
    internals.state.outputMode = 'furigana';
    const view = internals.buildLineView(tokens, 'normal');
    assert(view.html.includes('<ruby>'), 'no ruby element');
    assert(view.html.includes('<rt>'), 'no rt element');
    const rubyCount = (view.html.match(/<ruby>/g) || []).length;
    assert(rubyCount >= 1, 'expected at least one ruby');
    // Kana-only tokens must not get ruby, or the kana is printed twice.
    assert(!/<ruby>ように/.test(view.html), 'kana-only token should not be ruby-annotated');
  });

  check('hiragana markup is kana and has no latin', () => {
    internals.state.outputMode = 'hiragana';
    const view = internals.buildLineView(tokens, 'normal');
    assert(/[ぁ-ん]/.test(view.text), `no hiragana in "${view.text}"`);
    assert(!/[a-z]/i.test(view.text), `latin leaked into hiragana mode: "${view.text}"`);
  });

  check('katakana markup converts the kana', () => {
    internals.state.outputMode = 'katakana';
    const view = internals.buildLineView(tokens, 'normal');
    assert(/[ァ-ヶ]/.test(view.text), `no katakana in "${view.text}"`);
  });

  check('romaji mode never emits markup from furigana mode', () => {
    internals.state.outputMode = 'romaji';
    const view = internals.buildLineView(tokens, 'normal');
    assert(!view.html.includes('<ruby>'), 'stale ruby markup in romaji mode');
  });

  // -------------------------------------------------------------------------
  console.log('\nDOM - adapter render, upgrade, badge and translation lines');
  // -------------------------------------------------------------------------

  // Drive the adapter's own render path instead of waiting for the scan cycle,
  // so this exercises the code the browser actually runs.
  const adapter = sandbox.window.SpotifySiteAdapter;
  check('the Spotify adapter is registered', () => {
    assert(adapter, 'SpotifySiteAdapter missing');
    assert(typeof adapter.applyRomaji === 'function', 'applyRomaji missing');
  });

  const lyricLine = page._children[0];
  adapter.applyRomaji(page, [
    { romaji: 'shizumu yō ni', output: 'shizumu yō ni' },
    { romaji: '', output: '' },
    { romaji: 'dareka no shinzō', output: 'dareka no shinzō' }
  ]);

  const lineEl = doc.querySelectorAll('.spotify-romaji-line')[0];
  check('the adapter rendered a stamped romaji element', () => {
    assert(lineEl, 'no .spotify-romaji-line rendered');
    assert(lineEl.getAttribute('data-line-index') === '0', `index was not stamped: ${lineEl.getAttribute('data-line-index')}`);
    assert(lineEl.getAttribute('data-utagoe-source') === 'shizumu yō ni', 'adapter did not record its source text');
  });

  check('a second identical pass does not rewrite the element', () => {
    const before = lineEl.getAttribute('data-utagoe-source');
    adapter.applyRomaji(page, [
      { romaji: 'shizumu yō ni', output: 'shizumu yō ni' },
      { romaji: '', output: '' },
      { romaji: 'dareka no shinzō', output: 'dareka no shinzō' }
    ]);
    assert(lineEl.getAttribute('data-utagoe-source') === before, 'element was rebuilt on an unchanged pass');
  });

  check('upgrading replaces plain text with word markup', () => {
    internals.state.outputMode = 'romaji';
    const line = { html: '<span class="utagoe-word" data-surface="沈む">shizumu</span>', mode: 'romaji', output: 'shizumu' };
    internals.upgradeRomajiElement(lineEl, line, doc);
    assert(lineEl.innerHTML.includes('utagoe-word'), `markup not applied: ${lineEl.innerHTML}`);
    assert(lineEl.getAttribute('data-utagoe-managed') === 'true', 'element not marked managed');
  });

  check('a managed element survives an adapter pass without losing markup', () => {
    adapter.applyRomaji(page, [
      { romaji: 'shizumu yō ni', output: 'shizumu yō ni' },
      { romaji: '', output: '' },
      { romaji: 'dareka no shinzō', output: 'dareka no shinzō' }
    ]);
    assert(lineEl.innerHTML.includes('utagoe-word'), `markup was overwritten: ${lineEl.innerHTML}`);
  });

  check('re-upgrading with identical markup does not rewrite', () => {
    const before = lineEl.innerHTML;
    const line = { html: before, mode: 'romaji', output: 'shizumu' };
    internals.upgradeRomajiElement(lineEl, line, doc);
    assert(lineEl.innerHTML === before, 'markup churned on an identical pass');
  });

  check('a confidence badge is added once and updated in place', () => {
    const line = { confBadge: 'auto' };
    internals.applyConfidenceBadge(lineEl, line, doc);
    internals.applyConfidenceBadge(lineEl, line, doc);
    const badges = doc.querySelectorAll('.utagoe-badge');
    assert(badges.length === 1, `expected 1 badge, got ${badges.length}`);
    assert(badges[0].getAttribute('data-source') === 'auto', 'badge source not set');
    assert(badges[0].title.length > 0, 'badge has no accessible title');
  });

  check('a translation line is inserted under the lyric', () => {
    const line = { translation: 'As if sinking, as if melting away' };
    internals.applyTranslationLine(lineEl, line, doc);
    const translations = doc.querySelectorAll('.utagoe-translation-line');
    assert(translations.length === 1, `expected 1 translation line, got ${translations.length}`);
    assert(translations[0].textContent.includes('sinking'), 'translation text missing');
  });

  check('clearing the translation removes the element', () => {
    internals.applyTranslationLine(lineEl, { translation: '' }, doc);
    const translations = doc.querySelectorAll('.utagoe-translation-line');
    assert(translations.length === 0, `translation line not removed (${translations.length})`);
  });

  // -------------------------------------------------------------------------
  console.log('\nInteraction - tap to fix');
  // -------------------------------------------------------------------------

  check('tapping a word opens an editor instead of seeking the track', () => {
    internals.state.tapToFix = true;
    internals.bindTapHandler(doc);

    const word = doc.createElement('span');
    word.className = 'utagoe-word';
    word.setAttribute('data-surface', '沈む');
    word.closest = (sel) => (sel === '.utagoe-word' ? word : null);
    doc.body.appendChild(word);

    let prevented = false;
    let stopped = false;
    doc.dispatch('click', {
      target: word,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; }
    });

    const editors = doc.querySelectorAll('.utagoe-editor');
    assert(editors.length === 1, `expected an editor, got ${editors.length}`);
    assert(prevented, 'click was not prevented (the player would have seeked)');
    assert(stopped, 'click was not stopped from propagating');
    return true;
  });

  // -------------------------------------------------------------------------
  console.log('\nExport');
  // -------------------------------------------------------------------------

  check('export reports nothing to do when no lyrics are loaded', () => {
    internals.state.lastLines = [];
    const ok = internals.exportVocabulary();
    assert(ok === false, 'export claimed success with no lines');
    return true;
  });

  check('export builds a CSV from the rendered lines', () => {
    let downloaded = null;
    sandbox.window.LyricExport.downloadCsv = (csv, filename) => { downloaded = { csv, filename }; };

    internals.state.lastLines = [
      { text: '沈むように', tokens: [
        { surface: '沈む', kana: 'しずむ', romaji: 'shizumu', hasKanji: true }
      ] }
    ];
    internals.state.songTitle = 'Yoru ni Kakeru';
    internals.state.songArtist = 'YOASOBI';

    const ok = internals.exportVocabulary();
    assert(ok === true, 'export failed');
    assert(downloaded, 'no download was triggered');
    assert(downloaded.csv.includes('沈む'), `CSV missing the word: ${downloaded.csv}`);
    assert(downloaded.csv.includes('shizumu'), `CSV missing the romaji: ${downloaded.csv}`);
    return true;
  });

  console.log('\n====================================================');
  if (harness.failed === 0) {
    console.log(`  ALL RENDER CHECKS PASSED (${harness.passed} checks)`);
  } else {
    console.log(`  ${harness.passed} passed, ${harness.failed} FAILED`);
    for (const f of harness.failures) console.log(`   - ${f}`);
  }
  console.log('====================================================\n');

  process.exit(harness.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
