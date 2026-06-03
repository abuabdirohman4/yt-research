# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Chrome MV3 extension for researching YouTube channels. Two modes:
- **Research Niche** (`mode: 'research'`) — batch niche discovery. Two sub-modes:
  - **By Niche**: user picks niches (54 presets + custom), extension searches each niche on YouTube filtered to a recent upload window, finds uploading channels, scrapes summary per channel (avg views of 5 latest, most-popular views, oldest upload date). Exports one combined CSV.
  - **By Channel URLs**: user pastes a list of channel URLs (1 per line), extension skips search and directly scrapes each channel. Niche column = "Manual".
- **Competitor Deep Dive** (`mode: 'deepdive'`) — full scrape of one channel: channel info + images → per-video data (title, views, date, likes, comments, description, transcript, "How this was made") + thumbnails, exported as 1–2 CSV files + downloaded images.

No build system. No package manager. No tests. All files are plain JS/HTML/CSS loaded directly by Chrome.

## Loading for Development

1. `chrome://extensions` → Enable **Developer mode**
2. **Load unpacked** → select this directory
3. After any file change: click **reload** icon on the extension card
4. Content script changes also require reloading the YouTube tab

## Architecture

```
popup/ ←→ background.js (service worker) ←→ content.js (injected into YouTube)
```

**Message flow:**
1. Popup sends `startScraping` → background stores state + calls `injectToTab()`
2. `injectToTab()` tries `sendMessage` first; falls back to `executeScript` if content script not ready
3. Content script receives `startScraping` → runs scraping logic → sends `navigateTo` / `updateProgress` / `scrapingJobDone` back to background
4. Background handles `navigateTo` via `chrome.tabs.update()` — triggers page load, content script auto-continues via storage state check
5. On `scrapingJobDone`, background reads storage and triggers `chrome.downloads.download()` for CSV(s)

**State persistence** (`chrome.storage.local`): All scraping state is persisted so navigation between YouTube pages doesn't lose context.
- Shared: `isScraping`, `mode`, `scrapingTabId`, `videoFinishTimes`, `lastEtaSeconds`, `lastProgress`
- Deep Dive: `scrapePhase`, `deepdiveOptions`, `videoFilter`, `deepdiveChannelInfo`, `deepdiveVideoList`, `deepdiveVideoIndex`, `channelBase`
- Research Niche: `researchConfig` (`{ mode, niches, channelsPerNiche, suffix, dateFilter, urls }`), `researchPhase`, `nicheQueue`, `nicheIndex`, `nicheChannelQueue`, `nicheChannelIndex`, `nicheCurrentRow`, `nicheResults`, `doneChannels`, `estTotalChannels`, `runStartedAt`
- UI persist: `researchSourceMode` ('niche'|'urls'), `manualUrls` (textarea content), `nicheSelection`, `nicheAllOptions`, `nicheChannelsPerNiche`, `nicheSuffix`, `nicheDateFilter`

## Multi-Phase Navigation Pattern

Both modes navigate across multiple YouTube pages. Each page load re-injects content.js (via manifest `content_scripts`). The auto-continue block at the bottom of content.js reads state from storage on every load and resumes the correct phase.

**Deep Dive phases:**
1. `null` + not on channel-home → navigate to channel-home
2. `channel-home` → scrape channel info via `scrapeChannelInfo()` → navigate to `/videos`
3. `videos` → scroll-collect all video URLs → navigate to first video
4. `video-detail` → scrape each video page one-by-one (title, views, date, likes, comments, description, transcript, how-this-was-made) → navigate to next

**Research Niche phases** (driven by `researchPhase`, not `scrapePhase`):
1. Kickoff (`runScraping`):
   - **By Niche**: build `nicheQueue` from `researchConfig.niches`, set `researchPhase='search'`, navigate to first niche search URL (`buildSearchUrl()`). Works from any YouTube page.
   - **By Channel URLs**: normalize URLs, build `nicheChannelQueue` directly, `nicheQueue=['Manual']`, set `researchPhase='channel-latest'`, navigate to first channel. Skip search phase entirely.
2. `search` (on `search-results`) → `extractChannelsFromSearch(N, label)` scrolls + collects unique uploading channels from `ytd-video-renderer`, takes top N → navigate to `channel/videos`. Niche with 0 channels skips to next via `gotoNextNiche()`.
3. `channel-latest` → `parseVideoItems(5)`, compute avg views → navigate to `/videos?sort=p`
4. `channel-popular` → `clickChipAndWait('Popular')` + `parseVideoItems(0)` + `getMostPopularFromList` → navigate to `/videos?sort=da`
5. `channel-oldest` → `clickChipAndWait('Oldest')` + `parseVideoItems(0)` + `getOldestFromList` → push finalized row to `nicheResults`, send `updateProgress` with `videoCompleted:true` → next channel or next niche or `scrapingJobDone`

Search URL: `youtube.com/results?search_query=<niche>+<suffix>&sp=<dateFilter>`. Default suffix `mix <currentYear>`. `dateFilter` is the YouTube upload-date `sp` token (this-week default `EgIIAw%3D%3D`).

⚠️ Runtime scales as `niches × channelsPerNiche × 3` page navigations — large selections risk YouTube rate-limiting (observed degradation after ~400 navigations / niche 13+ in a 54-niche run). **Recommended max: 10 niches per session** with channelsPerNiche=12.

## Key Guard Flags

- `window.ytResearchLoaded` — prevents double-registration of message listeners when content.js is injected multiple times into the same tab
- `isMessageDriven` (closure inside guard block) — prevents auto-continue from firing when a `startScraping` message already triggered the flow on the same page load
- `window.ytResearchStopRequested` — checked at each phase entry to abort mid-flow. Resets to `false` on every re-injection, so cross-navigation stop relies on `isScraping=false` in storage halting the auto-continue block
- `window.ytResearchDeepDiveRunning` / `window.ytResearchNicheRunning` — re-entrancy guards so a phase function can't run twice concurrently in one page load

## YouTube DOM Selectors

YouTube UI changes frequently. Current selectors (as of 2026):

| Element | Selector |
|---|---|
| Search result video item | `ytd-video-renderer` (skip `ytd-playlist-renderer`, `ytd-radio-renderer`) |
| Channel link in search item | first `ytd-channel-name a` / `#channel-info a` / `a.yt-simple-endpoint` whose href is `/@…` or `/channel/…` or `/user/…` or `/c/…` |
| Channel name on /videos header | `yt-formatted-string.ytd-channel-name#text` / `meta[property="og:title"]` |
| Subscribers on /videos header | `#subscriber-count` |
| Video items on /videos | `ytd-rich-item-renderer, ytd-grid-video-renderer` |
| Video title (new UI) | `h3.ytLockupMetadataViewModelHeadingReset` → `title` attribute |
| Video link (new UI) | `a.ytLockupMetadataViewModelTitle` |
| Views + Date metadata spans | `span.ytContentMetadataViewModelMetadataText` — date matched by `/ago\|hour\|day\|week\|month\|year\|minute\|second\|streamed/i`, views = remaining digit span (bare number "8", "1.6K", "830 views") |
| Sort chip (standard) | `button.ytChipShapeButtonReset[aria-label="Latest"]` / `[aria-label="Popular"]` / `[aria-label="Oldest"]` |
| Sort chip (membership/combobox) | `button.ytChipShapeButtonReset[role="combobox"]` → click → find dropdown option by text |
| Exact title (watch page) | `h1.ytd-watch-metadata yt-formatted-string` |
| Likes | `like-button-view-model button .ytSpecButtonShapeNextButtonTextContent` |
| Comments count | `yt-formatted-string.count-text span:first-child` (requires scroll to 600px first) |
| Description (watch page) | `#description-inline-expander #expanded yt-attributed-string` |
| How This Was Made | `how-this-was-made-section-view-model .ytwHowThisWasMadeSectionViewModelBodyHeader` |
| About modal | `ytd-about-channel-renderer` (opened via `button.ytTruncatedTextAbsoluteButton`) |
| Channel avatar | `img.ytSpecAvatarShapeImage` |
| Channel banner | `yt-image-banner-view-model img` |
| Transcript button | `button[aria-label="Show transcript"]` |
| Transcript segment | `transcript-segment-view-model` → `.ytwTranscriptSegmentViewModelTimestamp` + `span[role="text"]` |

## Number Formatting

`parseNumber(val)` in content.js handles: "5.3k" → 5300, "1.2m" → 1200000, bare numbers "830" → 830. Used in `background.js`'s `parseNumStr` for CSV exact numbers.

Date relative strings parsed by `getOldestFromList`'s `ageScore` (content.js) and `relativeToDays` (background.js). Both handle short format ("13h", "7d", "2mo", "5y") AND long format ("7 days ago"). Multi-char units (mo, hr, wk, yr) matched before single letters to avoid "2mo" matching "m" (minutes).

## CSV Output

- **Niche research** → `yt-niche-research_<timestamp>.csv` (1 row per channel, or `_partial_` suffix if stopped mid-run) — columns: Niche | Channel URL | Avg Views (5 Latest) | Latest Upload Date | Most Popular Views | Oldest Upload Date | Oldest Upload Date (days). Generated by `generateNicheCSV()` from `nicheResults`. Numeric values passed through `parseNumStr` (exact integers, no K/M suffix).
- **Channel info** → `yt-channel-info_<timestamp>.csv` (1 row) — columns: Channel Name, Subscribers, Total Videos, Total Views, Channel URL, Country, Joined Date, Channel Description
- **Video data** → `yt-video-data_<timestamp>.csv` (1 row per video) — columns: Video Title, Description, Hashtags, Views, Upload Date, Likes, Comments, How This Was Made, Transcript
- CSV escaping: values containing `,`, `"`, or `\n` are wrapped in double-quotes with internal `"` doubled

## Downloaded Files

- **Channel avatar** → `channel-images/{channelName}_avatar.jpg`
- **Channel banner** → `channel-images/{channelName}_banner.jpg` (skipped if channel has no banner)
- **Video thumbnails** → `thumbnails/{channelName}_{NNN}.jpg` — oldest video = `001`, newest = N

## Research Niche Options

`researchConfig` (built in popup, sent with `startScraping`):
- `mode` ('niche'|'urls') — source mode. 'urls' skips search, uses `urls` array directly.
- `niches` (string[]) — selected niches. Presets in `NICHE_PRESETS` in popup.js. **Default selection is empty** (deliberate) to avoid accidental huge runs.
- `urls` (string[]) — channel URLs for 'urls' mode. Normalized via `normalizeChannelUrl` (handles @handle, /channel/, /user/, /c/).
- `channelsPerNiche` (int, default 10) — max channels taken per niche (ignored in urls mode).
- `suffix` (string, default `mix <currentYear>`) — appended to each niche for the search query.
- `dateFilter` (string) — YouTube upload-date `sp` token: Today `EgIIAg%3D%3D`, This week `EgIIAw%3D%3D` (default), This month `EgIIBA%3D%3D`, This year `EgIIBQ%3D%3D`.

## Deep Dive Options

Stored in `deepdiveOptions` object:
- `channelInfo` (bool) — scrape channel-home, export channel_info.csv
- `channelImages` (bool) — download avatar + banner to `channel-images/`
- `videoData` (bool) — open each video, export video_data.csv (includes transcript automatically)
- `thumbnails` (bool) — download video thumbnails to `thumbnails/`
- `videoDescriptions` (bool) — always true, kept for compatibility

## ETA Calculation

`videoFinishTimes` — array of `Date.now()` timestamps, one per completed unit (channel in Research Niche, video in Deep Dive). After 2+ completions, background.js averages intervals and multiplies by remaining units to get `etaSeconds`. Stored as `lastEtaSeconds` so popup doesn't revert to "working…" between navigations.

## Stop Behavior

Research Niche: when user clicks Stop, `stopScraping` handler in background.js exports `nicheResults` collected so far as `yt-niche-research_partial_<timestamp>.csv` (if > 0 rows), then navigates tab back to `youtube.com`. Status shows "Stopped. N channels exported."

## Diagnostic Logging (permanent, prefix `[YTR]`)

Key logs in content.js for debugging:
- `[YTR] niche#N "label" | elapsed Xmin | ~Y navigations so far` — per-niche timing at search start
- `[YTR] search "label": N video-renderers, S scrolls → C channels` — search page health; low renderers (<10) = likely rate-limited
- `[YTR] parseVideoItems: N containers, M parsed [views|date samples]` — parse result per phase
- `[YTR] latest5 views: [...] avg: N` — avg views input
- `[YTR] popular pick: X from views: [...]` — most popular selection
- `[YTR] oldest pick: X from dates: [...]` — oldest selection (uses ageScore sort)

## Fragility Notes

- YouTube SPA strips `?sort=p` / `?sort=da` from URL after navigation — auto-continue uses `researchPhase` from storage (not URL-derived `pageType`) to determine Popular/Oldest phases.
- `clickChipAndWait` handles two layouts: standard chip (`button[aria-label="Popular"]`) and combobox dropdown (membership channels — `button[role="combobox"]` → click → find option by text).
- `waitForItemsStable()` + `waitForVideos()` poll until rendered title count stabilises before parsing — avoids reading partially-rendered lazy items.
- Live streams ("X watching") and upcoming premieres ("Premieres X/X") are skipped in `parseVideoItems`.
