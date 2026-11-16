# 1.0.1 Feature Spec — "The Accuracy Update"

Repo: `/home/ubuntu/projects/romanji-lyrics-translator` (extension `utagoe`, MV3).
All code, comments, and UI strings MUST be English. No Indonesian anywhere.

## Shared contract

The content script now produces, for every lyric line, an array of **tokens**:

```js
{
  surface: '運命',        // original text fragment (may be kana, kanji, latin, punctuation)
  kana:    'さだめ',      // hiragana reading (same as surface when the fragment is already kana)
  romaji:  'sadame',      // romaji of `kana`, honouring the selected romaji system
  source:  'verified' | 'dictionary' | 'user' | 'auto'
}
```

`source` drives the confidence badge:
- `verified`   — line came from Lrclib community-verified lyrics
- `user`       — reading came from the user's custom override dictionary
- `dictionary` — reading came from the built-in ateji dictionary
- `auto`       — plain Kuromoji morphological reading

A line's badge is the **weakest** source present among its content tokens
(`verified` > `user` > `dictionary` > `auto`).

Module `src/content/readings.js` owns tokenisation, the kana→romaji converter and
all four render modes (`romaji`, `hiragana`, `katakana`, `furigana`).

---

## Feature 1 — Furigana & kana output modes
New `outputMode` setting: `romaji` | `hiragana` | `katakana` | `furigana`.
- `furigana` renders `<ruby>漢字<rt>かんじ</rt></ruby>` style annotation, stacked
  above the original line.
- Ateji correction applies in every mode (it rewrites the reading, not the script).

## Feature 2 — Tap a word to fix its reading
Words in the romaji/kana line are individually tappable. Tapping opens a small
inline editor (never `window.prompt`) prefilled with the current reading. Saving
writes `customOverrides[surface] = reading` to `chrome.storage.local`, which
re-renders immediately and persists globally for future songs.

## Feature 3 — Translation line
Second stacked line under the romaji line, showing the lyric translated into the
user's chosen language. Cached hard, degrades silently to nothing on failure.

## Feature 4 — Confidence badges
Tiny per-line marker (a dot) colour-coded by the line's weakest token source,
with a `title` tooltip. Toggleable.

## Feature 5 — Anki / CSV export
Exports the current song's vocabulary (kanji, kana reading, romaji, song title,
artist) as a CSV download, de-duplicated by surface form.
