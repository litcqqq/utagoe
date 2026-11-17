# Utagoe launch kit

Everything here is ready to paste. Post in the order given — the communities at
the top are the ones that compound, and a post that lands well there is what
makes the later ones work.

---

## 0. Before anything else (blocking — do these first)

**a. Publish to the Chrome Web Store.** Nothing else matters as much. Every
recommendation thread, every "is there an extension for this" search, every
journalist-looking-for-a-tool funnel goes through the store. A GitHub-only
extension is invisible to the 99% who do not read release pages.

- One-time $5 developer registration, 2-Step Verification required.
- Listing copy, screenshots and the permission justifications are below.
- Expect a few days to a few weeks for a first review by a new developer.
- Edge Add-ons and Firefox are free to list and take the same zip (Edge) —
  do Edge at the same time, it is a second storefront for zero extra work.

**b. Record a 20-second screen capture.** A still image cannot show the thing
that sells this: lyrics scrolling and the romaji keeping up. OBS, 1280x720,
play a Japanese song with lyrics open, do not narrate. This single clip is
worth more than every word in this document.

**c. Fix the repo metadata** (needs a token with `repo` scope — the current one
is read-only for writes):

```bash
gh repo edit litcqqq/utagoe \
  --description "Japanese lyrics in Romaji for Spotify Web and YouTube Music — stacked above every Kanji line, with 3-layer ateji correction." \
  --add-topic karaoke --add-topic japanese-lyrics --add-topic spotify-lyrics \
  --add-topic ateji --add-topic romaji --add-topic youtube-music \
  --add-topic furigana --add-topic japanese
```
Then upload `docs/social-preview.png` at **Settings → Social preview**.

---

## 1. Chrome Web Store listing copy

**Name** (45 char limit)
```
Utagoe — Romaji Lyrics for Spotify
```

**Short description** (132 char limit)
```
Japanese lyrics in Romaji on Spotify Web and YouTube Music. Stacked above the Kanji, ateji-aware, no account, no tracking.
```

**Category:** Entertainment (or Productivity — Entertainment has less competition)

**Detailed description**

```
Karaoke for people who can't read Kanji yet.

Utagoe shows Romaji directly above the original Japanese lyric line on Spotify
Web Player and YouTube Music, so you sing along instead of staring at characters
you can't pronounce.

WHY MOST ROMAJI TOOLS GET J-POP WRONG

Songwriters routinely write one Kanji and sing a completely different word. This
is called ateji (当て字):

  運命  written unmei   sung sadame
  本気  written honki   sung maji
  未来  written mirai   sung asu

A dictionary converter gets every one of these wrong. Utagoe resolves each line
through three layers instead:

  1. Community-verified lyrics from Lrclib, when a human has already checked them
  2. A local ateji dictionary of the words Japanese composers most often re-read
  3. Your own corrections, which always win

Every line carries a colour-coded dot telling you where its reading came from:
green verified, blue yours, amber dictionary, grey machine guess. Wrong anyway?
Tap the word, type the real reading, and it is saved for good.

FEATURES

• Romaji stacked above the original Kanji, both readable at once
• Five output modes: Romaji, Furigana, Hiragana, Katakana, or translation
• Two romanization systems: Hepburn (with ō, ū) or Passport plain ASCII
• Tap any word to fix its reading
• One-click vocabulary export to CSV for Anki
• Translation into 10 languages, in place, without shifting the layout
• Click-to-seek and karaoke highlighting keep working
• Saves the Japanese as furigana ruby if you are studying

PRIVACY

No account. No analytics. No tracking. The romaji engine and its dictionary run
on your machine and work offline. The only network requests are the track title
to Lrclib (to look for verified lyrics) and, only if you turn translation on,
the lyric text to Google Translate.

Utagoe is free and open source under the ISC licence:
https://github.com/litcqqq/utagoe

Not affiliated with Spotify or YouTube.
```

**Single purpose statement** (a review field, be boring and explicit)
```
Converts the Japanese lyrics already displayed on Spotify Web Player and YouTube
Music into Romaji and displays the reading above each original line.
```

**Permission justifications**

- `storage` — "Saves the user's display preferences and their custom Kanji-to-Romaji dictionary entries locally."
- `https://open.spotify.com/*` — "Reads and annotates the lyric elements on the Spotify web player page. No other page is touched."
- `https://music.youtube.com/*` — "Reads and annotates the lyric elements on the YouTube Music web page. No other page is touched."
- `https://lrclib.net/*` — "Looks up community-verified Romaji lyrics for the currently playing track."
- `https://translate.googleapis.com/*` — "Translates lyric lines, only when the user selects a translation output mode."

**Data use answers:** no personal data collected, no data sold, no data used for
unrelated purposes, no creditworthiness. Do not tick "user activity" — the
extension does not transmit browsing history.

---

## 2. r/LearnJapanese — read the rules first

This sub has ~670k members and a **strict** self-promotion policy: standalone
promo posts get removed. Post in the **Wednesday "Materials & Self-Promo"
thread**, participate genuinely first, and only ask mods for a front-page post
if the thread response is good. Do not lead with the product.

**Thread comment**

```
I built a free extension that puts Romaji above the Japanese lyrics on Spotify
and YouTube Music, because I was tired of pausing to look readings up.

The interesting part was ateji. My first version used kuroshiro, and it was
wrong constantly — 運命 came out unmei when the singer says sadame, 本気 came out
honki when it's maji. That's not a bug in kuroshiro, it's that the songwriter
chose a different reading on purpose.

So now it checks three things in order: community-verified lyrics from Lrclib,
then a local ateji dictionary, then my own corrections. Each line shows a dot
for which layer produced it, so I can see when it's guessing.

Two things that turned out to matter more than I expected:
- tapping a word to fix it (once you correct one song, you notice the same
  word wrong everywhere)
- exporting the vocabulary of a song to CSV, which is how I actually study
  from it

It's free, no account, runs locally: https://github.com/litcqqq/utagoe

Happy to hear which songs it gets wrong — that's the most useful feedback,
because confirmed corrections go into the bundled dictionary for everyone.
```

**Why this works:** it leads with a problem learners recognise, admits a
limitation honestly, and asks for the thing that improves the product. It reads
like a person, not a landing page.

---

## 3. r/japanese, r/jpop, r/LearnJapaneseMusic

Same shape, different hook per sub:

- **r/jpop** — lead with the ateji examples from songs they know. Name real
  tracks. "Here are five songs where the written Kanji and the sung word don't
  match" is a genuinely interesting post on its own, with the extension as a
  footnote.
- **r/LearnJapaneseMusic** — lead with the CSV export and the furigana mode.
  This audience studies lyrics; the vocabulary export is the feature.
- **r/japanese** — smallest audience, most forgiving of tool posts, but still
  check the sidebar.

Post **one sub per day**, never the same text twice. Cross-posting identical
copy is the fastest way to get shadowbanned.

---

## 4. Hacker News — Show HN

Only worth it if the Chrome Web Store listing is live first, otherwise the
traffic bounces off a release page.

**Title:** `Show HN: Romaji lyrics for Spotify, with ateji correction`

**Body**

```
I listen to a lot of J-pop and I can't read Kanji fast enough to sing along, so
I built an extension that renders Romaji above each lyric line on Spotify Web
and YouTube Music.

The obvious approach — run kuroshiro over the lyric text — is wrong more often
than you'd expect, and all the existing tools do exactly that. The failure mode
is ateji: Japanese songwriters pick a reading that isn't the dictionary reading.
運命 is unmei on paper and sadame in the vocal. 本気 is honki on paper and maji in
the vocal. 未来 is mirai on paper and asu in the vocal. There is no morphological
rule that recovers this; it's an artistic choice.

So the resolution order is: community-verified lyrics (Lrclib) if anyone has
uploaded them, then a local ateji dictionary, then a morphological pass. Each
rendered line carries a confidence dot for which layer produced it, and any word
is tappable to correct, which writes to a personal dictionary that always wins.

Two implementation notes that cost me real time:

- Content scripts inherit the page origin, so fetch() to lrclib.net is CORS-
  blocked even with host_permissions. host_permissions grants cross-origin
  access to the service worker, not to content scripts — all external requests
  have to go through chrome.runtime.sendMessage.
- Displaying a translation must not add a DOM node to a lyric row. Spotify
  indexes rows for its highlight, so an extra element inside a row desyncs the
  karaoke highlight. Translation replaces the text in place, and there's a test
  asserting child counts never grow.

MV3, no build step for users (release zip, load unpacked until store review
lands), ISC licensed, ~17MB of it is the Kuromoji dictionary.

https://github.com/litcqqq/utagoe

Curious whether the ateji dictionary approach holds up on other genres, and
whether anyone knows a better source than Lrclib for verified Romaji.
```

**Why this works on HN:** specific technical failure modes, two non-obvious
implementation gotchas, honest caveats, and a question at the end. HN rewards
"here is the thing that was hard" and punishes "check out my startup".

Post **Tuesday–Thursday, 8–10am ET**. Reply to every comment in the first two
hours; that is what keeps a post on the front page.

---

## 5. The leverage nobody does: make the repo a reference

Stars follow *usefulness to people who aren't users yet*. The 3-layer ateji
engine is the only genuinely novel thing here, and it is currently buried in a
README section.

**Write `docs/ateji.md` as a standalone reference:** the full list of common
ateji readings with song examples, why the dictionary reading fails, and how the
resolution order works. Publish it as a gist too. People searching
"運命 sadame lyric meaning" and "why is 本気 pronounced maji" are a real,
high-intent audience with zero good results today, and a good page on that topic
brings in exactly the right visitors forever.

**Add `docs/architecture.md`** for the DOM-adapter and service-worker decisions
above. Technical readers star repos whose design they learn from.

---

## 6. Small things that compound

- **Reply to every issue within 24h**, even "won't fix". A repo with 2 stars and
  fast replies looks alive; a repo with 60 stars and silence looks abandoned.
- **Ship a release whenever a dictionary batch lands.** "Dictionary: +40 ateji
  readings from user reports" is a post you can make repeatedly without
  spamming, because each one is real news.
- **Add a `Good first issue` label** and genuinely scoped ones — drive-by
  contributors are how a repo starts appearing in other people's feeds.
- **Put the GIF at the very top of the README** once it exists, above the social
  card. Motion converts; a still does not.
- **Pin an issue titled "Which songs does it get wrong?"** — free ongoing
  research, and it gives visitors something to do besides leave.

---

## 7. How to tell whether anyone actually uses it

There is no number anywhere that says "12 people installed this". Here is what
each source really measures, and where each one lies to you.

**GitHub release `download_count` — the only real number, and it overcounts.**
It counts every HTTP fetch of the zip: your own re-downloads, CI jobs, link
previewers, security scanners, and mirrors. It cannot count installs, because
Chrome has no idea where the zip came from. Run `python3 scripts/stats.py`.
Cumulative and permanent, so it only ever goes up — the useful signal is *change
over a week*, not the absolute value.

**GitHub traffic (views / clones / referrers) — needs admin scope, and expires.**
`https://github.com/litcqqq/utagoe/graphs/traffic`, while signed in. This is the
one panel that tells you *where* visitors came from, which is how you learn
whether a Reddit post or the HN thread produced anything. **GitHub deletes this
data after 14 days** — if you do not look, it is gone permanently. Screenshot it
weekly during a launch.

**Stars, forks, watchers — permanent, public, and a proxy for interest only.**
A star means someone wanted to remember the repo. It is not usage. Star counts
are also the easiest thing to fake, which is why they are the worst metric.

**Chrome Web Store dashboard — the only place that counts installs.**
Once published: *Developer Dashboard → your item → Analytics*. It gives you
installs, weekly active users, uninstall rate, and where in the store the install
came from (search vs. browse vs. external link). **Weekly active users is the
number that matters** — installs with no active users means people tried it and
left. This panel is worth more than every other source combined, and it does not
exist until you publish.

**Edge Add-ons dashboard** — same shape, free, separate number.

**What you cannot measure, by design:** which user, which songs, which features.
The extension promises no telemetry, and that promise is in the README, the store
listing, and the privacy answers. Do not quietly add a ping to satisfy curiosity —
one reviewer noticing a network call that was not disclosed is a store removal,
and the trust cost is far worse than the blind spot.

### What the current numbers mean

As of the last check: 2 downloads on v1.0.1 and 2 on v1.0.0, 2 stars, 0 forks, 0
issues. Those four downloads are your own verification fetches and mine — the
genuine external install count is effectively **zero**. That is expected for a
repo that is one day old and not listed in any store. It is not a signal about
the product.

### The honest order of operations

1. Publish to the Chrome Web Store. Until then, install counts do not exist.
2. Open the traffic page the day you post anywhere, and screenshot it.
3. Judge a launch by *weekly active users* in the store dashboard two weeks
   later, not by stars on the day.
4. If installs happen but weekly actives collapse, the problem is the first
   thirty seconds of use, not the marketing.

---

## 8. What not to do

- Do not buy stars, use star-exchange groups, or post the same link to ten subs
  in an hour. GitHub's spam detection and Reddit's shadowban are both good at
  this now, and recovery is worse than the delay.
- Do not claim accuracy numbers you have not measured. "99.6% accuracy" appears
  in a competitor's listing and is unfalsifiable; one reviewer calling it out
  costs more than the claim gains.
- Do not publish to the store and then go quiet for a month. The first reviews
  are what the algorithm ranks on.
- Do not post to r/LearnJapanese outside the Wednesday thread. It will be
  removed and you will not get a second chance there.

---

## 9. Honest expectation setting

Comparable projects in this exact niche, from the survey:

- `sglkc/moegi` — 64 stars, since 2023, broadest feature set, store-listed
- `Slyfti/translatify` — 69 stars, since 2024
- `haroldalan/spotify-karaoke` — 33 stars, since 2026, **store-listed, 3 storefronts**
- `Richie-Z/romajin` — 16 stars
- `litcqqq/utagoe` — 2 stars, 1 day old

Nobody in this niche is big. The ceiling is set by store distribution, not
talent — the largest comparable extension has ~600 users total. That is good
news: a store listing plus one post that lands is enough to become the
best-known tool in this category. It is not going to become a 10k-star project
on README quality alone, and no amount of copywriting changes that.

The realistic path: **store listing → one good Show HN or Reddit thread → 50–200
stars → the ateji reference page keeps trickling in search traffic → 500+ stars
over a year.** That is what "well known" looks like here.
