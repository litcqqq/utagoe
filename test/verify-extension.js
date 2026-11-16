/**
 * Automated Verification Script for Spotify Lyrics Romaji Extension
 * Tests:
 * 1. Manifest V3 integrity & file references (including validator & ateji modules)
 * 2. Morphological conversion accuracy (Hepburn & Passport)
 * 3. Ateji (当て字) and custom user dictionary override rules
 * 4. Validator module (LRC parser and Romanized text detector)
 * 5. Stacked Line layout DOM simulation (Romaji above Kanji)
 * 6. Popup HTML & JS element binding consistency
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function main() {
  console.log('====================================================');
  console.log('   SPOTIFY LYRICS ROMAJI - VERIFICATION SUITE       ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // --- Test 1: Manifest Integrity ---
  test('1. Manifest V3 integrity and referenced file existence', () => {
    const manifestPath = path.join(DIST_DIR, 'manifest.json');
    assert(fs.existsSync(manifestPath), 'manifest.json does not exist in dist/');
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
    assert(manifest.host_permissions.includes('https://lrclib.net/*'), 'Must include lrclib.net in host permissions');
    assert(manifest.host_permissions.includes('https://open.spotify.com/*'), 'Must include open.spotify.com in host permissions');
    assert(manifest.host_permissions.includes('https://music.youtube.com/*'), 'Must include music.youtube.com in host permissions');
    assert(manifest.content_scripts[0].matches.includes('https://music.youtube.com/*'), 'Must include music.youtube.com in content_scripts.matches');
    assert(manifest.web_accessible_resources[0].matches.includes('https://music.youtube.com/*'), 'Must include music.youtube.com in web_accessible_resources.matches');
    
    // Check icons
    Object.values(manifest.icons).forEach(iconPath => {
      assert(fs.existsSync(path.join(DIST_DIR, iconPath)), `Icon missing: ${iconPath}`);
    });

    // Check popup
    assert(fs.existsSync(path.join(DIST_DIR, manifest.action.default_popup)), 'Popup HTML missing');

    // Check content scripts
    manifest.content_scripts.forEach(cs => {
      cs.js.forEach(jsPath => {
        assert(fs.existsSync(path.join(DIST_DIR, jsPath)), `Content script missing: ${jsPath}`);
      });
      cs.css.forEach(cssPath => {
        assert(fs.existsSync(path.join(DIST_DIR, cssPath)), `Content css missing: ${cssPath}`);
      });
    });

    // Check dictionary files
    const dictFiles = fs.readdirSync(path.join(DIST_DIR, 'dict'));
    assert(dictFiles.length >= 10, 'Dictionary files count must be at least 10');
  });

  // --- Test 2: Morphological Analyzer & Transliteration ---
  await testAsync('2. Kuroshiro + Kuromoji Morphological conversion engine', async () => {
    global.window = global;
    global.self = global;

    global.fetch = async function(url) {
      const fileName = path.basename(url);
      const filePath = path.join(DIST_DIR, 'dict', fileName);
      const buffer = fs.readFileSync(filePath);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      };
    };

    const kuroshiroCode = fs.readFileSync(path.join(DIST_DIR, 'lib', 'kuroshiro.min.js'), 'utf8');
    const analyzerCode = fs.readFileSync(path.join(DIST_DIR, 'lib', 'kuroshiro-analyzer-kuromoji.min.js'), 'utf8');

    new Function('exports', 'module', 'window', 'self', kuroshiroCode)(undefined, undefined, global, global);
    new Function('exports', 'module', 'window', 'self', analyzerCode)(undefined, undefined, global, global);

    const kuroshiro = new global.Kuroshiro();
    const analyzer = new global.KuromojiAnalyzer({ dictPath: 'dist/dict/' });
    await kuroshiro.init(analyzer);

    const resHepburn = await kuroshiro.convert('沈むように溶けてゆくように', {
      to: 'romaji',
      mode: 'spaced',
      romajiSystem: 'hepburn'
    });
    assert(resHepburn.includes('shizumu'), `Expected "shizumu" in "${resHepburn}"`);

    const resPassport = await kuroshiro.convert('沈むように溶けてゆくように', {
      to: 'romaji',
      mode: 'spaced',
      romajiSystem: 'passport'
    });
    assert(!resPassport.includes('yō'), `Passport should not use macron in "${resPassport}"`);
  });

  // --- Test 3: Ateji (当て字) and Custom User Overrides ---
  test('3. Ateji rulebook and custom dictionary overrides', () => {
    const atejiModule = require(path.join(DIST_DIR, 'content', 'ateji.js'));
    const { applyAtejiAndOverrides } = atejiModule;

    // Test 1: Standard ateji replacement (運命 unmei -> sadame)
    const line1Jp = 'それが運命だとしても';
    const line1Romaji = 'sore ga unmei da toshite mo';
    const corrected1 = applyAtejiAndOverrides(line1Jp, line1Romaji, {}, true);
    assert(corrected1.includes('sadame'), `Expected "sadame" in "${corrected1}"`);
    assert(!corrected1.includes('unmei'), `Did not expect "unmei" in "${corrected1}"`);

    // Test 2: User custom override takes precedence
    const custom = { '運命': 'unmei_custom' };
    const corrected2 = applyAtejiAndOverrides(line1Jp, line1Romaji, custom, true);
    assert(corrected2.includes('unmei_custom'), `Expected user override in "${corrected2}"`);

    // Test 3: Multiple ateji in one line (本気 maji & 未来 asu)
    const line3Jp = '本気で未来を掴む';
    const line3Romaji = 'honki de mirai o tsukamu';
    const corrected3 = applyAtejiAndOverrides(line3Jp, line3Romaji, {}, true);
    assert(corrected3.includes('maji'), `Expected "maji" in "${corrected3}"`);
    assert(corrected3.includes('asu'), `Expected "asu" in "${corrected3}"`);
  });

  // --- Test 4: Validator Module (LRC Parser & Detector) ---
  test('4. Validator module (LRC parser and Romanized lyrics check)', () => {
    const validatorModule = require(path.join(DIST_DIR, 'content', 'validator.js'));
    const { parseSyncedLrc, isRomanizedText } = validatorModule;

    // Test LRC parser
    const sampleLrc = `[00:00.90] Shizumu you ni tokete yuku you ni\n[00:07.73] Futari dake no sora ga hirogaru yoru ni`;
    const parsed = parseSyncedLrc(sampleLrc);
    assert.strictEqual(parsed.length, 2, 'Should parse 2 synced lines');
    assert.strictEqual(parsed[0].text, 'Shizumu you ni tokete yuku you ni');
    assert.strictEqual(parsed[0].timeMs, 900);
    assert.strictEqual(parsed[1].timeMs, 7730);

    // Test Romanized detector
    assert(isRomanizedText('Shizumu you ni tokete yuku you ni Futari dake no sora ga hirogaru yoru ni'), 'Should detect Romanized lyrics');
    assert(!isRomanizedText('沈むように溶けてゆくように 二人だけの空が広がる夜に'), 'Should NOT mark Kanji as Romanized');
  });

  // --- Test 4b: Lrclib header line must not shift romaji ---
  test('4b. Lrclib plainLyrics header line is stripped (prevents off-by-one)', () => {
    const { stripHeaderLines } = require(path.join(DIST_DIR, 'content', 'validator.js'));

    // Bentuk nyata dari lrclib: baris pertama = "Judul - Artis"
    const raw = ['Lemon - Kenshi Yonezu',
                 'Yume naraba dore hodo yokatta deshou',
                 'Imada ni anata no koto wo yume ni miru'];
    const fixed = stripHeaderLines(raw, 'Lemon', 'Kenshi Yonezu');
    assert.deepStrictEqual(fixed, raw.slice(1),
      'Title header must be removed so romaji aligns with the Japanese lines');
    assert.strictEqual(fixed[0], 'Yume naraba dore hodo yokatta deshou');

    // Urutan terbalik juga harus dikenali
    assert.deepStrictEqual(
      stripHeaderLines(['Kenshi Yonezu - Lemon', 'aishiteru'], 'Lemon', 'Kenshi Yonezu'),
      ['aishiteru']);

    // Baris penanda struktur juga dibuang
    assert.deepStrictEqual(
      stripHeaderLines(['[Verse 1]', 'yume naraba'], 'Lemon', 'Kenshi Yonezu'),
      ['yume naraba']);

    // Lirik yang memang diawali judul sebagai bagian lirik tidak boleh hilang
    const noHeader = ['kimi no na wa', 'boku no na wa'];
    assert.deepStrictEqual(stripHeaderLines(noHeader, 'Lemon', 'Kenshi Yonezu'), noHeader);

    // Tidak boleh mengembalikan daftar kosong
    assert.deepStrictEqual(stripHeaderLines(['Lemon - Kenshi Yonezu'], 'Lemon', 'Kenshi Yonezu'),
      ['Lemon - Kenshi Yonezu']);
  });

  // --- Test 5: Stacked Line DOM Structure Simulation ---
  test('5. Stacked Line layout DOM simulation (Romaji above Kanji)', () => {
    class MockNode {
      constructor(type, text = '') {
        this.type = type;
        this.textContent = text;
        this.childNodes = [];
        this.attributes = {};
        this.className = '';
      }
      prepend(child) {
        this.childNodes.unshift(child);
      }
      setAttribute(name, val) {
        this.attributes[name] = val;
      }
      querySelector(sel) {
        return this.childNodes.find(n => sel.includes('spotify-romaji-line') && n.className.includes('spotify-romaji-line')) || null;
      }
    }

    const lineEl = new MockNode('div', '');
    const kanjiSpan = new MockNode('span', '繋いだ手を離さないで');
    lineEl.childNodes.push(kanjiSpan);

    const romajiText = 'tsunai da te o hanasa nai de';
    const romajiEl = new MockNode('div', romajiText);
    romajiEl.className = 'spotify-romaji-line';
    lineEl.prepend(romajiEl);
    lineEl.setAttribute('data-has-romaji', 'true');

    assert.strictEqual(lineEl.childNodes[0], romajiEl, 'First child must be the Romaji line');
    assert.strictEqual(lineEl.childNodes[1], kanjiSpan, 'Second child must be the original Kanji line');
  });

  // --- Test 6: Popup HTML & JS Binding ---
  test('6. Popup HTML & JS element binding consistency', () => {
    const htmlContent = fs.readFileSync(path.join(DIST_DIR, 'popup', 'popup.html'), 'utf8');
    const jsContent = fs.readFileSync(path.join(DIST_DIR, 'popup', 'popup.js'), 'utf8');

    const idMatches = [...jsContent.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)];
    assert(idMatches.length > 0, 'Should find getElementById in popup.js');

    idMatches.forEach(([, id]) => {
      assert(htmlContent.includes(`id="${id}"`), `Element ID #${id} referenced in popup.js missing in popup.html`);
    });

    assert(htmlContent.includes('id="toggle-validator"'), 'Must have validator toggle in HTML');
    assert(htmlContent.includes('id="toggle-ateji"'), 'Must have ateji toggle in HTML');
    assert(htmlContent.includes('id="form-add-override"'), 'Must have custom override form in HTML');
  });

  // --- Test 6b: Lrclib request must be proxied via service worker ---
  test('6b. Lrclib requests are proxied through the service worker (MV3 CORS)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));

    assert(manifest.background && manifest.background.service_worker,
      'MV3 requires a service worker; content-script fetch cannot cross origins on its own');

    const swPath = path.join(DIST_DIR, manifest.background.service_worker);
    assert(fs.existsSync(swPath), `Service worker file missing: ${manifest.background.service_worker}`);

    const swCode = fs.readFileSync(swPath, 'utf8');
    assert(swCode.includes('chrome.runtime.onMessage.addListener'),
      'Service worker must listen for runtime messages');
    assert(swCode.includes('lrclib.net'),
      'Service worker must be the component that talks to Lrclib');

    const validatorSrc = fs.readFileSync(path.join(DIST_DIR, 'content', 'validator.js'), 'utf8');
    assert(validatorSrc.includes('chrome.runtime.sendMessage'),
      'Validator must delegate to the service worker instead of fetching directly');

    // Fetch langsung ke lrclib dari content script akan ditolak CORS oleh halaman.
    const directFetch = /fetch\(\s*`https:\/\/lrclib\.net/;
    assert(!directFetch.test(validatorSrc),
      'Validator must not call fetch() against lrclib.net directly (CORS-blocked in content scripts)');
  });

  // --- Test 7: Site Adapters (Spotify & YouTube Music) ---
  test('7. Site adapters (Spotify & YouTube Music DOM, idempotency, and hooks)', () => {
    const spotifyAdapter = require(path.join(DIST_DIR, 'content', 'sites', 'spotify.js'));
    const ytmAdapter = require(path.join(DIST_DIR, 'content', 'sites', 'youtubemusic.js'));

    assert(spotifyAdapter.matches('https://open.spotify.com/track/123'), 'Spotify adapter should match open.spotify.com');
    assert(!spotifyAdapter.matches('https://music.youtube.com/watch?v=123'), 'Spotify adapter should not match music.youtube.com');
    assert(ytmAdapter.matches('https://music.youtube.com/watch?v=123'), 'YTM adapter should match music.youtube.com');
    assert(!ytmAdapter.matches('https://open.spotify.com/track/123'), 'YTM adapter should not match open.spotify.com');

    // Layout nyata di music.youtube.com tidak selalu punya ytmusic-player-bar;
    // metadata bisa berada di ytmusic-track-info (miniplayer / player page).
    const mockPlayerDoc = {
      title: 'Fallback Song - Fallback Artist - YouTube Music',
      querySelector(sel) {
        if (sel === 'ytmusic-track-info .ytmusicTrackInfoTitle') {
          return { textContent: '夜に駆ける' };
        }
        if (sel === 'ytmusic-track-info .ytmusicTrackInfoByline') {
          return { textContent: 'YOASOBI • 1B views • 3.5M likes' };
        }
        return null;
      }
    };
    const info1 = ytmAdapter.getTrackInfo(mockPlayerDoc);
    assert.strictEqual(info1.title, '夜に駆ける');
    assert.strictEqual(info1.artist, 'YOASOBI');

    // Varian layout lama dengan ytmusic-player-bar harus tetap dikenali
    const mockBarDoc = {
      title: 'Fallback Song - Fallback Artist - YouTube Music',
      querySelector(sel) {
        if (sel === 'ytmusic-player-bar #layout .title') {
          return { textContent: '群青' };
        }
        if (sel === 'ytmusic-player-bar #layout .byline') {
          return { textContent: 'YOASOBI • THE BOOK • 2021' };
        }
        return null;
      }
    };
    const infoBar = ytmAdapter.getTrackInfo(mockBarDoc);
    assert.strictEqual(infoBar.title, '群青');
    assert.strictEqual(infoBar.artist, 'YOASOBI');

    const mockFallbackDoc = {
      title: '群青 - YOASOBI',
      querySelector() { return null; }
    };
    const info2 = ytmAdapter.getTrackInfo(mockFallbackDoc);
    assert.strictEqual(info2.title, '群青');
    assert.strictEqual(info2.artist, 'YOASOBI');

    // Wajib memeriksa page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS" dan memilih elemen description terakhir
    const firstDesc = {
      className: 'description style-scope ytmusic-description-shelf-renderer',
      textContent: '沈むように溶けてゆくように\r\n\r\n二人だけの空が広がる夜に',
      attributes: {},
      childNodes: []
    };
    const secondDesc = {
      className: 'non-expandable description style-scope ytmusic-description-shelf-renderer',
      textContent: '沈むように溶けてゆくように\r\n\r\n二人だけの空が広がる夜に',
      attributes: {},
      childNodes: [],
      get children() {
        return this.childNodes.filter(n => !n.nodeType || n.nodeType === 1);
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      appendChild(c) { this.childNodes.push(c); return c; }
    };

    const nonLyricsDoc = {
      querySelector() { return null; },
      querySelectorAll() {
        return [{ getAttribute: () => 'MUSIC_PAGE_TYPE_TRACK_DESCRIPTION' }];
      }
    };
    assert.strictEqual(ytmAdapter.getLyricsContainer(nonLyricsDoc), null, 'Should ignore non-lyrics shelf');

    const lyricsDoc = {
      querySelector(sel) {
        if (sel === 'ytmusic-description-shelf-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') {
          return {
            querySelectorAll(sub) {
              if (sub === 'yt-formatted-string.description') return [firstDesc, secondDesc];
              return [];
            }
          };
        }
        return null;
      }
    };
    const container = ytmAdapter.getLyricsContainer(lyricsDoc);
    assert.strictEqual(container, secondDesc, 'Must select the LAST yt-formatted-string.description');

    const rawLines = ytmAdapter.getLyricLines(container);
    assert.deepStrictEqual(rawLines, ['沈むように溶けてゆくように', '', '二人だけの空が広がる夜に']);

    const converted = [
      { text: '沈むように溶けてゆくように', romaji: 'shizumu yō ni toke te yuku yō ni' },
      { text: '', romaji: '' },
      { text: '二人だけの空が広がる夜に', romaji: 'futari dake no sora ga hirogaru yoru ni' }
    ];
    ytmAdapter.applyRomaji(container, converted);

    assert.strictEqual(container.children.length, 3, 'Should render 3 row divs (including empty spacer)');
    assert.strictEqual(container.children[0].getAttribute('data-has-romaji'), 'true');
    assert.strictEqual(container.children[0].childNodes[0].className, 'spotify-romaji-line');
    assert.strictEqual(container.children[0].childNodes[0].textContent, 'shizumu yō ni toke te yuku yō ni');
    assert.strictEqual(container.children[0].childNodes[1].textContent, '沈むように溶けてゆくように');
    assert(container.children[1].className.includes('ytm-lyric-empty'), 'Middle line should be empty spacer');

    // Idempoten: pemanggilan ulang tidak boleh membungkus ulang baris yang sudah diproses
    ytmAdapter.applyRomaji(container, [
      { text: '沈むように溶けてゆくように', romaji: 'DUPLICATE_SHOULD_NOT_APPLY' },
      { text: '', romaji: '' },
      { text: '二人だけの空が広がる夜に', romaji: 'DUPLICATE_SHOULD_NOT_APPLY' }
    ]);
    assert.strictEqual(container.children.length, 3, 'Row count must remain 3 on re-injection');
    assert.strictEqual(container.children[0].childNodes.length, 2, 'Must not double-wrap row');
    assert.strictEqual(container.children[0].childNodes[0].textContent, 'shizumu yō ni toke te yuku yō ni');
    assert.deepStrictEqual(
      ytmAdapter.getLyricLines(container),
      ['沈むように溶けてゆくように', '', '二人だけの空が広がる夜に'],
      'Original lines must be preserved after injection'
    );

    const listeners = {};
    let hookCalls = 0;
    const hookDoc = {
      addEventListener(type, fn) { listeners[type] = fn; }
    };
    ytmAdapter.setupNavigationHooks(() => { hookCalls++; }, hookDoc);
    assert(typeof listeners['yt-navigate-finish'] === 'function', 'Must register yt-navigate-finish listener');
    assert(typeof listeners['click'] === 'function', 'Must register click listener for Lyrics tab');

    listeners['yt-navigate-finish']();
    assert(hookCalls >= 1, 'yt-navigate-finish should trigger pipeline');

    const beforeClickCalls = hookCalls;
    const lyricsTab = {
      tagName: 'TP-YT-PAPER-TAB',
      textContent: 'Lyrics',
      getAttribute(k) { return k === 'aria-selected' ? 'true' : null; }
    };
    listeners['click']({ target: lyricsTab });
    assert(hookCalls > beforeClickCalls, 'Clicking selected Lyrics tab should trigger pipeline');
  });

  // --- Test 8: User-facing strings are English only ---
  test('8. User-facing strings are English only (worldwide release)', () => {
    // The extension ships to a worldwide audience, so nothing a user can read
    // may stay in Indonesian. Comments are exempt: they are internal.
    const INDONESIAN = /\b(dan|yang|untuk|dari|dengan|pada|tidak|belum|gagal|jika|karena|juga|atau|agar|sudah|masih|bisa|hanya|semua|setiap|kata|tambah|hapus|standar|kecil|siap|memutar|belum|gunakan|prioritaskan|pratinjau|bekerja|validasi|sistem|ukuran|kamus|koreksi|dipakai|menggunakan|berbentuk|terlihat)\b/i;

    const htmlSrc = fs.readFileSync(path.join(DIST_DIR, 'popup', 'popup.html'), 'utf8');
    const htmlText = htmlSrc
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ');
    assert(!INDONESIAN.test(htmlText), `Indonesian text left in popup.html: "${htmlText.match(INDONESIAN)}"`);
    assert(/<html lang="en">/.test(htmlSrc), 'popup.html must declare lang="en"');

    const manifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest.name, 'Utagoe - Japanese Lyrics Romaji', 'Manifest name must use the Utagoe branding');
    assert(!INDONESIAN.test(manifest.description), `Manifest description is not English: "${manifest.description}"`);

    // String literals in popup.js become visible UI text (badges, tooltips).
    const popupJs = fs.readFileSync(path.join(DIST_DIR, 'popup', 'popup.js'), 'utf8');
    const literals = [...popupJs.matchAll(/'([^'\\\n]{3,})'/g), ...popupJs.matchAll(/`([^`\\\n]{3,})`/g)]
      .map(m => m[1])
      .filter(s => /\s/.test(s) || /[A-Za-z]/.test(s));
    const offenders = literals.filter(s => INDONESIAN.test(s) && !s.includes('${'));
    assert.deepStrictEqual(offenders, [], `Indonesian UI strings in popup.js: ${JSON.stringify(offenders)}`);
  });

  console.log(`\nResults: ${passed}/${total} test suites passed cleanly.`);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
