# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Chrome MV3 extension for researching YouTube channels. Two modes:
- **Research Niche** (`mode: 'research'`) — batch niche discovery. User picks niches (54 presets + custom), extension searches each niche on YouTube filtered to a recent upload window, finds the channels uploading those videos, then scrapes a summary per channel (avg views of 5 latest, most-popular views, oldest upload date). Exports one combined CSV.
- **Competitor Deep Dive** (`mode: 'deepdive'`) — full scrape of one channel: channel info + images → per-video data (title, views, date, likes, comments, description, transcript, "How this was made") + thumbnails, exported as 1–2 CSV files + downloaded images

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
- Research Niche: `researchConfig` (`{ niches, channelsPerNiche, suffix, dateFilter }`), `researchPhase`, `nicheQueue`, `nicheIndex`, `nicheChannelQueue`, `nicheChannelIndex`, `nicheCurrentRow`, `nicheResults`, `doneChannels`, `estTotalChannels`

## Multi-Phase Navigation Pattern

Both modes navigate across multiple YouTube pages. Each page load re-injects content.js (via manifest `content_scripts`). The auto-continue block at the bottom of content.js reads `scrapePhase` from storage on every load and resumes the correct phase.

**Deep Dive phases:**
1. `null` + not on channel-home → navigate to channel-home
2. `channel-home` → scrape channel info via `scrapeChannelInfo()` → navigate to `/videos`
3. `videos` → scroll-collect all video URLs → navigate to first video
4. `video-detail` → scrape each video page one-by-one (title, views, date, likes, comments, description, transcript, how-this-was-made) → navigate to next

**Research Niche phases** (driven by `researchPhase`, not `scrapePhase`):
1. Kickoff (`runScraping`): build `nicheQueue` from `researchConfig.niches`, set `researchPhase='search'`, navigate to first niche search URL (`buildSearchUrl()`). Works from any YouTube page.
2. `search` (on `search-results`) → `extractChannelsFromSearch(N)` scrolls + collects unique uploading channels from `ytd-video-renderer`, takes top N → navigate to `channel/videos`. Niche with 0 channels skips to next via `gotoNextNiche()`.
3. `channel-latest` → `parseVideoItems(5)`, compute avg views, grab channel name + subscribers → navigate to `/videos?sort=p`
4. `channel-popular` → `parseVideoItems(1)` for popular views → navigate to `/videos?sort=da`
5. `channel-oldest` → `parseVideoItems(1)` for oldest date, push finalized row to `nicheResults`, send `updateProgress` with `videoCompleted:true` → next channel (`channel-latest`) or next niche (`search`) or `scrapingJobDone`

Search URL: `youtube.com/results?search_query=<niche>+<suffix>&sp=<dateFilter>`. Default suffix `mix <currentYear>`. `dateFilter` is the YouTube upload-date `sp` token (this-week default `EgIIAw%3D%3D`).

## Key Guard Flags

- `window.ytResearchLoaded` — prevents double-registration of message listeners when content.js is injected multiple times into the same tab
- `isMessageDriven` (closure inside guard block) — prevents auto-continue from firing when a `startScraping` message already triggered the flow on the same page load
- `window.ytResearchStopRequested` — checked at each phase entry to abort mid-flow. Resets to `false` on every re-injection, so cross-navigation stop relies on `isScraping=false` in storage halting the auto-continue block (same mechanism for both modes).
- `window.ytResearchDeepDiveRunning` / `window.ytResearchNicheRunning` — re-entrancy guards so a phase function can't run twice concurrently in one page load

## YouTube DOM Selectors

YouTube UI changes frequently. Current selectors (as of 2026):

| Element | Selector |
|---|---|
| Search result video item | `ytd-video-renderer` (skip `ytd-playlist-renderer`, `ytd-radio-renderer`) |
| Channel link in search item | first `ytd-channel-name a` / `#channel-info a` / `a.yt-simple-endpoint` whose href is `/@…` or `/channel/…` |
| Channel name on /videos header | `yt-formatted-string.ytd-channel-name#text` / `meta[property="og:title"]` |
| Subscribers on /videos header | `#subscriber-count` |
| Video items on /videos | `ytd-rich-item-renderer, ytd-grid-video-renderer` |
| Video title (new UI) | `h3.ytLockupMetadataViewModelHeadingReset` → `.title` attribute |
| Video link (new UI) | `a.ytLockupMetadataViewModelTitle` |
| Views + Date (new UI) | `span.ytContentMetadataViewModelMetadataText` (index 0 = views, 1 = date) |
| Exact title (watch page) | `h1.ytd-watch-metadata yt-formatted-string` |
| Exact views + date | `yt-formatted-string#info span[dir="auto"]` (index 0 = views, 2 = date) |
| Likes | `like-button-view-model button .ytSpecButtonShapeNextButtonTextContent` |
| Comments count | `yt-formatted-string.count-text span:first-child` (requires scroll to 600px first) |
| Description (watch page) | `#description-inline-expander #expanded yt-attributed-string` |
| How This Was Made | `how-this-was-made-section-view-model .ytwHowThisWasMadeSectionViewModelBodyHeader` |
| About modal | `ytd-about-channel-renderer` (opened via `button.ytTruncatedTextAbsoluteButton`) |
| About modal rows | `tr.description-item` — icon attribute identifies field type |
| Channel avatar | `img.ytSpecAvatarShapeImage` |
| Channel banner | `yt-image-banner-view-model img` |
| Transcript button | `button[aria-label="Show transcript"]` |
| Transcript panel | `yt-section-list-renderer[data-target-id="PAmodern_transcript_view"]` |
| Transcript segment | `transcript-segment-view-model` → `.ytwTranscriptSegmentViewModelTimestamp` + `span[role="text"]` |

## Number Formatting

`parseNumber(val)` in content.js converts "5.3k" → 5300, "1.2m" → 1200000. Apply to all scraped numeric values (views, likes) before storing.

## CSV Output

- **Niche research** (`mode: 'research'`) → `yt-niche-research_<timestamp>.csv` (1 row per channel) — columns: Channel URL, Niche, Channel Name, Subscribers, Avg Views (5 Latest), Latest 5 Views, Latest Upload Date, Most Popular Views, Oldest Upload Date. Generated by `generateNicheCSV()` from `nicheResults`.
- **Channel info** → `yt-channel-info_<timestamp>.csv` (1 row) — columns: Channel Name, Subscribers, Total Videos, Total Views, Channel URL, Country, Joined Date, Channel Description
- **Video data** → `yt-video-data_<timestamp>.csv` (1 row per video) — columns: Video Title, Description, Hashtags, Views, Upload Date, Likes, Comments, How This Was Made, Transcript
- Description text: newlines flattened — `\n\n+` → ` | `, `\n` → ` `
- Transcript format: `[0:03] text [0:10] text ...` — all segments joined with space
- CSV escaping: values containing `,`, `"`, or `\n` are wrapped in double-quotes with internal `"` doubled

## Downloaded Files

- **Channel avatar** → `channel-images/{channelName}_avatar.jpg`
- **Channel banner** → `channel-images/{channelName}_banner.jpg` (skipped if channel has no banner)
- **Video thumbnails** → `thumbnails/{channelName}_{NNN}.jpg` — oldest video = `001`, newest = N

## Research Niche Options

`researchConfig` (built in popup, sent with `startScraping`):
- `niches` (string[]) — selected niches. Presets live in `NICHE_PRESETS` in popup.js (mirror of `list_niche.md`); user can also add custom niches. Selection persisted in `nicheSelection` / `nicheAllOptions`. **Default selection is empty** (deliberate pick) to avoid accidental huge runs.
- `channelsPerNiche` (int, default 10) — max channels taken per niche.
- `suffix` (string, default `mix <currentYear>`) — appended to each niche for the search query. Year is computed at popup load so it never goes stale.
- `dateFilter` (string) — YouTube upload-date `sp` token. UI dropdown: Today `EgIIAg%3D%3D`, This week `EgIIAw%3D%3D` (default), This month `EgIIBA%3D%3D`, This year `EgIIBQ%3D%3D`.

⚠️ Runtime scales as `niches × channelsPerNiche × 3` page navigations — large selections can take a long time and risk YouTube rate-limiting. Test with 1–2 niches first. Keep the tab active.

## Deep Dive Options

Stored in `deepdiveOptions` object:
- `channelInfo` (bool) — scrape channel-home, export channel_info.csv
- `channelImages` (bool) — download avatar + banner to `channel-images/` (requires channel-home visit)
- `videoData` (bool) — open each video, export video_data.csv (includes transcript automatically)
- `thumbnails` (bool) — download video thumbnails to `thumbnails/` (from /videos page, no per-video visit needed)
- `videoDescriptions` (bool) — always true, kept for compatibility

`channelInfo` and `channelImages` both trigger navigation to channel-home. `videoData` and `thumbnails` both trigger /videos scroll phase.

## ETA Calculation

`videoFinishTimes` — array of `Date.now()` timestamps, one per completed unit (a **video** in Deep Dive, a **channel** in Research Niche). After 2+ completions, background.js averages the intervals and multiplies by `videosLeft` (videos/channels remaining) to get `etaSeconds`. Stored as `lastEtaSeconds` so popup doesn't revert to "working…" between navigations. Completion is signalled by an `updateProgress` message with `videoCompleted:true`; intermediate progress messages still carry `videosLeft` so the ETA stays live.

Video filter stored in `videoFilter`: `{ mode: 'all' | 'count' | 'date', count?, direction?: 'latest'|'oldest', from?, to? }`
