# Spotify Lyrics Romaji Browser Extension 🎵🇯🇵

Ekstensi browser (Google Chrome, Microsoft Edge, Brave, Opera) berbasis **Manifest V3** yang secara otomatis mengonversi dan menampilkan lirik lagu Jepang berhuruf Kanji/Kana ke dalam **Romaji**, dengan format **dua baris bertingkat (Stacked Line)** di mana teks Romaji berada tepat di atas lirik aslinya.

Dilengkapi dengan **3-Layer Validation & Correction Engine** untuk mencegah kesalahan baca (*miss transliteration*) akibat fenomena **Ateji (当て字)** dalam lirik lagu Jepang.

---

## Sistem Validasi 3 Lapis (Anti-Miss Translation)

Dalam musik Jepang, musisi sering menulis Kanji tertentu tetapi menyanyikannya dengan bacaan berbeda (contoh: 運命 dinyanyikan *sadame*, 本気 dinyanyikan *maji*, 未来 dinyanyikan *asu*). Ekstensi ini menggunakan pipa validasi berlapis:

1. **Layer 1: Community-Verified Validator (Lrclib API)**
   - Saat lagu diputar, ekstensi otomatis mengecek database Lrclib.
   - Jika komunitas telah mengunggah lirik Romaji yang diverifikasi oleh manusia (*human-verified*), ekstensi akan memprioritaskannya sehingga bacaan vokal dan *ateji* dijamin 100% akurat.
2. **Layer 2: Kamus Ateji & Partikel Lagu Lokal**
   - Jika lagu belum ada di database komunitas, mesin Kuroshiro lokal mengambil alih dan otomatis mengoreksi kata-kata kanji yang sering di-*ateji*-kan oleh komposer Jepang (`運命 -> sadame`, `本気 -> maji`, `未来 -> asu`, `地球 -> hoshi`, dll.).
3. **Layer 3: Kamus Koreksi Kustom Pengguna (User Overrides)**
   - Pengguna bisa memasukkan kata kanji dan bacaan romaji sendiri melalui menu popup ekstensi. Koreksi ini disimpan permanen di browser dan memiliki prioritas tertinggi.

---

## Fitur Utama

- **Stacked Two-Line Display:** Teks Romaji berukuran proporsional berada tepat di atas teks Kanji/Kana asli, menjaga lirik Jepang aslinya tetap terbaca.
- **Badge Status Validasi:** Menampilkan status apakah lagu yang sedang diputar menggunakan lirik `[Terverifikasi (Lrclib)]` atau `[Transliterasi Morfologi]`.
- **Preserve Click-to-Seek:** Klik pada baris lirik tetap melompat ke detik lagu yang diinginkan di Spotify player.
- **Warna Karaoke Otomatis:** Mengikuti penanda aktif lirik Spotify secara real-time.
- **Menu Pengaturan Interaktif:**
  - Toggle Master Aktif/Nonaktif.
  - Slider rasio ukuran font Romaji (50% s/d 90%).
  - Pilihan sistem romanisasi: **Hepburn** (dengan makron *ō*, *ū*) atau **Passport** (ASCII polos).
  - Toggle Lrclib Validator & Toggle Kamus Ateji.
  - Formulir penambahan kata koreksi kustom mandiri.
  - Pratinjau langsung (*live preview*).

---

## Cara Memasang Ekstensi ke Browser (Load Unpacked)

Folder hasil build siap pasang berada di direktori [`dist/`](dist).

### Untuk Google Chrome / Brave / Chromium:
1. Buka browser dan buka menu ekstensi:
   ```
   chrome://extensions/
   ```
2. Di pojok kanan atas, aktifkan **Developer mode** (Mode pengembang).
3. Klik tombol **Load unpacked** (Muat yang belum dibongkar) di pojok kiri atas.
4. Pilih folder `dist`:
   ```
   <folder tempat repo ini di-clone>\dist
   ```
5. Ekstensi **Spotify Lyrics Romaji** sekarang aktif.

### Untuk Microsoft Edge:
1. Buka halaman:
   ```
   edge://extensions/
   ```
2. Aktifkan **Mode Pengembang** di panel kiri bawah.
3. Klik **Muat yang belum dibongkar** dan pilih folder `dist`.

---

## Cara Penggunaan di Spotify Web

1. Buka [Spotify Web Player](https://open.spotify.com) dan login.
2. Putar lagu berbahasa Jepang (misal: *YOASOBI - 夜に駆ける* atau lagu anime favorit Anda).
3. Klik tombol **Mikrofon (Lirik)** di pojok kanan bawah pemutar Spotify.
4. Lirik Romaji akan langsung muncul di atas lirik Kanji/Kana:
   ```text
   shizumu yō ni toke te yuku yō ni    <-- [Romaji di atas]
   沈むように溶けてゆくように           <-- [Kanji asli di bawah]
   ```
5. Buka popup ekstensi di toolbar browser untuk melihat status validasi lagu atau menambahkan koreksi kata jika ada kata yang ingin disesuaikan.

---

## Perintah Pengembangan (Development)

```bash
# Melakukan build ulang ke folder dist/
npm run build

# Menjalankan pengujian otomatis (integritas manifest, kamus, ateji, dan validator)
npm test
```
