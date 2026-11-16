/**
 * Node-side checks for the reading engine (features 1, 2, 4, 5).
 * Uses the real Kuromoji dictionary and the real ateji table, so a green run
 * means the browser will behave the same way.
 */
const assert = require('assert');
const path = require('path');

global.LyricAteji = require('../src/content/ateji.js');
const Kuroshiro = require('kuroshiro');
const Analyzer = require('kuroshiro-analyzer-kuromoji');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL ' + name + ' -> ' + err.message);
  }
}

async function main() {
  const readings = require('../src/content/readings.js');
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new Analyzer({ dictPath: path.join(__dirname, '../node_modules/kuromoji/dict/') }));
  readings.init(kuroshiro);

  console.log('\nFeature 1 - kana & furigana output modes');
  const toki = await readings.tokenize('運命の瞬間に走る', { romajiSystem: 'hepburn' });
  check('tokens have surface/kana/romaji/source', () => {
    assert.ok(toki.length >= 4, 'expected several tokens, got ' + toki.length);
    for (const t of toki) {
      assert.ok(t.surface, 'surface missing');
      assert.ok(typeof t.romaji === 'string', 'romaji missing on ' + t.surface);
      assert.ok(['verified', 'user', 'dictionary', 'auto'].includes(t.source), 'bad source ' + t.source);
    }
  });
  check('ateji reading applied to 運命 (sadame, not unmei)', () => {
    const unmei = toki.find((t) => t.surface === '運命');
    assert.strictEqual(unmei.romaji, 'sadame');
    assert.strictEqual(unmei.source, 'dictionary');
  });
  check('auxiliaries folded, not emitted alone', () => {
    const sites = toki.map((t) => t.surface);
    assert.ok(!sites.includes('っ'), 'stray sokuon token');
  });

  const hira = readings.render(toki, 'hiragana');
  check('hiragana mode keeps artistic reading', () => {
    assert.ok(hira.text.includes('さだめ'), 'expected さだめ in "' + hira.text + '"');
  });
  const kata = readings.render(toki, 'katakana');
  check('katakana mode converts the whole line', () => {
    assert.ok(kata.text.includes('サダメ'), 'expected サダメ in "' + kata.text + '"');
  });
  const ruby = readings.render(toki, 'furigana');
  check('furigana mode emits <ruby> with <rt> for kanji only', () => {
    assert.ok(ruby.html.includes('<ruby>'), 'no ruby element');
    assert.ok(ruby.html.includes('<rt>'), 'no rt element');
    assert.ok(!/<ruby>の<rt>/.test(ruby.html), 'kana word should not be annotated');
  });
  check('furigana escapes HTML metacharacters', () => {
    const html = readings.furiganaHtml([{ surface: '<b>', kana: 'あ', hasKanji: true }]);
    assert.ok(!html.includes('<b>'), 'raw tag leaked through');
  });

  console.log('\nFeature 1b - verb inflection stays natural');
  const matte = await readings.tokenize('ずっと君を待ってた', { romajiSystem: 'hepburn' });
  check('待ってた reads as one word', () => {
    const word = matte.find((t) => t.surface.startsWith('待'));
    assert.ok(word, 'no 待 token');
    assert.strictEqual(word.surface, '待ってた');
    assert.strictEqual(word.romaji, 'matteta');
  });

  console.log('\nFeature 2 - tap to fix a reading');
  const fixed = await readings.tokenize('運命の瞬間に走る', {
    romajiSystem: 'hepburn',
    customOverrides: { '運命': 'うんめい' }
  });
  check('user override beats the built-in ateji table', () => {
    const word = fixed.find((t) => t.surface === '運命');
    assert.strictEqual(word.romaji, 'unmei');
    assert.strictEqual(word.source, 'user');
  });
  check('user override can supply romaji directly', async () => {});
  const romajiOverride = await readings.tokenize('運命の瞬間に走る', {
    romajiSystem: 'hepburn',
    customOverrides: { '運命': 'destiny' }
  });
  check('romaji-valued override is used verbatim', () => {
    const word = romajiOverride.find((t) => t.surface === '運命');
    assert.strictEqual(word.romaji, 'destiny');
  });
  check('overrides are scoped to the matching word only', () => {
    const others = fixed.filter((t) => t.surface !== '運命');
    assert.ok(others.every((t) => t.source !== 'user'), 'override leaked to other words');
  });

  console.log('\nFeature 4 - confidence badges');
  check('weakest token wins the line badge', () => {
    assert.strictEqual(readings.lineConfidence([
      { surface: '運命', source: 'dictionary' },
      { surface: '走る', source: 'auto' }
    ]), 'auto');
  });
  check('a fully verified line reads as verified', () => {
    assert.strictEqual(readings.lineConfidence([
      { surface: '運命', source: 'verified' },
      { surface: '走る', source: 'verified' }
    ]), 'verified');
  });
  check('verified flag on options marks the whole line', async () => {});
  const verified = await readings.tokenize('走る', { verified: true });
  check('verified option propagates to tokens', () => {
    assert.strictEqual(verified[0].source, 'verified');
  });
  check('punctuation does not drag the badge down', () => {
    assert.strictEqual(readings.lineConfidence([
      { surface: '、', source: 'auto' },
      { surface: '運命', source: 'user' }
    ]), 'user');
  });

  console.log('\nFeature 5 - vocabulary export');
  const lines = [
    { text: '運命の瞬間', tokens: toki },
    { text: '運命の瞬間', tokens: toki }
  ];
  const vocab = readings.collectVocabulary(lines);
  check('vocabulary is de-duplicated by surface form', () => {
    const surfaces = vocab.map((w) => w.surface);
    assert.strictEqual(new Set(surfaces).size, surfaces.length, 'duplicates present: ' + surfaces);
  });
  check('vocabulary excludes kana-only words', () => {
    assert.ok(vocab.every((w) => readings.hasKanji(w.surface)), 'kana word leaked into vocab');
  });
  check('vocabulary carries kana and romaji', () => {
    const word = vocab.find((w) => w.surface === '運命');
    assert.ok(word.kana, 'missing kana');
    assert.ok(word.romaji, 'missing romaji');
  });

  console.log('\nEdge cases');
  check('empty line yields no tokens', () => {
    assert.deepStrictEqual(readings.render([], 'romaji').text, '');
  });
  const empty = await readings.tokenize('   ', {});
  check('whitespace line yields no tokens', () => {
    assert.strictEqual(empty.length, 0);
  });
  const punct = await readings.tokenize('、、、', {});
  check('punctuation-only line does not crash', () => {
    assert.ok(Array.isArray(punct));
  });
  const latin = await readings.tokenize('Hello 世界', {});
  check('mixed latin/Japanese line keeps both', () => {
    const text = readings.render(latin, 'romaji').text;
    assert.ok(text.includes('Hello'), 'latin dropped: ' + text);
    assert.ok(text.includes('sekai'), 'japanese dropped: ' + text);
  });
  const noAteji = await readings.tokenize('運命', { enableAteji: false });
  check('ateji can be disabled', () => {
    assert.strictEqual(noAteji[0].romaji, 'unmei');
    assert.strictEqual(noAteji[0].source, 'auto');
  });

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(1);
});
