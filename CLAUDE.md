# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Chrome MV3 extension for researching YouTube channels. Two modes:
- **Channel Research** — quick overview of a channel's latest/popular/oldest videos, displayed in popup
- **Competitor Deep Dive** — full scrape: channel info + images → per-video data (title, views, date, likes, comments, description, transcript, "How this was made") + thumbnails, exported as 1–2 CSV files + downloaded images

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

**State persistence** (`chrome.storage.local`): All scraping state is persisted so navigation between YouTube pages doesn't lose context. Key fields: `isScraping`, `scrapePhase`, `mode`, `deepdiveOptions`, `videoFilter`, `scrapingTabId`, `deepdiveChannelInfo`, `deepdiveVideoList`, `deepdiveVideoIndex`, `channelBase`, `videoFinishTimes`, `lastEtaSeconds`.

## Multi-Phase Navigation Pattern

Both modes navigate across multiple YouTube pages. Each page load re-injects content.js (via manifest `content_scripts`). The auto-continue block at the bottom of content.js reads `scrapePhase` from storage on every load and resumes the correct phase.

**Deep Dive phases:**
1. `null` + not on channel-home → navigate to channel-home
2. `channel-home` → scrape channel info via `scrapeChannelInfo()` → navigate to `/videos`
3. `videos` → scroll-collect all video URLs → navigate to first video
4. `video-detail` → scrape each video page one-by-one (title, views, date, likes, comments, description, transcript, how-this-was-made) → navigate to next

**Research phases:**
1. `null` → scrape 5 latest → navigate to `?sort=p`
2. `popular` → scrape top 1 → navigate to `?sort=da`
3. `oldest` → scrape 1 → send `scrapingJobDone`

## Key Guard Flags

- `window.ytResearchLoaded` — prevents double-registration of message listeners when content.js is injected multiple times into the same tab
- `isMessageDriven` (closure inside guard block) — prevents auto-continue from firing when a `startScraping` message already triggered the flow on the same page load
- `window.ytResearchStopRequested` — checked at each phase entry to abort mid-flow

## YouTube DOM Selectors

YouTube UI changes frequently. Current selectors (as of 2026):

| Element | Selector |
|---|---|
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

- **Channel info** → `yt-channel-info_<timestamp>.csv` (1 row) — columns: Channel Name, Subscribers, Total Videos, Total Views, Channel URL, Country, Joined Date, Channel Description
- **Video data** → `yt-video-data_<timestamp>.csv` (1 row per video) — columns: Video Title, Description, Hashtags, Views, Upload Date, Likes, Comments, How This Was Made, Transcript
- Description text: newlines flattened — `\n\n+` → ` | `, `\n` → ` `
- Transcript format: `[0:03] text [0:10] text ...` — all segments joined with space
- CSV escaping: values containing `,`, `"`, or `\n` are wrapped in double-quotes with internal `"` doubled

## Downloaded Files

- **Channel avatar** → `channel-images/{channelName}_avatar.jpg`
- **Channel banner** → `channel-images/{channelName}_banner.jpg` (skipped if channel has no banner)
- **Video thumbnails** → `thumbnails/{channelName}_{NNN}.jpg` — oldest video = `001`, newest = N

## Deep Dive Options

Stored in `deepdiveOptions` object:
- `channelInfo` (bool) — scrape channel-home, export channel_info.csv
- `channelImages` (bool) — download avatar + banner to `channel-images/` (requires channel-home visit)
- `videoData` (bool) — open each video, export video_data.csv (includes transcript automatically)
- `thumbnails` (bool) — download video thumbnails to `thumbnails/` (from /videos page, no per-video visit needed)
- `videoDescriptions` (bool) — always true, kept for compatibility

`channelInfo` and `channelImages` both trigger navigation to channel-home. `videoData` and `thumbnails` both trigger /videos scroll phase.

## ETA Calculation

`videoFinishTimes` — array of `Date.now()` timestamps, one per completed video. After 2+ completions, background.js averages the intervals and multiplies by `videosLeft` to get `etaSeconds`. Stored as `lastEtaSeconds` so popup doesn't revert to "working…" between video navigations.

Video filter stored in `videoFilter`: `{ mode: 'all' | 'count' | 'date', count?, direction?: 'latest'|'oldest', from?, to? }`
