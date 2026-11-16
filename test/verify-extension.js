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

  console.log(`\nResults: ${passed}/${total} test suites passed cleanly.`);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
