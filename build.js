const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirectory(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy Dictionary Files
function copyDictFiles() {
  const dictSrc = path.join(ROOT_DIR, 'node_modules', 'kuromoji', 'dict');
  const dictDest = path.join(DIST_DIR, 'dict');
  ensureDir(dictDest);

  const files = fs.readdirSync(dictSrc);
  console.log(`Copying ${files.length} dictionary files to dist/dict/...`);
  files.forEach(file => {
    fs.copyFileSync(path.join(dictSrc, file), path.join(dictDest, file));
  });
}

// 2. Prepare Library Files
function prepareLibs() {
  const libDest = path.join(DIST_DIR, 'lib');
  ensureDir(libDest);

  // Kuroshiro
  const kuroshiroSrc = path.join(ROOT_DIR, 'node_modules', 'kuroshiro', 'dist', 'kuroshiro.min.js');
  fs.copyFileSync(kuroshiroSrc, path.join(libDest, 'kuroshiro.min.js'));
  console.log('Copied kuroshiro.min.js');

  // Kuromoji Analyzer with fetch-based loader patch
  const analyzerSrc = path.join(ROOT_DIR, 'node_modules', 'kuroshiro-analyzer-kuromoji', 'dist', 'kuroshiro-analyzer-kuromoji.js');
  let analyzerCode = fs.readFileSync(analyzerSrc, 'utf8');

  // Regex to replace BrowserDictionaryLoader.prototype.loadArrayBuffer
  const targetPattern = /BrowserDictionaryLoader\.prototype\.loadArrayBuffer\s*=\s*function\s*\([^\)]*\)\s*\{[\s\S]*?xhr\.send\(\);\s*\};/;
  
  // kuromoji builds URLs with path.join, which collapses "scheme://host" into
  // "scheme:/host". Restore the double slash so chrome-extension:// URLs resolve.
  const fetchReplacement = `BrowserDictionaryLoader.prototype.loadArrayBuffer = function (url, callback) {
    url = String(url).replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\\/(?!\\/)/, "$1://");
    fetch(url)
        .then(function (res) {
            if (!res.ok && res.status !== 0) {
                throw new Error("HTTP error " + res.status + " " + res.statusText);
            }
            return res.arrayBuffer();
        })
        .then(function (arraybuffer) {
            var gz = new zlib.Zlib.Gunzip(new Uint8Array(arraybuffer));
            var typed_array = gz.decompress();
            callback(null, typed_array.buffer);
        })
        .catch(function (err) {
            callback(err, null);
        });
};`;

  if (targetPattern.test(analyzerCode)) {
    analyzerCode = analyzerCode.replace(targetPattern, () => fetchReplacement);
    console.log('Successfully patched BrowserDictionaryLoader to use fetch API');
  } else {
    console.warn('Warning: Could not find BrowserDictionaryLoader pattern, using original code');
  }

  fs.writeFileSync(path.join(libDest, 'kuroshiro-analyzer-kuromoji.min.js'), analyzerCode, 'utf8');
}

// 3. Generate PNG Icons
function generatePNG(width, height, drawFn) {
  function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
      table[i] = c;
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ (-1)) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlineLen = width * 4;
  const rawData = Buffer.alloc(height * (scanlineLen + 1));

  for (let y = 0; y < height; y++) {
    rawData[y * (scanlineLen + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * (scanlineLen + 1) + 1 + (x * 4);
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = a;
    }
  }

  const idat = zlib.deflateSync(rawData);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend)
  ]);
}

function createIcons() {
  const iconDest = path.join(DIST_DIR, 'icons');
  ensureDir(iconDest);

  // Prefer hand-authored icons in src/icons/ — the generated fallback below
  // only draws the old placeholder "R" glyph and would overwrite the real art.
  const srcIcons = path.join(SRC_DIR, 'icons');
  const sizes = [16, 48, 128];
  const hasAllSrcIcons = sizes.every(size =>
    fs.existsSync(path.join(srcIcons, `icon${size}.png`))
  );

  if (hasAllSrcIcons) {
    sizes.forEach(size => {
      fs.copyFileSync(
        path.join(srcIcons, `icon${size}.png`),
        path.join(iconDest, `icon${size}.png`)
      );
    });
    console.log('Copied extension icons from src/icons (16, 48, 128)');
    return;
  }


  const drawIcon = (x, y, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.46;
    const dist = Math.hypot(x - cx, y - cy);

    if (dist > r) return [0, 0, 0, 0];
    const edgeAlpha = Math.min(1, Math.max(0, (r - dist) * 2));

    const nx = x / w;
    const ny = y / h;

    let isGlyph = false;
    // Left stem of R
    if (nx >= 0.30 && nx <= 0.40 && ny >= 0.25 && ny <= 0.75) isGlyph = true;
    // Top bar of R
    if (nx >= 0.35 && nx <= 0.65 && ny >= 0.25 && ny <= 0.34) isGlyph = true;
    // Middle bar of R
    if (nx >= 0.35 && nx <= 0.65 && ny >= 0.47 && ny <= 0.56) isGlyph = true;
    // Right curved loop of R
    if (nx >= 0.60 && nx <= 0.70 && ny >= 0.28 && ny <= 0.53) isGlyph = true;
    // Diagonal leg of R
    if (ny >= 0.50 && ny <= 0.75) {
      const legX = 0.42 + (ny - 0.50) * 1.15;
      if (Math.abs(nx - legX) < 0.06) isGlyph = true;
    }

    if (isGlyph) {
      return [29, 185, 84, Math.round(255 * edgeAlpha)]; // Spotify green
    }

    return [25, 20, 20, Math.round(255 * edgeAlpha)]; // Dark background
  };

  [16, 48, 128].forEach(size => {
    const pngBuf = generatePNG(size, size, drawIcon);
    fs.writeFileSync(path.join(iconDest, `icon${size}.png`), pngBuf);
  });
  console.log('Generated extension icons (16, 48, 128)');
}

// 4. Copy Extension Source Files (manifest, content, popup)
function copySourceFiles() {
  // Manifest
  fs.copyFileSync(path.join(SRC_DIR, 'manifest.json'), path.join(DIST_DIR, 'manifest.json'));
  console.log('Copied manifest.json');

  // Content
  copyDirectory(path.join(SRC_DIR, 'content'), path.join(DIST_DIR, 'content'));
  console.log('Copied content scripts & css');

  // Background (service worker)
  copyDirectory(path.join(SRC_DIR, 'background'), path.join(DIST_DIR, 'background'));
  console.log('Copied background service worker');

  // Popup
  copyDirectory(path.join(SRC_DIR, 'popup'), path.join(DIST_DIR, 'popup'));
  console.log('Copied popup html, css, js');
}

function build() {
  console.log('--- Starting build ---');
  ensureDir(DIST_DIR);
  copyDictFiles();
  prepareLibs();
  createIcons();
  copySourceFiles();
  console.log('--- Build complete: dist/ is ready to be loaded as unpacked extension! ---');
}

build();
