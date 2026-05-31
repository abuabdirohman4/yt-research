# Plan: YT Research Extension

## Context

Chrome extension untuk riset channel YouTube. Dua mode dalam satu popup:

1. **Channel Research** — riset channel potensial untuk di-ATM: 5 video terbaru, video terpopuler, video terlama
2. **Competitor Deep Dive** — riset kompetitor detail: semua judul + deskripsi video, deskripsi channel, data channel

Target halaman: `youtube.com` (bukan Studio). Inject ke channel page dan video list page.

UI pattern: copy dari `yt-analytic-scrape/` — card layout, progress, settings accordion, dark/light theme, CSS variables.

---

## Struktur Folder

```
yt-research/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── scripts/
│   ├── content.js
│   └── background.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── CLAUDE.md
```

---

## File 1: `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "YT Research",
  "version": "1.0.0",
  "description": "Research YouTube channels — quick overview or full competitor deep dive.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["*://www.youtube.com/*"],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "service_worker": "scripts/background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://www.youtube.com/*"],
      "js": ["scripts/content.js"]
    }
  ]
}
```

---

## File 2: `popup/popup.html`

Struktur:
- Header: logo YT + title "YT Research" + theme toggle
- **Mode tab bar**: dua tab — `Channel Research` | `Competitor Deep Dive`
- **Status card** (ready / done / error) — sama persis pattern `yt-analytic-scrape`
- **Progress card** (saat scraping) — spinner, count, phase label, progress bar, ETA pill
- **Settings wrap** (hanya tampil saat tidak scraping):
  - Mode "Channel Research": tidak ada setting tambahan
  - Mode "Competitor Deep Dive": toggle pilih data apa yang mau di-scrape (mirip column accordion)
- **Buttons**: Start / Stop
- **Footer**: instruksi singkat sesuai mode aktif

---

## File 3: `popup/popup.css`

Copy dari `yt-analytic-scrape/popup/popup.css` sebagai base. Tambah:

```css
/* ── Mode tabs ── */
.mode-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
}

.mode-tab {
    flex: 1;
    height: 36px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
}

.mode-tab.active {
    color: var(--color);
    border-bottom-color: #cc0000;
}
```

---

## File 4: `popup/popup.js`

### State
```js
let activeMode = 'research'; // 'research' | 'deepdive'
```

### Mode switching
```js
modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        activeMode = tab.dataset.mode;
        chrome.storage.local.set({ activeMode });
        renderMode();
    });
});

function renderMode() {
    // update tab active class
    // update footer text
    // show/hide deepdive settings
}
```

### Restore on load
```js
chrome.storage.local.get(['activeMode', 'theme', 'deepdiveOptions'], (r) => {
    activeMode = r.activeMode || 'research';
    renderMode();
    applyTheme(r.theme || 'dark');
    // restore deepdive options checkboxes
});
```

### Start scraping
Kirim `{ action: 'startScraping', mode: activeMode }` ke background.

### Progress / status handling
Sama persis pattern `yt-analytic-scrape` — `updateProgress`, `updateStatus` messages.

---

## File 5: `scripts/background.js`

### startScraping handler
```js
if (request.action === 'startScraping') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        chrome.storage.local.set({ scrapingTabId: tabId, mode: request.mode, ... });
        setScrapingState(true, 'Starting...');
        injectToTab(tabId, request);
    });
}
```

### scrapingJobDone handler
Mode `research`: format export sebagai JSON atau tampilkan di popup (tidak butuh download).
Mode `deepdive`: export sebagai CSV/Excel (sama pattern `yt-analytic-scrape`).

---

## File 6: `scripts/content.js`

### Page type detection
```js
function getPageType() {
    const url = window.location.href;
    if (url.match(/youtube\.com\/@[^/]+$/) || url.match(/youtube\.com\/channel\/[^/]+$/)) return 'channel-home';
    if (url.match(/youtube\.com\/@[^/]+\/videos/) || url.match(/youtube\.com\/channel\/[^/]+\/videos/)) return 'channel-videos';
    return 'other';
}
```

### Mode: Channel Research

Data per channel dari `channel-videos` page:
- **5 video terbaru**: ambil 5 `ytd-rich-item-renderer` pertama dari grid → judul, views, upload date, thumbnail URL
- **Video terpopuler**: sort by view count → ambil #1 (atau pakai filter "Popular" di YouTube)
- **Video terlama**: ambil item terakhir di grid (atau pakai filter "Oldest")

Navigasi flow:
```
channel-videos (default/latest) → scrape 5 terbaru
→ navigate ?sp=CAM%3D (Popular sort) → scrape terpopuler
→ navigate ?sp=CAI%3D (Oldest sort) → scrape terlama
→ done
```

### Mode: Competitor Deep Dive

Data yang bisa di-scrape (user bisa pilih via checkboxes):

| Data | Sumber | Selector area |
|---|---|---|
| Channel name | channel-home | `#channel-name` / `yt-formatted-string#text` |
| Channel description | channel-home | `#description` di about section |
| Subscriber count | channel-home | `#subscriber-count` |
| Total videos count | channel-home | stats area |
| All video titles | channel-videos (semua halaman) | `#video-title` di setiap `ytd-rich-item-renderer` |
| All video descriptions | per video page | butuh kunjungi tiap `/watch?v=` |
| Video views, date | channel-videos | per item |

**Pagination**: channel-videos list pakai infinite scroll. Scroll down sampai tidak ada item baru (MutationObserver + scroll trigger).

**Per-video description**: hanya kalau user centang. Butuh kunjungi `/watch?v=ID` satu per satu (slow — beri warning di UI).

---

## Urutan Implementasi

1. `manifest.json` — boilerplate, host_permissions youtube.com
2. `popup/popup.css` — copy dari yt-analytic-scrape, tambah `.mode-tabs`
3. `popup/popup.html` — struktur HTML dengan tab bar, card, settings
4. `popup/popup.js` — mode switching, start/stop, progress handling
5. `scripts/background.js` — inject, state, export
6. `scripts/content.js` — page type detection, channel research scraper, deepdive scraper
7. Icons — buat/copy placeholder icons

---

## Verifikasi

1. Load unpacked di `chrome://extensions`
2. Buka channel YouTube manapun (e.g. `youtube.com/@PewDiePie/videos`)
3. Mode **Channel Research** → Start → scrape 5 terbaru + popular + oldest
4. Mode **Competitor Deep Dive** → pilih kolom → Start → semua video titles ter-scrape
5. Switch mode → UI berubah, setting tersimpan
6. Progress card muncul saat scraping, auto-kembali ke status card setelah done

---

## Catatan Penting

- **Selector youtube.com sering berubah** — pakai `ytd-rich-item-renderer`, `#video-title`, `yt-formatted-string` yang relatif stabil
- **Infinite scroll** butuh trigger manual: `window.scrollTo(0, document.body.scrollHeight)` dalam loop dengan delay
- **Rate limiting**: tambah delay antar navigasi (1–2 detik) agar tidak di-flag
- **No `downloads` permission** di manifest — jika deepdive butuh export file, tambahkan nanti
- **Icons**: untuk sementara copy icons dari `yt-analytic-scrape/icons/` atau buat placeholder
