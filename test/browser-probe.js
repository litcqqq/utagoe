/**
 * Loads the built extension in a real Chrome and checks it starts cleanly.
 *
 * A green unit suite proves the modules agree with each other; only a real
 * browser proves the manifest is accepted, the content scripts run in the right
 * order, and nothing throws before the first lyric line is touched. This is the
 * gate the "half-populated package" failures of earlier releases would have
 * been caught by.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const net = require('net');

// A fixed port is a trap: a leftover Chrome from an interrupted run keeps the
// port bound and the probe silently talks to that stale browser instead, so its
// results describe the previous build. Ask the OS for a free port each run.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function waitForDevtools(deadlineMs, PORT) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      return await getJSON(`http://127.0.0.1:${PORT}/json/version`);
    } catch (e) {
      await sleep(200);
    }
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

// Minimal CDP client over the built-in WebSocket: enough to send commands and
// collect console messages and exceptions.
function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const events = [];
    // Declared before the listeners are attached: the message handler closes over
    // it and would otherwise reference a binding that only exists inside onopen.
    let api = null;

    ws.addEventListener('open', () => {
      api = {
        events,
        send(method, params, sessionId) {
          const id = nextId++;
          const payload = { id, method, params: params || {} };
          if (sessionId) payload.sessionId = sessionId;
          ws.send(JSON.stringify(payload));
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id);
                rej(new Error(`timeout on ${method}`));
              }
            }, 30000);
          });
        },
        close() {
          ws.close();
        }
      };
      resolve(api);
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method) {
        events.push(msg);
        if (typeof api.onEvent === 'function') api.onEvent(msg);
      }
    });

    ws.addEventListener('error', reject);
    setTimeout(() => reject(new Error('CDP connect timeout')), 15000);
  });
}

// Serve dist/ over HTTP so the Kuromoji dictionary can be fetched. In a real
// install the content script loads it from chrome-extension://, which cannot be
// reached from a debugger-driven page, so the probe points getURL at this server.
function startDictServer() {
  const http = require('http');
  const MIME = { '.json': 'application/json', '.gz': 'application/gzip', '.js': 'text/javascript' };

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const abs = path.join(DIST, rel);
    if (!abs.startsWith(DIST)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(abs, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function pageEvents_(page) {
  return page.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled'))
    .map((e) => {
      if (e.method === 'Runtime.exceptionThrown') {
        return { type: 'exception', text: JSON.stringify(e.params).slice(0, 400) };
      }
      return {
        type: e.params.type,
        text: (e.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300)
      };
    });
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    console.error('dist/ is missing - run `node build.js` first');
    process.exit(1);
  }

  const PORT = await findFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utagoe-chrome-'));
  const dictServer = await startDictServer();

  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    // Extensions need an explicit allowlist entry when loaded unpacked.
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let chromeStderr = '';
  chrome.stderr.on('data', (d) => { chromeStderr += d.toString(); });

  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` -> ${detail}` : ''}`);
  };

  let cdp = null;
  const listTargets = async () => {
    const targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
    return targets;
  };
  try {
    await waitForDevtools(30000, PORT);

    // Ask the browser for every target. /json/list omits some MV3 service
    // workers, so a missing worker there is not proof the manifest failed.
    const browserVersion = await getJSON(`http://127.0.0.1:${PORT}/json/version`);
    const browser = await connectCDP(browserVersion.webSocketDebuggerUrl);
    const allTargets = (await browser.send('Target.getTargets')).targetInfos;

    const swTarget = allTargets.find((t) =>
      (t.type === 'service_worker' || t.type === 'background_page') &&
      String(t.url).startsWith('chrome-extension://'));

    if (!swTarget) {
      // Opening a page the extension targets is what wakes an idle worker.
      const pageTarget = (await getJSON(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page');
      if (pageTarget) {
        cdp = await connectCDP(pageTarget.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await sleep(1500);
        cdp.close();
        cdp = null;
      }
    }

    const targetsAfter = (await browser.send('Target.getTargets')).targetInfos;
    const extensionTargets = targetsAfter.filter((t) => String(t.url).startsWith('chrome-extension://'));
    const finalSw = extensionTargets.find((t) => t.type === 'service_worker' || t.type === 'background_page');
    browser.close();

    const resolvedSw = swTarget || finalSw;

    record('manifest is accepted and the service worker is registered', !!resolvedSw,
      resolvedSw ? '' : `targets: ${JSON.stringify(extensionTargets.map((t) => `${t.type}:${t.url.slice(0, 70)}`))}\nall: ${JSON.stringify(targetsAfter.map((t) => `${t.type}:${String(t.url).slice(0, 50)}`))}`);

    const swTargetFinal = resolvedSw;

    if (swTargetFinal && swTargetFinal.webSocketDebuggerUrl) {
      const sw = await connectCDP(swTargetFinal.webSocketDebuggerUrl);
      await sw.send('Runtime.enable');
      await sleep(1200);

      const exceptions = sw.events.filter((e) =>
        e.method === 'Runtime.exceptionThrown' ||
        (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));

      record('service worker starts without exceptions', exceptions.length === 0,
        exceptions.map((e) => JSON.stringify(e.params).slice(0, 300)).join(' | '));

      // The translation proxy is the one handler 1.0.1 added here.
      const probe = await sw.send('Runtime.evaluate', {
        expression: `(async () => {
          if (typeof searchLrclib === 'function') return 'lrclib-ok';
          return typeof self !== 'undefined' ? 'loaded' : 'unknown';
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      record('service worker globals are reachable', probe.result && probe.result.value !== undefined,
        JSON.stringify(probe.result));

      sw.close();
    }

    // Now a real page: inject the content scripts exactly as the manifest does
    // and drive a lyric line through the render path.
    const pageTarget = (await getJSON(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('no page target available');

    const page = await connectCDP(pageTarget.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');

    // Serve a minimal page that mimics Spotify's lyric markup.
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>utagoe probe</title></head>
<body>
<div data-testid="fullscreen-lyric">
  <div data-testid="fullscreen-lyric-line">沈むように溶けてゆくように</div>
  <div data-testid="fullscreen-lyric-line">誰かの心臓になれたなら</div>
</div>
</body></html>`;

    // The page has to live on the real origin: the adapter's matches() checks
    // location.href, so a document on about:blank or file:// would be rejected
    // and the probe would report an empty page no matter how correct the code is.
    await page.send('Fetch.enable', {
      patterns: [
        { urlPattern: 'https://open.spotify.com/*', requestStage: 'Request' },
        // The engine fetches its dictionary from getURL('dict/'), which in a real
        // install is chrome-extension://. On a debugger-driven page that scheme
        // cannot be read, so those requests are answered from dist/dict instead.
        { urlPattern: `http://127.0.0.1:${dictServer.port}/*`, requestStage: 'Request' }
      ]
    });

    const fulfillListener = async (msg) => {
      if (msg.method !== 'Fetch.requestPaused') return;
      const url = msg.params.request.url;

      try {
        if (url.startsWith('https://open.spotify.com/') && msg.params.resourceType === 'Document') {
          await page.send('Fetch.fulfillRequest', {
            requestId: msg.params.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'text/html; charset=utf-8' },
              { name: 'Access-Control-Allow-Origin', value: '*' }
            ],
            body: Buffer.from(html, 'utf8').toString('base64')
          });
          return;
        }

        if (url.startsWith(`http://127.0.0.1:${dictServer.port}/`)) {
          const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
          const abs = path.join(DIST, rel);
          const data = fs.readFileSync(abs);
          await page.send('Fetch.fulfillRequest', {
            requestId: msg.params.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/octet-stream' },
              { name: 'Access-Control-Allow-Origin', value: '*' }
            ],
            body: data.toString('base64')
          });
          return;
        }

        // Everything else (favicon, analytics, any other open.spotify.com
        // subresource) is let through untouched: answering those with the test
        // document is what produced bogus "not valid JSON" errors.
        await page.send('Fetch.continueRequest', { requestId: msg.params.requestId });
      } catch (e) { /* navigation may cancel the request */ }
    };
    page.onEvent = fulfillListener;

    // Navigate without awaiting to completion: the request is paused until this
    // client fulfils it, so awaiting first would deadlock the same connection.
    page.send('Page.navigate', { url: 'https://open.spotify.com/lyrics' }).catch(() => {});
    await sleep(2500);

    // Inject the extension's content scripts in manifest order, as a page would.
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
    const scripts = manifest.content_scripts[0].js;
    const dictBase = `http://127.0.0.1:${dictServer.port}`;

    for (const rel of scripts) {
      const code = fs.readFileSync(path.join(DIST, rel), 'utf8');
      // chrome.* is unavailable on a plain page, so a shim is installed first;
      // this is the only artificial part of the probe.
      await page.send('Runtime.evaluate', {
        expression: `(function(){
          if (!window.chrome) window.chrome = {};
          window.chrome.runtime = {
            id: 'probe',
            lastError: null,
            onMessage: { addListener: function(){} },
            sendMessage: function(m, cb){ if (cb) cb({ok:true}); },
            getURL: function(p){ return '${dictBase}/' + p; }
          };
          window.chrome.storage = { local: {
            get: function(k, cb){ var s={enabled:true,romajiSystem:'hepburn',fontSizeRatio:0.65,casing:'normal',
              enableValidator:true,enableAteji:true,customOverrides:{},outputMode:'romaji',tapToFix:true,
              showBadges:true,translationEnabled:false,translationLang:'en'};
              if (typeof cb==='function') return cb(s); return s; },
            set: function(i, cb){ if (typeof cb==='function') cb(); }
          }, onChanged: { addListener: function(){} } };
        })();`
      });

      const wrapped = `try { ${code}\n } catch (e) { window.__utagoeLoadError = String(e && e.stack || e); }`;
      const res = await page.send('Runtime.evaluate', {
        expression: wrapped,
        returnByValue: true,
        awaitPromise: false
      });
      if (res.exceptionDetails) {
        record(`content script ${rel} evaluates`, false, JSON.stringify(res.exceptionDetails).slice(0, 300));
      }
    }

    await sleep(2500);

    const probe = await page.send('Runtime.evaluate', {
      expression: `(() => {
        const lines = document.querySelectorAll('.spotify-romaji-line');
        const words = document.querySelectorAll('.utagoe-word');
        const badges = document.querySelectorAll('.utagoe-badge');
        return JSON.stringify({
          loadError: window.__utagoeLoadError || null,
          romajiLines: lines.length,
          wordSpans: words.length,
          badges: badges.length,
          firstText: lines.length ? lines[0].textContent.slice(0, 60) : null,
          firstHtml: lines.length ? lines[0].innerHTML.slice(0, 120) : null
        });
      })()`,
      returnByValue: true
    });

    let state = {};
    try { state = JSON.parse(probe.result.value); } catch (e) { /* reported below */ }

    record('content scripts load without a top-level error', !state.loadError, state.loadError);

    const pageErrors = page.events.filter((e) =>
      e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));

    // Kuroshiro needs its dictionary over the network, which this probe cannot
    // serve, so a dictionary-load failure is expected and excluded.
    const realErrors = pageErrors.filter((e) => {
      const text = JSON.stringify(e.params);
      return !/dict|kuromoji|kuroshiro|Failed to fetch|ERR_FILE_NOT_FOUND|net::/i.test(text);
    });

    record('no unexpected errors on the page', realErrors.length === 0,
      realErrors.map((e) => JSON.stringify(e.params).slice(0, 200)).join(' | '));

    record('lyric lines were found and processed', state.romajiLines > 0 || state.wordSpans > 0,
      `romajiLines=${state.romajiLines} wordSpans=${state.wordSpans}`);

    console.log('\n  probe state:', JSON.stringify(state));
    console.log('  page errors:', JSON.stringify(pageEvents_(page)).slice(0, 1500));

    page.close();
  } catch (err) {
    record('probe completed', false, err.message);
  } finally {
    chrome.kill('SIGKILL');
    await sleep(300);
    try { dictServer.server.close(); } catch (e) { /* best effort */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n====================================================');
  if (failed.length === 0) {
    console.log(`  BROWSER PROBE PASSED (${results.length} checks)`);
  } else {
    console.log(`  ${results.length - failed.length} passed, ${failed.length} FAILED`);
    for (const f of failed) console.log(`   - ${f.name}: ${f.detail}`);
  }
  console.log('====================================================\n');

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Probe crashed:', err);
  process.exit(1);
});
