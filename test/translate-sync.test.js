/**
 * Lyric↔timestamp sync and numbered-batch alignment verification suite.
 *
 * Exercises both `src/content/translate.js` (direct-fetch fallback) and
 * `dist/background/service-worker.js` (`UTAGOE_TRANSLATE` handler) against a
 * stubbed transport that simulates Google Translate's fragment-merging behaviour.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const LyricTranslate = require(path.join(ROOT, 'src', 'content', 'translate.js'));
const realFetch = global.fetch;

let passed = 0;
let failed = 0;
const failures = [];

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    failures.push(`${name}: ${err && err.message ? err.message : String(err)}`);
    console.error(`  [FAIL] ${name}`);
    console.error(err);
  }
}

function parseQueryFromUrl(url) {
  const u = new URL(url);
  return u.searchParams.get('q') || '';
}

function makeGtxResponse(segments) {
  return {
    ok: true,
    status: 200,
    json: async () => [segments.map((text) => [text, 'src'])]
  };
}

function loadServiceWorker(fetchImpl) {
  let messageListener = null;
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    Date,
    Map,
    encodeURIComponent,
    fetch: fetchImpl,
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            messageListener = fn;
          }
        }
      }
    }
  };
  const swPath = fs.existsSync(path.join(DIST, 'background', 'service-worker.js'))
    ? path.join(DIST, 'background', 'service-worker.js')
    : path.join(ROOT, 'src', 'background', 'service-worker.js');
  const code = fs.readFileSync(swPath, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'service-worker.js' });

  return function sendTranslateMessage(texts, targetLang = 'en', sourceLang = 'ja') {
    return new Promise((resolve, reject) => {
      const handled = messageListener(
        { type: 'UTAGOE_TRANSLATE', texts, targetLang, sourceLang },
        {},
        (response) => resolve(response)
      );
      if (!handled) {
        reject(new Error('Service worker did not handle UTAGOE_TRANSLATE'));
      }
    });
  };
}

async function main() {
  console.log('====================================================');
  console.log('   UTAGOE - TRANSLATION SYNC & ALIGNMENT SUITE      ');
  console.log('====================================================\n');

  const FRAGMENT_MAP = {
    'この声が': 'This voice',
    '君の名前を呼んだ': 'called your name',
    '夜の中で': 'in the middle of the night',
    '忘れないで': 'do not forget',
    '遠くても': 'even if far away'
  };

  // (a) Numbered batch path recovers n correctly-aligned lines even when Google
  // merges two fragments into a single sentence block (fewer newline-delimited
  // lines than input).
  await testAsync('1. numbered batch recovers n aligned lines when Google merges fragments into one sentence block', async () => {
    const queries = [];
    global.fetch = async (url) => {
      const q = parseQueryFromUrl(url);
      queries.push(q);

      // Verify payload uses 0-based {{i}} markers joined with \n
      assert.strictEqual(
        q,
        '{{0}}この声が\n{{1}}君の名前を呼んだ\n{{2}}夜の中で',
        `Unexpected numbered batch payload: ${JSON.stringify(q)}`
      );

      // Simulate Google merging fragments 0 and 1 into one sentence block with no newline
      // between them (returning 2 lines instead of 3).
      return makeGtxResponse([
        '{{0}}This voice {{1}}called your name\n',
        '{{2}}in the middle of the night'
      ]);
    };

    LyricTranslate.clearCache();
    const input = ['この声が', '君の名前を呼んだ', '夜の中で'];
    const out = await LyricTranslate.translateLines(input, { targetLang: 'en' });

    assert.strictEqual(queries.length, 1, `Expected 1 batch request, got ${queries.length}`);
    assert.strictEqual(out.length, input.length, 'Output length must equal input length');
    assert.deepStrictEqual(out, [
      'This voice',
      'called your name',
      'in the middle of the night'
    ]);
  });

  // Tolerate extra whitespace around markers or a marker moved onto its own line.
  await testAsync('2. numbered batch tolerates extra whitespace and markers moved onto their own line', async () => {
    global.fetch = async () => makeGtxResponse([
      '  {{0}}   \nThis voice  \n',
      '   {{1}}   called your name \r\n',
      '{{2}}\r\n  in the middle of the night  '
    ]);

    LyricTranslate.clearCache();
    const input = ['この声が', '君の名前を呼んだ', '夜の中で'];
    const out = await LyricTranslate.translateLines(input, { targetLang: 'en' });

    assert.strictEqual(out.length, input.length);
    assert.deepStrictEqual(out, [
      'This voice',
      'called your name',
      'in the middle of the night'
    ]);
  });

  // (b) When markers are destroyed (unmarked merged text returned), the code falls
  // back through the plain newline batch (which also merges and fails count check)
  // to per-line translation and STILL returns an array of exactly lines.length
  // with correct index alignment, never a shifted array.
  await testAsync('3. destroyed markers fall back to per-line translation and preserve exact index alignment', async () => {
    const queries = [];
    global.fetch = async (url) => {
      const q = parseQueryFromUrl(url);
      queries.push(q);

      if (q.includes('\n')) {
        // Both numbered batch and plain newline batch have their markers stripped
        // and fragments 0+1 merged into a single sentence line (2 lines returned for 3 inputs).
        return makeGtxResponse([
          'This voice called your name\n',
          'in the middle of the night'
        ]);
      }

      // Per-line fallback request
      assert(Object.prototype.hasOwnProperty.call(FRAGMENT_MAP, q), `Unexpected per-line query: ${q}`);
      return makeGtxResponse([FRAGMENT_MAP[q]]);
    };

    LyricTranslate.clearCache();
    const input = ['この声が', '君の名前を呼んだ', '夜の中で'];
    const out = await LyricTranslate.translateLines(input, { targetLang: 'en' });

    // 1 numbered batch + 1 plain newline batch + 3 individual requests = 5 calls
    assert.strictEqual(queries.length, 5, `Expected 5 requests in fallback chain, got ${queries.length}`);
    assert.strictEqual(out.length, input.length, 'Fallback must return exact input length');
    assert.deepStrictEqual(out, [
      'This voice',
      'called your name',
      'in the middle of the night'
    ]);
  });

  // Strict validation: missing, duplicate, out-of-range, empty-body, or stray
  // unindexed lines must never be "repaired" and must fall back cleanly.
  await testAsync('4. strict validation rejects malformed numbered responses (missing, duplicate, out-of-range, empty body)', async () => {
    const malformedPayloads = [
      // Missing index 1 (only 0 and 2 present)
      '{{0}}This voice called your name\n{{2}}in the middle of the night',
      // Duplicate index 0
      '{{0}}This voice\n{{0}}called your name\n{{1}}in the middle of the night',
      // Out-of-range index 9
      '{{0}}This voice\n{{1}}called your name\n{{9}}in the middle of the night',
      // Empty body for non-empty source line 0
      '{{0}}\n{{1}}called your name\n{{2}}in the middle of the night',
      // Stray unmarked text before markers
      'Unmarked preamble\n{{0}}This voice\n{{1}}called your name\n{{2}}in the middle of the night'
    ];

    const input = ['この声が', '君の名前を呼んだ', '夜の中で'];

    for (const badResponse of malformedPayloads) {
      let numberedAttempts = 0;
      let plainBatchAttempts = 0;

      global.fetch = async (url) => {
        const q = parseQueryFromUrl(url);
        if (q.startsWith('{{0}}')) {
          numberedAttempts++;
          return makeGtxResponse([badResponse]);
        }
        if (q.includes('\n')) {
          plainBatchAttempts++;
          return makeGtxResponse([
            'This voice\n',
            'called your name\n',
            'in the middle of the night'
          ]);
        }
        return makeGtxResponse([FRAGMENT_MAP[q] || '']);
      };

      LyricTranslate.clearCache();
      const out = await LyricTranslate.translateLines(input, { targetLang: 'en' });

      assert.strictEqual(numberedAttempts, 1, `Numbered attempt did not run for payload: ${badResponse}`);
      assert.strictEqual(plainBatchAttempts, 1, `Malformed payload should have fallen through to plain batch: ${badResponse}`);
      assert.deepStrictEqual(out, [
        'This voice',
        'called your name',
        'in the middle of the night'
      ]);
    }
  });

  // Duplicate lines collapse before sending the numbered batch and write back to
  // every matching original index (specifically testing duplicate source line at indices 2 and 5).
  await testAsync('5. duplicate source lines at indices 2 and 5 collapse in numbered batch and receive identical translations', async () => {
    const queries = [];
    global.fetch = async (url) => {
      const q = parseQueryFromUrl(url);
      queries.push(q);

      // Input has 6 lines, with index 2 and index 5 both equal to '忘れないで'
      // Unique translatable lines are 5: indices 0..4 in the deduplicated batch.
      assert.strictEqual(
        q,
        '{{0}}この声が\n{{1}}君の名前を呼んだ\n{{2}}忘れないで\n{{3}}夜の中で\n{{4}}遠くても',
        `Deduplicated numbered batch mismatch: ${q}`
      );

      // Simulate Google merging {{0}} and {{1}} onto one line while preserving markers
      return makeGtxResponse([
        '{{0}}This voice {{1}}called your name\n',
        '{{2}}do not forget\n',
        '{{3}}in the middle of the night\n',
        '{{4}}even if far away'
      ]);
    };

    LyricTranslate.clearCache();
    const lines = [
      'この声が',           // 0
      '君の名前を呼んだ',   // 1
      '忘れないで',         // 2 (duplicate with 5)
      '夜の中で',           // 3
      '遠くても',           // 4
      '忘れないで'          // 5 (duplicate with 2)
    ];

    const out = await LyricTranslate.translateLines(lines, { targetLang: 'en' });

    assert.strictEqual(queries.length, 1, 'Expected a single deduplicated numbered batch request');
    assert.strictEqual(out.length, lines.length, 'Output length must match full input length (6)');
    assert.strictEqual(out[2], 'do not forget');
    assert.strictEqual(out[5], 'do not forget');
    assert.strictEqual(out[2], out[5], 'Indices 2 and 5 must have identical translations');
    assert.deepStrictEqual(out, [
      'This voice',
      'called your name',
      'do not forget',
      'in the middle of the night',
      'even if far away',
      'do not forget'
    ]);
  });

  // Service worker path: verify `dist/background/service-worker.js` implements
  // the exact same numbered-batch and fallback guarantees.
  await testAsync('6. service worker UTAGOE_TRANSLATE recovers merged fragments via numbered batch and falls back when markers are destroyed', async () => {
    const input = ['この声が', '君の名前を呼んだ', '夜の中で'];

    // Case A: service worker numbered batch succeeds when Google merges lines
    let swCallsA = 0;
    const sendA = loadServiceWorker(async () => {
      swCallsA++;
      return makeGtxResponse([
        '{{0}}This voice {{1}}called your name\n',
        '{{2}}in the middle of the night'
      ]);
    });

    const resA = await sendA(input, 'en', 'ja');
    assert.strictEqual(resA.ok, true);
    assert.strictEqual(swCallsA, 1);
    assert.strictEqual(resA.translations.length, input.length);
    assert.deepStrictEqual(Array.from(resA.translations), [
      'This voice',
      'called your name',
      'in the middle of the night'
    ]);

    // Case B: service worker falls back to per-line when markers are destroyed and batch merges lines
    let swCallsB = 0;
    const sendB = loadServiceWorker(async (url) => {
      swCallsB++;
      const q = parseQueryFromUrl(url);
      if (q.includes('\n')) {
        return makeGtxResponse([
          'This voice called your name\n',
          'in the middle of the night'
        ]);
      }
      return makeGtxResponse([FRAGMENT_MAP[q]]);
    });

    const resB = await sendB(input, 'en', 'ja');
    assert.strictEqual(resB.ok, true);
    assert.strictEqual(swCallsB, 5);
    assert.strictEqual(resB.translations.length, input.length);
    assert.deepStrictEqual(Array.from(resB.translations), [
      'This voice',
      'called your name',
      'in the middle of the night'
    ]);
  });

  // Opt-in live test against https://translate.googleapis.com/translate_a/single?client=gtx
  if (process.env.UTAGOE_LIVE === '1') {
    await testAsync('7. [LIVE] Google Translate GTX endpoint preserves {{0}}..{{4}} markers and returns 5 aligned non-empty entries for en and id', async () => {
      if (typeof realFetch !== 'function') {
        throw new Error('[UTAGOE_LIVE] global fetch is unavailable in this Node runtime');
      }

      const liveFragments = [
        'この声が',
        '君の名前を呼んだ',
        '変わることのない愛をくれるのはだれ',
        '好きだよ',
        '笑ってた'
      ];
      const expectedPayload = liveFragments.map((line, i) => `{{${i}}}${line}`).join('\n');

      for (const lang of ['en', 'id']) {
        let requestCount = 0;
        let networkError = null;
        let rawTranslated = '';

        global.fetch = async (url, options) => {
          requestCount++;
          const u = new URL(url);
          assert.strictEqual(
            `${u.origin}${u.pathname}`,
            'https://translate.googleapis.com/translate_a/single',
            `[UTAGOE_LIVE] Unexpected endpoint URL: ${url}`
          );
          assert.strictEqual(u.searchParams.get('client'), 'gtx');
          if (requestCount === 1) {
            assert.strictEqual(
              u.searchParams.get('q'),
              expectedPayload,
              `[UTAGOE_LIVE] Expected numbered batch payload with {{0}}..{{4}} markers for lang=${lang}`
            );
          }

          let res;
          try {
            res = await realFetch(url, options);
          } catch (err) {
            networkError = new Error(
              `[UTAGOE_LIVE] Network unavailable when requesting Google Translate (lang=${lang}): ${err && err.message ? err.message : String(err)}`
            );
            throw networkError;
          }

          if (!res.ok) {
            networkError = new Error(
              `[UTAGOE_LIVE] Google Translate returned HTTP ${res.status} for lang=${lang}`
            );
            throw networkError;
          }

          const cloned = res.clone();
          const data = await cloned.json();
          if (requestCount === 1 && Array.isArray(data) && Array.isArray(data[0])) {
            rawTranslated = data[0]
              .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
              .join('');
          }
          return res;
        };

        LyricTranslate.clearCache();
        const out = await LyricTranslate.translateLines(liveFragments, { targetLang: lang });

        if (networkError) {
          throw networkError;
        }

        const missingMarkers = [];
        for (let i = 0; i < liveFragments.length; i++) {
          if (!rawTranslated.includes(`{{${i}}}`)) {
            missingMarkers.push(`{{${i}}}`);
          }
        }

        if (missingMarkers.length > 0 || requestCount !== 1) {
          throw new Error(
            `[UTAGOE_LIVE] Numbered markers did not survive or numbered parse rejected live response for lang=${lang} ` +
            `(requests=${requestCount}, missingMarkers=${missingMarkers.join(',') || 'none'}, raw=${JSON.stringify(rawTranslated)})`
          );
        }

        assert.ok(Array.isArray(out), `[UTAGOE_LIVE] Expected array output for lang=${lang}`);
        assert.strictEqual(
          out.length,
          5,
          `[UTAGOE_LIVE] Expected exactly 5 aligned entries for lang=${lang}, got ${out.length}`
        );

        for (let i = 0; i < 5; i++) {
          assert.strictEqual(typeof out[i], 'string', `[UTAGOE_LIVE] Entry ${i} for lang=${lang} must be a string`);
          assert.ok(
            out[i].trim().length > 0,
            `[UTAGOE_LIVE] Entry ${i} for lang=${lang} must be non-empty (got ${JSON.stringify(out[i])})`
          );
          assert.ok(
            !out[i].includes('{{') && !out[i].includes('}}'),
            `[UTAGOE_LIVE] Entry ${i} for lang=${lang} still contains marker brackets: ${JSON.stringify(out[i])}`
          );
        }

        console.log(`    [LIVE ${lang}] -> ${JSON.stringify(out)}`);
      }
    });
  } else {
    console.log('  [SKIP] 7. [LIVE] Google Translate GTX endpoint check (set UTAGOE_LIVE=1 to run)');
  }

  global.fetch = realFetch;

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`  ALL TRANSLATE SYNC CHECKS PASSED (${passed} checks)`);
  } else {
    console.log(`  ${passed} passed, ${failed} FAILED`);
    for (const f of failures) console.log(`   - ${f}`);
  }
  console.log('====================================================\n');

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
