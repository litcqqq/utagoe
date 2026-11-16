# Utagoe — Japanese Lyrics Romaji 🎵🇯🇵

A **Manifest V3** browser extension (Chrome, Edge, Brave, Opera) that automatically converts Japanese lyrics written in Kanji/Kana into **Romaji** on **Spotify Web Player** (`open.spotify.com`) and **YouTube Music** (`music.youtube.com`), rendered as a **stacked two-line layout** with the Romaji sitting directly above the original line.

It ships with a **3-layer validation and correction engine** to avoid misreadings caused by **ateji (当て字)** — the common practice in Japanese songwriting of writing one Kanji but singing a completely different reading.

---

## Install

**No Node.js required.** Grab the prebuilt zip from the [latest release](https://github.com/litcqqq/utagoe/releases/latest).

### Chrome / Brave / Chromium
1. Download `utagoe-vX.Y.Z.zip` from the latest release.
2. Unzip it anywhere. You should see `manifest.json` sitting directly inside the folder — not nested one level deeper.
3. Open `chrome://extensions/`.
4. Turn on **Developer mode** (top-right).
5. Click **Load unpacked** (top-left) and select the unzipped folder.
6. The extension is now active.

### Microsoft Edge
1. Open `edge://extensions/`.
2. Turn on **Developer mode** (bottom-left panel).
3. Click **Load unpacked** and select the unzipped folder.

### Updating
Download the new zip, unzip it over the old folder, then press **Reload** on the extension card in `chrome://extensions/`.

---

## Building from source

Only needed if you want to modify the extension.

```bash
git clone https://github.com/litcqqq/utagoe.git
cd utagoe
npm install
npm run build   # produces dist/, ready to load unpacked
npm test        # verification suite
```

The build copies the Kuromoji dictionary out of `node_modules/kuromoji/dict/` into `dist/dict/`, prepares the library files, generates the PNG icons, and copies the manifest, content scripts, service worker, and popup. `dist/` is the folder you load into the browser.

`dist/dict/` is gitignored: it is ~17 MB of dictionary data that is regenerated on every build. A fresh clone has no `dist/dict/` until you run `npm run build`.

---

## Releasing

Releases are built by GitHub Actions from a tag, so nobody has to trust a zip committed to the repository.

```bash
# 1. Bump the version in BOTH package.json and src/manifest.json
# 2. Commit, then tag and push
git tag v1.0.0
git push origin v1.0.0
```

The [`Release`](.github/workflows/release.yml) workflow then installs dependencies, builds, runs the test suite, packages `dist/` into `utagoe-v1.0.0.zip`, and attaches it to a new GitHub Release.

The workflow refuses to publish if:

- the tag does not match the version in `src/manifest.json` — this prevents shipping a zip whose manifest disagrees with its label;
- `manifest.json` is not at the archive root — Chrome's *Load unpacked* cannot find a manifest nested in a subfolder;
- fewer than 10 `dict/*.dat.gz` files are present — the dictionary is gitignored, so a broken copy step would otherwise produce an extension that installs fine and then fails on every lyric with a dictionary fetch error.

To publish without pushing a tag, run the workflow manually from the Actions tab and supply the tag name.

---

## How it works

### The 3-layer validation engine

In Japanese music, artists frequently write one Kanji but sing a different reading: 運命 is written *unmei* but sung *sadame*, 本気 is written *honki* but sung *maji*, 未来 is written *mirai* but sung *asu*. A purely morphological converter gets all of these wrong. Utagoe therefore resolves each line through three layers, highest priority first:

1. **Community-verified lyrics (Lrclib API)**
   When a track starts, the extension queries Lrclib. If the community has uploaded human-verified Romaji lyrics, those are used, which guarantees the vocals and ateji match what is actually sung.
2. **Local ateji and particle dictionary**
   If the track is not in the community database, the local Kuroshiro engine takes over and corrects the Kanji words Japanese composers most often re-read (`運命 -> sadame`, `本気 -> maji`, `未来 -> asu`, `地球 -> hoshi`, and so on).
3. **Custom user dictionary**
   You can add your own Kanji-to-Romaji pairs from the popup. These are stored permanently in the browser and always win.

### Features

- **Stacked two-line display:** the Romaji sits proportionally above the original Kanji/Kana so the Japanese lyrics stay readable.
- **Four display modes:** Romaji, **furigana** (ruby readings over the Kanji), Hiragana, or Katakana — switchable from the popup.
- **Tap a word to fix its reading:** every word is individually addressable. Tapping opens an inline editor, and the corrected reading is saved to your personal dictionary and used everywhere from then on.
- **Reading confidence dots:** each line carries a dot telling you where its reading came from — green for community-verified lyrics, blue for your own corrections, amber for the ateji dictionary, grey for a machine guess.
- **Translation line:** an optional translated line under each lyric, in ten target languages.
- **Vocabulary export:** one click exports every Kanji word in the current song to a CSV (word, kana, romaji, source line, song) for Anki or a spreadsheet.
- **Conjugation-aware readings:** conjugated verbs are read as words, not fragments — 溶けてゆく is *tokete yuku*, not *toke te yuku*.
- **Validation badge:** shows whether the current track is using `[Verified (Lrclib)]` or `[Morphological transliteration]` lyrics.
- **Click-to-seek preserved:** clicking a lyric line still jumps to that timestamp in the Spotify player.
- **Karaoke colouring:** follows Spotify's active-line marker in real time.
- **Interactive settings popup:**
  - Master on/off toggle.
  - Romaji font-size ratio slider (50%–90%).
  - Display mode: Romaji, Furigana, Hiragana, Katakana.
  - Romanization system: **Hepburn** (with the macrons *ō*, *ū*) or **Passport** (plain ASCII).
  - Lrclib validator and ateji dictionary toggles.
  - Translation on/off with a target-language picker.
  - Tap-to-fix and confidence-dot toggles.
  - Vocabulary export button.
  - Form for adding custom corrections.
  - Live preview.

---

## Usage on Spotify Web

1. Open [Spotify Web Player](https://open.spotify.com) and log in.
2. Play a Japanese song (for example *YOASOBI - 夜に駆ける*).
3. Click the **Lyrics** (microphone) button in the bottom-right of the player.
4. The Romaji appears immediately above each Kanji line:
   ```text
   shizumu yō ni tokete yuku yō ni      <-- Romaji on top
   沈むように溶けてゆくように           <-- original Kanji below
   ```
5. Open the extension popup to check the validation status or add a word correction.

## Usage on YouTube Music

1. Open [YouTube Music](https://music.youtube.com) and play a Japanese song.
2. Open the track page and click the **Lyrics** tab in the side panel. The tab must be opened first, because the page only renders the lyric container once that tab is activated.
3. Each Japanese line is automatically rendered stacked, Romaji on top and the original text below.
4. On track change the extension rescans automatically (the `yt-navigate-finish` hook, a click on the Lyrics tab, a `MutationObserver`, and a 1.5-second poll). If the **Lyrics** tab gets closed or the lyrics have not appeared yet, reopen the tab.

---

## Known limitations

- **Desktop web only** (`music.youtube.com`), not the YouTube Music desktop or mobile apps.
- Lyrics must actually exist on YouTube Music for that track; if a song has no lyrics there is nothing to romanize.
- **Click-to-seek** currently works on Spotify only, not on YouTube Music.
- YouTube Music's **full-screen** lyrics view uses a different component and is not styled; only the side-panel lyrics are supported.
- Track metadata is read from `ytmusic-track-info`, with the older `ytmusic-player-bar` layout supported as a fallback.

---

## Project structure

```
src/                       extension source (edited by hand)
  manifest.json            MV3 manifest
  content/
    content.js             scan loop, observers, render pipeline, tap-to-fix UI
    readings.js            token stream: kana, romaji, confidence, vocabulary
    translate.js           lyric translation with caching
    export.js              vocabulary CSV builder and downloader
    validator.js           Lrclib client, LRC parser, header stripping
    ateji.js               ateji rulebook and custom overrides
    sites/spotify.js       Spotify DOM adapter
    sites/youtubemusic.js  YouTube Music DOM adapter
  background/
    service-worker.js      cross-origin proxies (Lrclib, translation)
  popup/                   settings UI
build.js                   copies everything into dist/
test/verify-extension.js   packaging and contract checks
test/features-1.0.1.test.js  module-level feature checks
test/render-path.test.js   content-script render path against a stub DOM
test/browser-probe.js      loads the real extension in Chrome and renders a page
dist/                      build output — this is what you load into the browser
```

### Why the service worker exists

A content script inherits the page's origin, so a `fetch()` from a content script to `lrclib.net` is blocked by CORS even when the domain appears in `host_permissions`. `host_permissions` grants cross-origin access to the service worker and extension pages, not to content scripts. All Lrclib and translation traffic therefore goes through `chrome.runtime.sendMessage` to the service worker, which performs the actual request.

### Test suites

`npm test` runs the build, the packaging checks, the feature checks, and the render-path checks. `npm run test:browser` additionally launches a real Chrome with the built extension loaded and renders a synthetic lyrics page, which is the only check that proves the manifest is accepted and the scripts run in order.

## License

ISC
