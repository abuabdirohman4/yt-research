# YT Research

Chrome extension for researching YouTube channels — find new channels by niche, or deep-dive a single competitor.

Runs inside your own logged-in browser, so search results match what you actually see on YouTube. No API key, no server.

---

## Two modes

### 1. Research Niche

Batch discovery: find channels that are actively uploading in a given niche.

**By Niche** — pick from 54 built-in niches (or type your own). For each niche the extension searches YouTube filtered to a recent upload window, collects the channels that appear, then visits each one to gather a summary.

**By Channel URLs** — paste a list of channel URLs (one per line) and skip the search step entirely. Useful when you already know which channels to look at.

Exports one combined CSV:

| Column |
|---|
| No., Niche, Channel URL, Subscribers |
| Avg Views (5 Latest), Latest Upload Date |
| Most Popular Views, Oldest Upload Date, Oldest Upload Date (days) |

### 2. Competitor Deep Dive

Full scrape of a single channel: channel info and images, then per-video data.

Exports one or two CSVs plus downloaded thumbnails:

| File | Columns |
|---|---|
| Channel info | Channel Name, Subscribers, Total Videos, Total Views, Channel URL, Country, Joined Date, Description |
| Per video | Video Title, Description, Hashtags, Views, Upload Date, Likes, Comments, How This Was Made, Transcript |

---

## Install

No build step — plain JS/HTML/CSS loaded directly by Chrome.

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder

After changing any file, click the reload icon on the extension card. Content script changes also need the YouTube tab reloaded.

---

## Usage

1. Open any YouTube page
2. Click the extension icon
3. Pick a mode, set the options, start
4. The CSV downloads automatically when the run finishes

The extension navigates across several YouTube pages per channel. State is kept in `chrome.storage.local`, so navigation doesn't lose progress.

---

## Notes

**Runtime scales fast.** Each channel needs about 3 page navigations, so total work is roughly `niches × channels per niche × 3`. YouTube starts throttling after a few hundred navigations — in a 54-niche test run, results degraded past niche 13.

**Recommended: max 10 niches per session**, 12 channels per niche.

**YouTube changes its markup often.** This extension reads the rendered page, so a YouTube UI update can break the selectors. Current selectors are documented in `CLAUDE.md`.

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Keep scraping state across page navigations |
| `activeTab`, `scripting` | Inject the content script into YouTube |
| `downloads` | Save the CSV and thumbnail files |
| `windows` | Manage the tab being scraped |
| `host_permissions: www.youtube.com` | Limit access to YouTube only |

---

## Other YouTube tools

Separate repos, no shared dependencies — each one stands alone:

- **[yt-research](https://github.com/abuabdirohman4/yt-research)** (this repo) — competitor research: find channels by niche, deep-dive **other people's** channels. Chrome extension.
- **[yt-studio-scrape](https://github.com/abuabdirohman4/yt-studio-scrape)** — analytics from **your own** YouTube Studio. Chrome extension.
- **[yt-toolkit](https://github.com/abuabdirohman4/yt-toolkit)** — transcripts, channel data to CSV, slide extraction from video files. Python CLI.
- **gemini-batch-image** (`../gemini-batch-image`) — batch image generation on gemini.google.com from a JSON job list with reference characters. Chrome extension.
