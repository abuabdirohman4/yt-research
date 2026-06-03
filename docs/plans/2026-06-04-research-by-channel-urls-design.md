# Design: Research Niche — Mode "By Channel URLs"

## Problem

User ingin riset daftar channel yang sudah dia punya (mis. memperbaiki baris CSV yang sebelumnya salah, atau channel hasil temuan manual) tanpa lewat search niche. Saat ini Research Niche selalu mulai dari search YouTube per niche.

## Solution

Tambah toggle mode di tab Research Niche:
- **By Niche** (default) — flow search seperti sekarang.
- **By Channel URLs** — user paste daftar URL channel (1 per baris), extension langsung scrape tiap channel (latest/popular/oldest), skip fase search.

Kolom `Niche` di CSV diisi `"Manual"` untuk mode URL.

## UI (popup)

Di `nicheWrap`, tambah radio di atas:
```
( ) By Niche    ( ) By Channel URLs
```
- Mode **By Niche**: tampil niche checkbox list + keyword suffix + date filter (seperti sekarang). Sembunyikan textarea URL.
- Mode **By Channel URLs**: tampil `<textarea>` (placeholder "Paste channel URLs, one per line"). Sembunyikan niche list + keyword + date filter (tidak relevan). `channelsPerNiche` juga disembunyikan.

Persist mode + isi textarea di storage (`researchMode`, `manualUrls`).

## Data Flow

Start (mode URL):
1. popup parse textarea → array baris non-kosong → kirim `researchConfig: { mode:'urls', urls: [...] }`.
2. background simpan, inject content.
3. content `runScraping`: kalau `cfg.mode === 'urls'`, bangun `nicheChannelQueue` langsung dari urls (normalize tiap URL via `normalizeChannelUrl`), set 1 "niche" virtual berlabel "Manual", `researchPhase='channel-latest'`, navigate ke channel pertama.
4. Per channel: reuse fase `channel-latest` → `channel-popular` → `channel-oldest` apa adanya. `niche` di row = "Manual".
5. Selesai semua channel → `scrapingJobDone` → CSV.

Karena mode URL = 1 "niche" dengan N channel, struktur state existing (`nicheQueue`, `nicheChannelQueue`, `nicheIndex`, `nicheChannelIndex`) dipakai ulang: `nicheQueue=['Manual']`, `nicheChannelQueue=[{url,name}...]`.

## Normalisasi URL

Reuse `normalizeChannelUrl` (sudah handle @handle, /channel/, /user/, /c/). Input bisa:
- `https://www.youtube.com/@handle` atau `@handle/videos` → normalize ke `/@handle`
- baris kosong / invalid → skip.
Setiap channel di-append `/videos` saat navigate (pola existing).

## Reuse

- `runNicheResearch` fase channel-* — tanpa perubahan.
- `getOldestFromList`, `getMostPopularFromList`, `parseVideoItems`, `clickChipAndWait`, `waitForVideos` — tanpa perubahan.
- `generateNicheCSV` — tanpa perubahan (Niche="Manual").
- ETA, progress, partial export saat stop — tanpa perubahan.

## Error Handling

- 0 URL valid → `scrapingJobDone` dengan status "no channels".
- URL redirect/invalid saat scrape → `skipStuckChannel` existing menangani.

## Estimasi runtime

N URL × 3 navigasi. User kontrol jumlah langsung via baris textarea. Tetap sarankan tab aktif.

## Files

- `popup/popup.html` — radio mode + textarea.
- `popup/popup.js` — toggle UI, parse textarea, kirim researchConfig mode urls, persist.
- `scripts/content.js` — `runScraping` research branch: cabang `mode==='urls'` bangun queue langsung.
- `scripts/background.js` — teruskan researchConfig (sudah generic, cek nicheQueue label).
