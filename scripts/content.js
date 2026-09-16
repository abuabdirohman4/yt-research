// ===================== HELPERS =====================

// Log ke background supaya tercatat di storage — console content script
// hilang tiap navigasi antar video.
function ytlog(msg) {
    try { chrome.runtime.sendMessage({ action: 'ytlog', msg }); } catch (e) { /* konteks mati */ }
}

function getPageType() {
    const url = window.location.href;
    const urlObj = new URL(url);
    const sort = urlObj.searchParams.get('sort');

    const isChannelVideos = /youtube\.com\/@[^/?#]+\/videos/.test(url)
        || /youtube\.com\/channel\/[^/?#]+\/videos/.test(url)
        || /youtube\.com\/user\/[^/?#]+\/videos/.test(url)
        || /youtube\.com\/c\/[^/?#]+\/videos/.test(url);

    const isChannelHome = /youtube\.com\/@[^/?#]+\/?(?:[?#]|$)/.test(url)
        || /youtube\.com\/channel\/[^/?#]+\/?(?:[?#]|$)/.test(url)
        || /youtube\.com\/user\/[^/?#]+\/?(?:[?#]|$)/.test(url)
        || /youtube\.com\/c\/[^/?#]+\/?(?:[?#]|$)/.test(url);

    const isWatch = /youtube\.com\/watch/.test(url);
    const isSearch = /youtube\.com\/results/.test(url);
    const isYouTubeHome = /youtube\.com\/?(?:[?#]|$)/.test(url);

    if (isSearch) return 'search-results';
    // Halaman playlist: ada list= tanpa v=. Dicek SEBELUM yang lain karena
    // URL-nya tidak cocok pola channel mana pun dan akan jatuh ke 'other'.
    if (/[?&]list=/.test(url) && !/[?&]v=/.test(url)) return 'playlist';
    if (isChannelVideos) {
        if (sort === 'p') return 'channel-videos-popular';
        if (sort === 'da') return 'channel-videos-oldest';
        return 'channel-videos-latest';
    }
    if (isChannelHome) return 'channel-home';
    if (isWatch) return 'watch';
    if (isYouTubeHome) return 'youtube-home';
    return 'other';
}

function getChannelBaseUrl() {
    const url = window.location.href;
    const m = url.match(/(youtube\.com\/@[^/?#]+|youtube\.com\/channel\/[^/?#]+)/);
    return m ? 'https://www.' + m[1] : null;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function resolveRelativeDate(dateStr) {
    if (!dateStr) return dateStr;
    const s = dateStr.trim().toLowerCase();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    let m;
    if ((m = s.match(/^(\d+)\s*minute/))) {
        return fmt(new Date(now - m[1] * 60000));
    }
    if ((m = s.match(/^(\d+)\s*hour/))) {
        return fmt(new Date(now - m[1] * 3600000));
    }
    if ((m = s.match(/^(\d+)\s*day/))) {
        return fmt(new Date(now - m[1] * 86400000));
    }
    if ((m = s.match(/^(\d+)\s*week/))) {
        return fmt(new Date(now - m[1] * 7 * 86400000));
    }
    if ((m = s.match(/^(\d+)\s*month/))) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - parseInt(m[1]));
        return fmt(d);
    }
    if ((m = s.match(/^(\d+)\s*year/))) {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - parseInt(m[1]));
        return fmt(d);
    }
    return dateStr; // already exact, return as-is
}

function parseNumber(val) {
    if (val == null) return '';
    const lower = String(val).trim().toLowerCase().replace(/,/g, '');
    const m = lower.match(/^([\d.]+)\s*([kmb])?/);
    if (!m) return val;
    const num = parseFloat(m[1]);
    if (isNaN(num)) return val;
    if (m[2] === 'k') return Math.round(num * 1000);
    if (m[2] === 'm') return Math.round(num * 1000000);
    if (m[2] === 'b') return Math.round(num * 1000000000);
    return Math.round(num);
}


// Shared date-age scorer. Returns fractional days (higher = older).
// Handles short ("13h","7d","2mo","5y") and long ("7 days ago") formats.
// Multi-char units (mo, sec, hr, wk, yr) matched before single letters.
function ageScore(dateStr) {
    if (!dateStr) return 0;
    const s = dateStr.trim().toLowerCase();
    const m = s.match(/(\d+)\s*(mo|sec|min|hr|wk|yr|s|m|h|d|w|y|second|minute|hour|day|week|month|year)/);
    if (!m) return 0;
    const n = parseInt(m[1]);
    const u = m[2];
    if (u === 'mo' || u === 'month') return n * 30;
    if (u === 's' || u === 'sec' || u === 'second') return n / 86400;
    if (u === 'min' || u === 'minute' || u === 'm') return n / 1440;
    if (u === 'h' || u === 'hr' || u === 'hour') return n / 24;
    if (u === 'd' || u === 'day') return n;
    if (u === 'w' || u === 'wk' || u === 'week') return n * 7;
    if (u === 'y' || u === 'yr' || u === 'year') return n * 365;
    return 0;
}

function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(selector);
        if (existing) { resolve(existing); return; }

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { observer.disconnect(); resolve(el); }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for: ${selector}`));
        }, timeout);
    });
}

function sendProgress(countText, phase, pct, videosLeft) {
    chrome.runtime.sendMessage({ action: 'updateProgress', countText, phase, pct, videosLeft: videosLeft ?? null });
}

// ===================== VIDEO ITEM PARSER =====================

function parseVideoItems(limit) {
    // yt-lockup-view-model dipakai halaman PLAYLIST; dua yang lain untuk
    // halaman channel. Selector judul/link di dalamnya sama persis.
    const items = document.querySelectorAll(
        'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model');
    const results = [];
    for (const item of items) {
        if (limit && results.length >= limit) break;

        // New YouTube UI: ytLockupMetadataViewModel structure
        const newTitleEl = item.querySelector('h3.ytLockupMetadataViewModelHeadingReset');
        const newLinkEl = item.querySelector('a.ytLockupMetadataViewModelTitle');
        const newMetaSpans = item.querySelectorAll('span.ytContentMetadataViewModelMetadataText');

        // Legacy YouTube UI: ytd-rich-item-renderer with #video-title
        const legacyTitleLinkEl = item.querySelector('a#video-title-link');
        const legacyTitleEl = item.querySelector('yt-formatted-string#video-title, #video-title');
        const legacyMetaSpans = item.querySelectorAll('#metadata-line span.inline-metadata-item');

        let title = '';
        let views = '';
        let date = '';
        let videoUrl = '';

        let isLiveOrPremiere = false;
        if (newTitleEl) {
            title = (newTitleEl.getAttribute('title') || newLinkEl?.textContent || '').trim();
            // Metadata spans: views = bare number ("8", "1.6K", "830 views"), date = "X ago".
            // Order matters: detect date first (it also has digits), then views = remaining digit span.
            for (const span of newMetaSpans) {
                const t = span.textContent.trim();
                if (/watching|premier/i.test(t)) { isLiveOrPremiere = true; break; }
                if (!date && /ago|hour|day|week|month|year|minute|second|streamed/i.test(t)) { date = t; continue; }
                if (!views && /\d/.test(t) && !/subscriber/i.test(t)) { views = t; continue; }
                if (!views && /no views/i.test(t)) { views = t; }
            }
            videoUrl = newLinkEl ? new URL(newLinkEl.getAttribute('href'), 'https://www.youtube.com').href : '';
        } else {
            title = (legacyTitleLinkEl?.title || legacyTitleEl?.textContent || '').trim();
            views = legacyMetaSpans[0] ? legacyMetaSpans[0].textContent.trim() : '';
            date = legacyMetaSpans[1] ? legacyMetaSpans[1].textContent.trim() : '';
            if (/watching/i.test(views) || /premier/i.test(date)) isLiveOrPremiere = true;
            const linkEl = legacyTitleLinkEl || item.querySelector('a#thumbnail') || item.querySelector('a[href*="/watch?v="]');
            videoUrl = linkEl ? linkEl.href : '';
        }

        if (!title) continue;
        // Skip live streams and upcoming/scheduled premieres — no published views
        if (isLiveOrPremiere) continue;
        const videoId = videoUrl ? new URL(videoUrl).searchParams.get('v') : '';
        const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
        results.push({ title, views, date, videoUrl, thumbnailUrl });
    }
    console.log(`[YTR] parseVideoItems: ${items.length} containers, ${results.length} parsed`,
        results.slice(0, 6).map(r => `${r.views}|${r.date}`));
    return results;
}

// ===================== CHANNEL INFO SCRAPER =====================

async function scrapeChannelInfo() {
    console.log('[YTResearch] Scraping channel info...');
    try {
        await waitForElement('#channel-name, ytd-channel-name', 8000);
    } catch (e) {
        console.warn('[YTResearch] Channel name not found');
    }
    await sleep(1000);

    // Avatar
    const avatarImg = document.querySelector('img.ytSpecAvatarShapeImage');
    const avatarUrl = avatarImg ? avatarImg.src : '';

    // Banner (optional — not all channels have it)
    const bannerImg = document.querySelector('yt-image-banner-view-model img');
    const bannerUrl = bannerImg ? bannerImg.src : '';

    // Channel name from header or page title
    const nameEl = document.querySelector('yt-formatted-string#text.ytd-channel-name')
        || document.querySelector('#channel-name yt-formatted-string')
        || document.querySelector('ytd-channel-name yt-formatted-string')
        || document.querySelector('#channel-name')
        || document.querySelector('ytd-engagement-panel-title-header-renderer #title-text')
        || document.querySelector('h1[class*="channel"] yt-formatted-string')
        || document.querySelector('meta[property="og:title"]');
    let channelName = nameEl ? (nameEl.content || nameEl.textContent || '').trim() : '';
    // fallback: page title before " - YouTube"
    if (!channelName) {
        const titleMatch = document.title.match(/^(.+?)\s*[-–|]/);
        if (titleMatch) channelName = titleMatch[1].trim();
    }

    // Subscribers from header
    const subEl = document.querySelector('#subscriber-count');
    const subscribers = subEl ? subEl.textContent.trim() : '';

    // Click "...more" to open the About modal
    const moreBtn = document.querySelector('button.ytTruncatedTextAbsoluteButton')
        || document.querySelector('#channel-description-container #expand')
        || document.querySelector('#description-container #expand')
        || document.querySelector('tp-yt-paper-button#expand');
    console.log('[YTResearch] More button found:', !!moreBtn);
    if (moreBtn) {
        moreBtn.click();
        await sleep(2000);
    }

    // Wait for ytd-about-channel-renderer to appear in DOM
    let modal = null;
    try {
        modal = await waitForElement('ytd-about-channel-renderer', 5000);
    } catch (e) {
        console.warn('[YTResearch] ytd-about-channel-renderer not found after wait');
        modal = document.querySelector('ytd-about-channel-renderer');
    }

    if (!modal) {
        console.warn('[YTResearch] Modal not found — falling back to page scrape');
        return scrapeChannelInfoFallback(channelName, subscribers);
    }
    console.log('[YTResearch] Modal found: ytd-about-channel-renderer');

    // Description: flatten newlines for CSV readability
    const descEl = modal.querySelector('#description-container')
        || modal.querySelector('yt-attributed-string[id="description-container"]');
    const rawDesc = descEl ? descEl.innerText.trim() : '';
    const channelDescription = rawDesc.replace(/\n\n+/g, ' | ').replace(/\n/g, ' ');

    // Channel URL: <a> tag inside modal
    const urlEl = modal.querySelector('a[href*="youtube.com/@"], a[href*="youtube.com/channel/"]');
    const channelUrl = urlEl ? urlEl.href.replace('http://', 'https://') : '';

    // Parse table rows: each row has icon + td with value
    // Rows contain: country, joined date, subscribers, videos, views
    let country = '';
    let joinedDate = '';
    let totalVideos = '';
    let totalViews = '';
    let subscribersFromModal = '';

    const rows = modal.querySelectorAll('tr.description-item');
    for (const row of rows) {
        const iconEl = row.querySelector('yt-icon');
        const icon = iconEl ? iconEl.getAttribute('icon') : '';
        const tds = row.querySelectorAll('td');
        const valueTd = tds[1];
        if (!valueTd) continue;
        const value = valueTd.textContent.trim();
        if (!value) continue;

        if (icon === 'privacy_public' || icon === 'globe') {
            country = value;
        } else if (icon === 'info_outline' || icon === 'info') {
            joinedDate = value.replace(/^Joined\s+/i, '').trim();
        } else if (icon === 'person_radar' || icon === 'person') {
            subscribersFromModal = value;
        } else if (icon === 'my_videos' || icon === 'video_library') {
            const m = value.match(/([\d,]+)/);
            if (m) totalVideos = m[1].replace(/,/g, '');
        } else if (icon === 'trending_up') {
            totalViews = value;
        }
    }

    // Close modal
    const closeBtn = modal.closest('tp-yt-paper-dialog')?.querySelector('button[aria-label="Close"], [dialog-dismiss]');
    if (closeBtn) { closeBtn.click(); await sleep(300); }

    return {
        channelName,
        subscribers: subscribersFromModal || subscribers,
        totalVideos,
        totalViews,
        channelUrl,
        country,
        joinedDate,
        channelDescription,
        avatarUrl,
        bannerUrl
    };
}

async function scrapeChannelInfoFallback(channelName, subscribers) {
    // No modal — expand description in-place and scrape what's available
    const expandBtn = document.querySelector('#description-container #expand');
    if (expandBtn) { expandBtn.click(); await sleep(400); }

    const descEl = document.querySelector('#description yt-formatted-string')
        || document.querySelector('#channel-description-container yt-formatted-string');
    const channelDescription = descEl ? descEl.innerText.trim() : '';

    // Total videos from tab label
    const videosTabEl = document.querySelector('yt-tab-shape[tab-identifier="FEchannelVideos"] .tab-title');
    let totalVideos = '';
    if (videosTabEl) {
        const m = videosTabEl.textContent.match(/([\d,]+)/);
        if (m) totalVideos = m[1].replace(/,/g, '');
    }

    return {
        channelName,
        subscribers,
        totalVideos,
        totalViews: '',
        channelUrl: window.location.href,
        country: '',
        joinedDate: '',
        channelDescription,
        avatarUrl: '',
        bannerUrl: ''
    };
}

// ===================== TRANSCRIPT SCRAPER =====================

async function scrapeTranscript() {
    // Halaman video sering masih memuat saat fungsi ini dipanggil, sehingga
    // tombol "Show transcript" belum ada. Dulu langsung menyerah di sini —
    // itu sebab sebagian video dilaporkan "TIDAK ADA TRANSCRIPT" padahal ada.
    let btn = null;
    for (let i = 0; i < 40; i++) {              // sampai ~20 detik
        const btns = [...document.querySelectorAll('button[aria-label="Show transcript"]')];
        btn = btns.find(b => b.offsetParent !== null) || btns[0];
        if (btn) break;
        await sleep(500);
    }
    if (!btn) return '';
    btn.click();

    // Dua layout hidup berdampingan:
    //   A (lama) transcript-segment-view-model  di dalam yt-section-list-renderer
    //   B (kini) ytd-transcript-segment-renderer di dalam ytd-transcript-renderer
    // Jangan pakai atribut `visibility` panel sebagai penanda siap — panel bisa
    // tetap bertanda HIDDEN padahal isinya sudah tampil di layar.
    const SEL = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
    let segments = [];
    for (let i = 0; i < 60; i++) {          // sampai ~30 detik
        await sleep(500);
        segments = document.querySelectorAll(SEL);
        if (segments.length) break;
        // Panel bisa terbuka dengan spinner dan belum berisi apa pun. Kalau
        // tombolnya kembali ke keadaan tertutup (klik tak terdaftar), klik lagi.
        if (i === 10 || i === 25) {
            const again = [...document.querySelectorAll('button[aria-label="Show transcript"]')]
                .find(b => b.offsetParent !== null);
            if (again) again.click();
        }
    }
    if (!segments.length) return '';

    // Baris panjang dimuat bertahap; tunggu jumlahnya berhenti bertambah.
    let prev = 0;
    for (let i = 0; i < 10 && segments.length !== prev; i++) {
        prev = segments.length;
        await sleep(600);
        segments = document.querySelectorAll(SEL);
    }

    const parts = [];
    for (const seg of segments) {
        const ts = (
            seg.querySelector('.segment-timestamp') ||                    // layout B
            seg.querySelector('.ytwTranscriptSegmentViewModelTimestamp')  // layout A
        )?.textContent?.trim() || '';
        const text = (
            seg.querySelector('yt-formatted-string.segment-text') ||      // layout B
            seg.querySelector('span[role="text"]')                        // layout A
        )?.textContent?.trim() || '';
        if (ts && text) parts.push(`[${ts}] ${text}`);
        else if (text) parts.push(text);
    }
    return parts.join(' ');
}

// ===================== RESEARCH NICHE (BATCH SEARCH → CHANNELS) =====================

const DEFAULT_DATE_FILTER = 'EgIIAw%3D%3D'; // upload date: this week

function buildSearchUrl(niche, suffix, dateFilter) {
    const query = `${niche} ${suffix || ''}`.trim();
    const q = encodeURIComponent(query).replace(/%20/g, '+');
    const sp = dateFilter || DEFAULT_DATE_FILTER;
    return `https://www.youtube.com/results?search_query=${q}&sp=${sp}`;
}

/** URL ini playlist? (list= tanpa v=, atau /playlist?list=) */
function isPlaylistUrl(href) {
    if (!href) return false;
    return /[?&]list=/.test(href) && !/[?&]v=/.test(href);
}

/** Ambil URL playlist bersih dari apa pun yang ditempel user. */
function normalizePlaylistUrl(href) {
    const m = (href || '').match(/[?&]list=([A-Za-z0-9_-]+)/);
    return m ? `https://www.youtube.com/playlist?list=${m[1]}` : null;
}

function normalizeChannelUrl(href) {
    if (!href) return null;
    let m = href.match(/\/(@[^/?#]+)/);
    if (m) return 'https://www.youtube.com/' + m[1];
    m = href.match(/\/channel\/([^/?#]+)/);
    if (m) return 'https://www.youtube.com/channel/' + m[1];
    m = href.match(/\/user\/([^/?#]+)/);
    if (m) return 'https://www.youtube.com/user/' + m[1];
    m = href.match(/\/c\/([^/?#]+)/);
    if (m) return 'https://www.youtube.com/c/' + m[1];
    return null;
}

function getChannelNameFromPage() {
    const el = document.querySelector('yt-formatted-string.ytd-channel-name#text')
        || document.querySelector('#channel-name #text')
        || document.querySelector('ytd-channel-name yt-formatted-string')
        || document.querySelector('meta[property="og:title"]');
    if (!el) return '';
    return (el.content || el.textContent || '').trim();
}

// Wait until video items are actually rendered (titles populated), not just containers present.
// YouTube lazy-renders items; parsing too early yields only 1 item.
async function waitForItemsStable(timeout = 8000) {
    const deadline = Date.now() + timeout;
    let lastCount = -1, stableSince = 0;
    while (Date.now() < deadline) {
        const titled = document.querySelectorAll('h3.ytLockupMetadataViewModelHeadingReset[title]:not([title=""])').length;
        const containers = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer').length;
        if (titled > 0 && titled >= containers) return; // all rendered
        if (titled === lastCount) {
            if (!stableSince) stableSince = Date.now();
            if (Date.now() - stableSince >= 800) return; // count stable — good enough
        } else { lastCount = titled; stableSince = 0; }
        await sleep(200);
    }
}

async function waitForVideos() {
    try {
        await waitForElement('ytd-rich-item-renderer, ytd-grid-video-renderer', 12000);
    } catch (e) { /* no videos — return empty downstream */ }
    await waitForItemsStable();
    await sleep(300);
}

// Poll until rendered video-title count stops increasing for 600ms, or 10s deadline.
async function waitForListSettle() {
    await new Promise((resolve) => {
        const deadline = Date.now() + 10000;
        let lastCount = -1, stableAt = 0;
        const poll = () => {
            if (Date.now() > deadline) { resolve(); return; }
            const count = document.querySelectorAll('h3.ytLockupMetadataViewModelHeadingReset[title]:not([title=""])').length;
            if (count > 0 && count === lastCount) {
                if (stableAt === 0) stableAt = Date.now();
                if (Date.now() - stableAt >= 600) { resolve(); return; }
            } else { lastCount = count; stableAt = 0; }
            setTimeout(poll, 150);
        };
        poll();
    });
    await sleep(300);
}

// Activate a sort (Latest/Popular/Oldest). Handles two YouTube layouts:
//   1. Standard chip tabs:  button[aria-label="Popular"]
//   2. Combobox dropdown (membership channels): button[role="combobox"] → dropdown options
// Returns true if a sort control exists, false if the channel has none (small channels).
async function clickChipAndWait(label) {
    // Layout 1 — standard chip tab
    const btn = document.querySelector(`button.ytChipShapeButtonReset[aria-label="${label}"]`);
    if (btn) {
        const isActive = btn.getAttribute('aria-selected') === 'true';
        console.log(`[YTResearch] clickChipAndWait "${label}" (chip) isActive=${isActive}`);
        if (!isActive) {
            btn.click();
            await sleep(800);
            try { await waitForListSettle(); } catch (e) {}
        }
        return true;
    }

    // Layout 2 — combobox sort dropdown (membership channels)
    // Dropdown renders in ytd-popup-container as tp-yt-iron-dropdown →
    //   yt-list-item-view-model[role="menuitem"] → button → span.ytListItemViewModelTitle (text)
    const combo = document.querySelector('button.ytChipShapeButtonReset[role="combobox"]');
    if (combo) {
        const current = combo.textContent.trim().toLowerCase();
        console.log(`[YTResearch] clickChipAndWait "${label}" (combobox) current="${current}"`);
        if (current.includes(label.toLowerCase())) return true; // already selected
        combo.click();
        // Wait for the dropdown menu items to appear (rendered in a separate popup container)
        let items = [];
        for (let i = 0; i < 20; i++) {
            await sleep(150);
            items = [...document.querySelectorAll('yt-list-item-view-model[role="menuitem"], tp-yt-iron-dropdown [role="menuitem"]')];
            if (items.length) break;
        }
        const wanted = label.toLowerCase();
        const opt = items.find(el => {
            const titleEl = el.querySelector('.ytListItemViewModelTitle') || el;
            return titleEl.textContent.trim().toLowerCase() === wanted;
        });
        if (opt) {
            // Click the inner button (the actual interactive element), fallback to the item
            (opt.querySelector('button') || opt).click();
            await sleep(800);
            try { await waitForListSettle(); } catch (e) {}
            return true;
        }
        // No matching option — close dropdown
        combo.click();
        console.warn(`[YTResearch] combobox option "${label}" not found (${items.length} items seen)`);
        return false;
    }

    return false;
}

// For small channels without chip tabs: sort all video items by views descending, return top N.
function getMostPopularFromList(videoList, n) {
    return [...videoList]
        .sort((a, b) => (parseNumber(b.views) || 0) - (parseNumber(a.views) || 0))
        .slice(0, n);
}

// For small channels: approximate oldest by extracting numeric value from relative date string.
// Higher ageScore = older. Falls back to last item (newest-first default sort).
function getOldestFromList(videoList) {
    if (!videoList.length) return null;
    return [...videoList].sort((a, b) => ageScore(b.date) - ageScore(a.date))[0];
}

// Collect unique uploading channels from search results (video renderers).
async function extractChannelsFromSearch(limit, label = '?') {
    try {
        await waitForElement('ytd-video-renderer, ytd-channel-renderer', 12000);
    } catch (e) {
        console.log(`[YTR] search "${label}": 0 video-renderers (timeout — likely rate-limited or empty)`);
        return [];
    }
    await sleep(1500);

    const seen = new Set();
    const channels = [];

    const collect = () => {
        const videoItems = document.querySelectorAll('ytd-video-renderer');
        for (const item of videoItems) {
            // First anchor whose href is actually a channel link (skip /watch title links)
            const a = [...item.querySelectorAll('ytd-channel-name a, #channel-info a, a.yt-simple-endpoint')]
                .find(x => {
                    const h = x.getAttribute('href') || '';
                    return h.startsWith('/@') || h.includes('/channel/') || h.includes('/user/') || h.includes('/c/');
                });
            if (!a) continue;
            const url = normalizeChannelUrl(a.getAttribute('href'));
            if (!url || seen.has(url)) continue;
            seen.add(url);
            channels.push({ name: (a.textContent || '').trim(), url });
            if (channels.length >= limit) return true;
        }
        return false;
    };

    let scrolls = 0;
    let prevChannelCount = 0;
    let stalled = 0;
    while (channels.length < limit && scrolls < 30) {
        if (window.ytResearchStopRequested) break;
        if (collect()) break;
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(2500);
        scrolls++;
        // Stall = no new unique channels found after this scroll
        if (channels.length === prevChannelCount) {
            if (++stalled >= 3) break; // YouTube exhausted for this niche
        } else {
            stalled = 0;
            prevChannelCount = channels.length;
        }
    }
    collect();
    const totalRenderers = document.querySelectorAll('ytd-video-renderer').length;
    // renderers low (<10) → likely rate-limited/empty; renderers high but few channels → dedupe/extraction
    console.log(`[YTR] search "${label}": ${totalRenderers} video-renderers, ${scrolls} scrolls → ${channels.length} channels`);
    return channels.slice(0, limit);
}

// Header line for progress. URL-mode niches are blank → show "Channels" instead of "Niche i/N: ".
function nicheCountLabel(queue, idx) {
    const label = queue[idx];
    if (!label) return `Channels`;
    return `Niche ${idx + 1}/${queue.length}: ${label}`;
}

function sendNicheProgress(state, countText, phaseText) {
    const done = state.doneChannels || 0;
    const est = state.estTotalChannels || 0;
    const pct = est ? Math.min(99, Math.round((done / est) * 100)) : 0;
    chrome.runtime.sendMessage({
        action: 'updateProgress', countText, phase: phaseText, pct,
        videosLeft: est ? est - done : null
    });
}

async function gotoNextNiche(state) {
    const cfg = state.researchConfig || {};
    const queue = state.nicheQueue || [];
    const nextIdx = (state.nicheIndex || 0) + 1;
    if (window.ytResearchStopRequested || nextIdx >= queue.length) {
        await chrome.storage.local.set({ researchPhase: 'done' });
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }
    await chrome.storage.local.set({
        nicheIndex: nextIdx,
        researchPhase: 'search',
        nicheChannelQueue: [],
        nicheChannelIndex: 0,
        nicheCurrentRow: null
    });
    await sleep(600);
    chrome.runtime.sendMessage({ action: 'navigateTo', url: buildSearchUrl(queue[nextIdx], cfg.suffix, cfg.dateFilter) });
}

// Channel page redirected / unhandled URL — save partial row and advance so run doesn't hang.
async function skipStuckChannel() {
    if (window.ytResearchNicheRunning) return;
    window.ytResearchNicheRunning = true;
    try {
        const state = await chrome.storage.local.get([
            'researchConfig', 'nicheQueue', 'nicheIndex', 'nicheChannelQueue',
            'nicheChannelIndex', 'nicheResults', 'estTotalChannels', 'nicheCurrentRow', 'doneChannels'
        ]);
        const results = state.nicheResults || [];
        // Keep whatever partial data was collected for this channel
        if (state.nicheCurrentRow && state.nicheCurrentRow.channelUrl) {
            results.push(state.nicheCurrentRow);
        }
        const done = (state.doneChannels || 0) + 1;
        await chrome.storage.local.set({ nicheResults: results, doneChannels: done });

        const chQueue = state.nicheChannelQueue || [];
        const nextChIdx = (state.nicheChannelIndex || 0) + 1;
        if (nextChIdx < chQueue.length && !window.ytResearchStopRequested) {
            await chrome.storage.local.set({ nicheChannelIndex: nextChIdx, researchPhase: 'channel-latest', nicheCurrentRow: null });
            await sleep(600);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: chQueue[nextChIdx].url + '/videos' });
        } else {
            await gotoNextNiche({ ...state, nicheResults: results, doneChannels: done });
        }
    } finally {
        window.ytResearchNicheRunning = false;
    }
}

async function runNicheResearch() {
    if (window.ytResearchNicheRunning) {
        console.warn('[YTResearch] runNicheResearch already running, ignoring');
        return;
    }
    window.ytResearchNicheRunning = true;
    try {
        const pageType = getPageType();
        const state = await chrome.storage.local.get([
            'researchConfig', 'nicheQueue', 'nicheIndex', 'nicheChannelQueue',
            'nicheChannelIndex', 'nicheResults', 'researchPhase', 'estTotalChannels',
            'nicheCurrentRow', 'doneChannels'
        ]);
        const phase = state.researchPhase;
        const queue = state.nicheQueue || [];
        const cfg = state.researchConfig || {};

        console.log(`[YTResearch] runNicheResearch page=${pageType} phase=${phase} niche=${state.nicheIndex} ch=${state.nicheChannelIndex}`);

        if (window.ytResearchStopRequested) {
            chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
            return;
        }

        // ── SEARCH: find channels for current niche ──
        if (phase === 'search' && pageType === 'search-results') {
            const nicheIdx = state.nicheIndex || 0;
            const niche = queue[nicheIdx];
            // Elapsed-time log: correlate throttle with request count vs wall-clock
            const { runStartedAt } = await chrome.storage.local.get(['runStartedAt']);
            const startedAt = runStartedAt || Date.now();
            if (!runStartedAt) await chrome.storage.local.set({ runStartedAt: startedAt });
            const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
            const approxNav = nicheIdx * ((cfg.channelsPerNiche || 10) * 3 + 1);
            console.log(`[YTR] niche#${nicheIdx + 1} "${niche}" | elapsed ${elapsedMin}min | ~${approxNav} navigations so far`);
            sendNicheProgress(state, `Niche ${nicheIdx + 1}/${queue.length}: ${niche}`, `Searching…`);
            const channels = await extractChannelsFromSearch(cfg.channelsPerNiche || 10, niche);
            if (window.ytResearchStopRequested) { chrome.runtime.sendMessage({ action: 'scrapingJobDone' }); return; }
            if (channels.length === 0) {
                await gotoNextNiche(state);
                return;
            }
            await chrome.storage.local.set({
                nicheChannelQueue: channels,
                nicheChannelIndex: 0,
                researchPhase: 'channel-latest',
                nicheCurrentRow: null
            });
            await sleep(600);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: channels[0].url + '/videos' });
            return;
        }

        // ── CHANNEL LATEST: 5 newest videos → avg views ──
        if (phase === 'channel-latest') {
            const chQueue = state.nicheChannelQueue || [];
            const chIdx = state.nicheChannelIndex || 0;
            const ch = chQueue[chIdx];
            const nicheIdx = state.nicheIndex || 0;
            const niche = queue[nicheIdx];
            sendNicheProgress(state, nicheCountLabel(queue, nicheIdx), `Ch ${chIdx + 1}/${chQueue.length} · Latest videos…`);
            await waitForVideos();
            await clickChipAndWait('Latest'); // ensure Latest chip active (no-op if no chips)

            const latest5 = parseVideoItems(5);
            const viewNums = latest5.map(v => parseNumber(v.views)).filter(n => typeof n === 'number' && !isNaN(n));
            const avgViews = viewNums.length ? Math.round(viewNums.reduce((a, b) => a + b, 0) / viewNums.length) : '';
            console.log('[YTR] latest5 views:', latest5.map(v => v.views), 'avg:', avgViews);

            const subEl = document.querySelector('#subscriber-count');
            const subscribers = subEl ? subEl.textContent.trim() : '';

            const row = {
                niche,
                channelUrl: ch.url + '/videos',
                subscribers,
                avgViews,
                latestDate: latest5[0] ? latest5[0].date : '',
                popularViews: '',
                oldestDate: ''
            };
            await chrome.storage.local.set({ nicheCurrentRow: row, researchPhase: 'channel-popular' });
            await sleep(500);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: ch.url + '/videos?view=0&sort=p' });
            return;
        }

        // ── CHANNEL POPULAR: most-viewed video ──
        if (phase === 'channel-popular') {
            const ch = (state.nicheChannelQueue || [])[state.nicheChannelIndex || 0];
            const _popNicheIdx = state.nicheIndex || 0;
            const _popChIdx = state.nicheChannelIndex || 0;
            sendNicheProgress(state, nicheCountLabel(queue, _popNicheIdx), `Ch ${_popChIdx + 1}/${(state.nicheChannelQueue||[]).length} · Popular video…`);
            await waitForVideos();
            await clickChipAndWait('Popular'); // load popular-sorted videos (best effort)
            // Don't trust chip sort — parse all and pick highest views ourselves
            let popVideos = parseVideoItems(0);
            if (!popVideos.length || !popVideos.some(v => v.views)) {
                await sleep(2500);
                popVideos = parseVideoItems(0);
            }
            const topPop = getMostPopularFromList(popVideos, 1)[0];
            const popularViews = topPop ? topPop.views : '';
            console.log('[YTR] popular pick:', popularViews || 'none', 'from views:', popVideos.map(v => v.views));
            const row = { ...(state.nicheCurrentRow || {}), popularViews };
            await chrome.storage.local.set({ nicheCurrentRow: row, researchPhase: 'channel-oldest' });
            await sleep(500);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: ch.url + '/videos?view=0&sort=da' });
            return;
        }

        // ── CHANNEL OLDEST: finalize row, advance ──
        if (phase === 'channel-oldest') {
            const _oldNicheIdx = state.nicheIndex || 0;
            const _oldChIdx = state.nicheChannelIndex || 0;
            sendNicheProgress(state, nicheCountLabel(queue, _oldNicheIdx), `Ch ${_oldChIdx + 1}/${(state.nicheChannelQueue||[]).length} · Oldest video…`);
            await waitForVideos();
            await clickChipAndWait('Oldest'); // load oldest-sorted videos (best effort)
            // Don't trust chip sort — parse all and pick the genuinely oldest by date ourselves
            let oldVideos = parseVideoItems(0);
            if (!oldVideos.length || !oldVideos.some(v => v.date)) {
                await sleep(2500);
                oldVideos = parseVideoItems(0);
            }
            const oldest = getOldestFromList(oldVideos);
            const oldestDate = oldest ? oldest.date : '';
            console.log('[YTR] oldest pick:', oldestDate || 'none', 'from dates:', oldVideos.map(v => v.date));
            const row = { ...(state.nicheCurrentRow || {}), oldestDate };

            const results = state.nicheResults || [];
            results.push(row);
            const done = (state.doneChannels || 0) + 1;
            const est = state.estTotalChannels || 0;
            await chrome.storage.local.set({ nicheResults: results, doneChannels: done });

            chrome.runtime.sendMessage({
                action: 'updateProgress',
                countText: `${done} channel${done > 1 ? 's' : ''} done`,
                phase: 'Channel complete…',
                pct: est ? Math.min(99, Math.round((done / est) * 100)) : 0,
                videoCompleted: true,
                videosLeft: est ? est - done : null
            });
            await sleep(600);

            const chQueue = state.nicheChannelQueue || [];
            const nextChIdx = (state.nicheChannelIndex || 0) + 1;
            if (nextChIdx < chQueue.length && !window.ytResearchStopRequested) {
                await chrome.storage.local.set({ nicheChannelIndex: nextChIdx, researchPhase: 'channel-latest', nicheCurrentRow: null });
                await sleep(600);
                chrome.runtime.sendMessage({ action: 'navigateTo', url: chQueue[nextChIdx].url + '/videos' });
            } else {
                await gotoNextNiche({ ...state, nicheResults: results, doneChannels: done });
            }
            return;
        }

        console.warn('[YTResearch] runNicheResearch unhandled state', { phase, pageType });
    } finally {
        window.ytResearchNicheRunning = false;
    }
}

// ===================== COMPETITOR DEEP DIVE SCRAPER =====================

function applyVideoFilter(videoList, filter) {
    if (!filter || filter.mode === 'all') return videoList;
    if (filter.mode === 'count') {
        const n = parseInt(filter.count, 10);
        if (!n || n <= 0) return videoList;
        // YouTube /videos sorts newest first by default
        return filter.direction === 'oldest' ? videoList.slice(-n) : videoList.slice(0, n);
    }
    // date filter: relative dates ("2 days ago") not parseable — return all
    return videoList;
}

async function runDeepDive(deepdiveOptions) {
    if (window.ytResearchDeepDiveRunning) {
        console.warn('[YTResearch] runDeepDive already running, ignoring');
        return;
    }
    window.ytResearchDeepDiveRunning = true;
    try {
    const pageType = getPageType();
    const state = await chrome.storage.local.get(['scrapePhase', 'channelBase', 'deepdiveChannelInfo', 'deepdiveVideoList', 'deepdiveVideoIndex', 'videoFilter']);
    const phase = state.scrapePhase;

    console.log(`[YTResearch] runDeepDive page=${pageType} phase=${phase}`);

    if (window.ytResearchStopRequested) {
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }

    // Phase: collect channel info / channel images from home page
    const needsChannelHome = deepdiveOptions.channelInfo || deepdiveOptions.channelImages;
    if (needsChannelHome && !phase && pageType !== 'channel-home') {
        const channelBase = getChannelBaseUrl();
        await chrome.storage.local.set({ channelBase, scrapePhase: 'channel-home' });
        sendProgress('Step 1', 'Loading channel home…', 5);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: channelBase });
        return;
    }

    if (phase === 'channel-home' || (needsChannelHome && pageType === 'channel-home' && !phase)) {
        sendProgress('Step 1', 'Scraping channel info…', 10);
        const channelInfo = await scrapeChannelInfo();
        console.log('[YTResearch] Channel info scraped:', JSON.stringify(channelInfo));
        await chrome.storage.local.set({ deepdiveChannelInfo: channelInfo, scrapePhase: 'videos' });

        if (deepdiveOptions.channelImages && channelInfo) {
            const safeName = (channelInfo.channelName || 'channel')
                .replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
            if (channelInfo.avatarUrl) {
                chrome.runtime.sendMessage({ action: 'downloadThumbnail', url: channelInfo.avatarUrl, filename: `channel-images/${safeName}_avatar.jpg` });
            }
            if (channelInfo.bannerUrl) {
                chrome.runtime.sendMessage({ action: 'downloadThumbnail', url: channelInfo.bannerUrl, filename: `channel-images/${safeName}_banner.jpg` });
            }
        }

        if (!deepdiveOptions.videoData && !deepdiveOptions.thumbnails) {
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: [] });
            return;
        }

        const channelBase = state.channelBase || getChannelBaseUrl();
        sendProgress('Step 2', 'Loading videos page…', 15);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: channelBase + '/videos' });
        return;
    }

    // Phase: scroll and collect all videos
    if ((!phase && pageType !== 'channel-home') || phase === 'videos') {
        if (!deepdiveOptions.channelInfo) {
            const channelBase = getChannelBaseUrl();
            await chrome.storage.local.set({ channelBase });
        }

        sendProgress('Step 2', 'Loading all videos (scrolling)…', 20);
        try {
            await waitForElement('ytd-rich-item-renderer, ytd-grid-video-renderer', 12000);
        } catch (e) {
            console.error('[YTResearch] No video items found');
            await finishDeepDive(deepdiveOptions, state);
            return;
        }
        await sleep(1500);

        // Infinite scroll: scroll until no new items (stall 3x before stopping)
        let prevCount = 0;
        let scrollAttempts = 0;
        let stalled = 0;
        const MAX_SCROLL = 100;
        while (scrollAttempts < MAX_SCROLL) {
            if (window.ytResearchStopRequested) break;
            const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
            if (items.length === prevCount && scrollAttempts > 0) {
                if (++stalled >= 3) break; // truly exhausted
            } else {
                stalled = 0;
                prevCount = items.length;
            }
            window.scrollTo(0, document.body.scrollHeight);
            sendProgress(`Scrolling…`, `Loaded ${prevCount} videos`, Math.min(20 + scrollAttempts, 60));
            await sleep(1800);
            scrollAttempts++;
        }

        const rawVideoList = parseVideoItems(0);
        const videoList = applyVideoFilter(rawVideoList, state.videoFilter);
        console.log(`[YTResearch] Deep dive collected ${rawVideoList.length} videos, ${videoList.length} after filter`);

        if (deepdiveOptions.thumbnails && videoList.length > 0) {
            const total = videoList.length;
            const channelName = (state.deepdiveChannelInfo?.channelName || 'channel')
                .replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
            videoList.forEach((v, i) => {
                if (!v.thumbnailUrl) return;
                const num = String(total - i).padStart(3, '0');
                chrome.runtime.sendMessage({ action: 'downloadThumbnail', url: v.thumbnailUrl, filename: `thumbnails/${channelName}_${num}.jpg` });
            });
            sendProgress('Thumbnails', `Downloading ${total} thumbnails…`, 65);
            await sleep(1000);
        }

        if (!deepdiveOptions.videoData) {
            // No per-video scraping needed — finish with channel info only
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: [] });
            return;
        }

        if (videoList.length === 0) {
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: [] });
            return;
        }

        await chrome.storage.local.set({
            deepdiveVideoList: videoList,
            deepdiveVideoIndex: 0,
            scrapePhase: 'video-detail'
        });
        sendProgress('Step 3', `Video 1/${videoList.length}: loading…`, 62);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: videoList[0].videoUrl });
        return;
    }

    // Phase: scrape per-video data
    if (phase === 'video-detail' && pageType === 'watch') {
        const videoList = state.deepdiveVideoList || [];
        const idx = state.deepdiveVideoIndex || 0;
        const total = videoList.length;

        sendProgress(`Video ${idx + 1}/${total}`, 'Scraping video data…', Math.round(((idx + 1) / total) * 100), total - idx - 1);
        await sleep(3000);

        // Scroll to top to ensure #info and title are visible/rendered
        window.scrollTo(0, 0);
        await sleep(500);

        // Exact title
        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            || document.querySelector('ytd-watch-metadata h1 yt-formatted-string');
        const exactTitle = titleEl ? titleEl.textContent.trim() : videoList[idx].title;

        // Description — click expand first (may trigger exact views/date render too)
        let description = '';
        try {
            await waitForElement('#description-inline-expander', 5000);
            const expandBtn = document.querySelector('tp-yt-paper-button#expand');
            if (expandBtn) { expandBtn.click(); await sleep(1500); }
            const expandedEl = document.querySelector('#description-inline-expander #expanded span.ytAttributedStringHost');
            const fallbackEl = document.querySelector('#description-inline-expander');
            const rawDesc = (expandedEl?.innerText || fallbackEl?.innerText || '').trim();
            description = rawDesc.replace(/\n\n+/g, ' | ').replace(/\n/g, ' ');
        } catch (e) { /* description not available */ }

        // Exact views + date — read AFTER expand (expand may trigger exact render)
        let exactViews = videoList[idx].views;
        let exactDate = videoList[idx].date;
        let exactHashtags = '';
        {
            const infoEl = document.querySelector('yt-formatted-string#info');
            const infoText = infoEl ? infoEl.innerText.trim() : '';
            const viewsMatch = infoText.match(/^([\d,]+)\s*views/i);
            const dateMatch = infoText.match(/views\s+(.+)$/i);
            if (viewsMatch) exactViews = parseNumber(viewsMatch[1]);
            if (dateMatch) {
                // Split date from hashtags: "1 Jun 2026  #tag1 #tag2"
                const rawDate = dateMatch[1].trim();
                const hashIdx = rawDate.indexOf('#');
                exactDate = resolveRelativeDate(hashIdx >= 0 ? rawDate.slice(0, hashIdx).trim() : rawDate);
                exactHashtags = hashIdx >= 0 ? rawDate.slice(hashIdx).trim() : '';
            }
            console.log('[YTResearch] views:', exactViews, 'date:', exactDate, 'hashtags:', exactHashtags);
        }

        // Likes — wait for like-button-view-model to render
        let likes = '';
        try {
            await waitForElement('like-button-view-model button .ytSpecButtonShapeNextButtonTextContent', 5000);
            const likesEl = document.querySelector('like-button-view-model button .ytSpecButtonShapeNextButtonTextContent');
            likes = likesEl ? parseNumber(likesEl.textContent.trim()) : '';
        } catch (e) { /* likes not available */ }

        // Comments — wait for #comments to exist, scroll into view, then wait for count
        let comments = '0';
        try {
            await waitForElement('#comments', 8000);
            const commentsSection = document.querySelector('#comments');
            commentsSection.scrollIntoView({ behavior: 'instant' });
            await sleep(2500);
            const commentsEl = document.querySelector('yt-formatted-string.count-text span:first-child');
            comments = commentsEl ? commentsEl.textContent.trim() : '0';
        } catch (e) { /* comments not available */ }

        // How this was made
        const howEl = document.querySelector('how-this-was-made-section-view-model');
        const howThisWasMade = howEl
            ? (howEl.querySelector('.ytwHowThisWasMadeSectionViewModelBodyHeader')?.textContent?.trim() || 'Yes')
            : '';

        // Transcript
        const transcript = await scrapeTranscript();

        videoList[idx] = { ...videoList[idx], title: exactTitle, views: exactViews, date: exactDate, hashtags: exactHashtags, description, likes, comments, howThisWasMade, transcript };

        const nextIdx = idx + 1;
        const videosLeft = total - nextIdx;

        if (nextIdx >= total || window.ytResearchStopRequested) {
            await chrome.storage.local.set({ deepdiveVideoList: videoList, scrapePhase: 'done' });
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: videoList });
        } else {
            await chrome.storage.local.set({ deepdiveVideoList: videoList, deepdiveVideoIndex: nextIdx });
            // videoCompleted=true triggers ETA timestamp recording; same message updates progress
            chrome.runtime.sendMessage({ action: 'updateProgress', countText: `Video ${nextIdx + 1}/${total}`, phase: 'Loading next video…', pct: Math.round(((nextIdx) / total) * 100), videoCompleted: true, videosLeft });
            await sleep(800);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: videoList[nextIdx].videoUrl });
        }
        return;
    }

    console.warn('[YTResearch] Unhandled deepdive state', { phase, pageType });
    chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
    } finally {
        window.ytResearchDeepDiveRunning = false;
    }
}

async function finishDeepDive(deepdiveOptions, state) {
    const videoList = state.deepdiveVideoList || [];
    const channelInfo = state.deepdiveChannelInfo || {};

    await chrome.storage.local.set({
        deepdiveChannelData: deepdiveOptions.channelInfo ? channelInfo : null,
        deepdiveVideoData: deepdiveOptions.videoData ? videoList : null,
        deepdiveOptions,
        scrapePhase: null
    });

    sendProgress('Done', 'Complete', 100);
    chrome.runtime.sendMessage({ action: 'scrapingJobDone' });

    // Navigate back to /videos after done
    const channelBase = state.channelBase || (channelInfo.channelUrl ? channelInfo.channelUrl.replace(/\/$/, '') : null);
    if (channelBase) {
        await sleep(1000);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: channelBase + '/videos' });
    }
}

// ===================== MAIN ENTRY =====================

// ===================== MODE: TRANSCRIPT ONLY =====================
// Ambil transcript saja dari N video sebuah channel, urut popular/latest/oldest.
// Jauh lebih ringan dari Deep Dive: tak buka deskripsi, likes, komentar, thumbnail.

// Urutan HANYA lewat chip. Parameter ?sort=p / ?sort=da dibuang YouTube SPA
// saat halaman dimuat (terbukti: URL kembali ke /videos, chip balik ke Latest),
// jadi mengandalkannya membuat mode Popular/Oldest diam-diam jadi Latest.
const TR_SORT_CHIP = { popular: 'Popular', oldest: 'Oldest', latest: 'Latest' };

async function runTranscriptMode(cfg) {
    if (window.ytResearchTranscriptRunning) return;
    ytlog(`Transcript mulai · sumber=${cfg.source || 'channel'} · sort=${cfg.sort || '-'} · url=${(cfg.url || '(kosong)').slice(0, 80)}`);
    window.ytResearchTranscriptRunning = true;
    try {
        // Sumber "ids": video sudah ditentukan user (sering cuma satu). Tak perlu
        // buka halaman channel sama sekali — langsung ke video pertama.
        if (cfg.source === 'ids') {
            const list = (cfg.ids || []).map(id => ({
                videoUrl: `https://www.youtube.com/watch?v=${id}`,
                title: id,
            }));
            if (!list.length) {
                chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
                return;
            }
            await chrome.storage.local.set({
                transcriptConfig: cfg, transcriptPhase: 'video',
                transcriptList: list, transcriptIndex: 0, transcriptData: [],
                transcriptChannel: '',
            });
            ytlog(`  mode ids: ${list.length} video · id[0]=${list[0].videoUrl.slice(-11)}`);
            sendProgress('Video 1/' + list.length, 'Membuka video…', 10);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: list[0].videoUrl });
            return;
        }

        // Playlist: buka halamannya apa adanya. Menambah "/videos" seperti pada
        // channel justru membuat URL tidak valid.
        const isPl = isPlaylistUrl(cfg.url);
        const base = isPl
            ? normalizePlaylistUrl(cfg.url)
            : (normalizeChannelUrl(cfg.url) || cfg.url.replace(/\/videos\/?$/, ''));
        if (!base) {
            console.error('[YTResearch] URL channel/playlist tidak valid');
            chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
            return;
        }
        const target = isPl ? base : base + '/videos';
        await chrome.storage.local.set({
            transcriptConfig: cfg, transcriptPhase: 'list',
            transcriptList: [], transcriptIndex: 0, transcriptData: [],
            channelBase: base
        });
        sendProgress('Step 1', 'Membuka daftar video…', 5);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: target });
    } finally {
        window.ytResearchTranscriptRunning = false;
    }
}

/**
 * Urutkan daftar video channel lalu kumpulkan N teratas.
 * Dipakai bersama mode Transcript dan Download — logikanya sudah terbukti:
 * chip lebih andal daripada ?sort= (YouTube SPA membuang parameter itu), dan
 * chip baru boleh diklik setelah jumlah item berhenti bertambah.
 */
async function collectChannelVideos(sort, want) {
    const titlesNow = () => [...document.querySelectorAll('ytd-rich-item-renderer')]
        .map(it => (it.querySelector('h3.ytLockupMetadataViewModelHeadingReset')?.getAttribute('title') || ''))
        .join('|');

    // Auto-continue berjalan segera setelah navigasi, saat YouTube baru merender
    // beberapa video pertama. Mengklik chip di kondisi itu membuat pengurutan dan
    // pembacaan daftar saling mendahului, hasilnya tetap urutan Latest.
    let seen = -1, steady = 0;
    for (let i = 0; i < 40; i++) {
        const chipReady = document.querySelector('button.ytChipShapeButtonReset[aria-label="Popular"]')
            || document.querySelector('button.ytChipShapeButtonReset[role="combobox"]');
        const n = document.querySelectorAll('ytd-rich-item-renderer').length;
        if (chipReady && n > 0 && n === seen) {
            if (++steady >= 2) break;
        } else {
            steady = 0;
        }
        seen = n;
        await sleep(500);
    }

    if (sort !== 'latest') {
        const before = titlesNow();
        await clickChipAndWait(TR_SORT_CHIP[sort] || 'Latest');
        for (let i = 0; i < 20; i++) {
            await sleep(700);
            if (titlesNow() && titlesNow() !== before) break;
        }
    } else {
        await clickChipAndWait('Latest');
        await sleep(1200);
    }

    // Gulir secukupnya saja: berhenti begitu jumlah video sudah cukup.
    let prev = 0, stalled = 0;
    for (let i = 0; i < 40; i++) {
        const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
        if (items.length >= want) break;
        if (items.length === prev) { if (++stalled >= 3) break; }
        else { stalled = 0; prev = items.length; }
        window.scrollTo(0, document.body.scrollHeight);
        sendProgress('Memuat daftar', `${items.length} video…`, Math.min(10 + i * 2, 30));
        await sleep(1500);
    }

    return parseVideoItems(0).slice(0, want);
}

// ===================== MODE: DOWNLOAD VIDEO =====================
// Hanya mengumpulkan daftar video di YouTube. Pengunduhan lewat y2mate
// diorkestrasi background.js, karena prosesnya berpindah halaman berkali-kali
// dan itu menghapus state content script.

async function runDownloadMode(cfg) {
    if (window.ytResearchDownloadRunning) return;
    window.ytResearchDownloadRunning = true;
    try {
        // Sumber "ids": video sudah ditentukan user, tak perlu buka YouTube
        // sama sekali — langsung serahkan ke background.
        if (cfg.source === 'ids') {
            const list = (cfg.ids || []).map(id => ({
                videoUrl: `https://www.youtube.com/watch?v=${id}`,
                title: id
            }));
            if (!list.length) {
                chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
                return;
            }
            sendProgress('Mulai', `${list.length} video dari daftar ID`, 5);
            chrome.runtime.sendMessage({ action: 'y2RunList', list, config: cfg });
            return;
        }

        const base = normalizeChannelUrl(cfg.url) || cfg.url.replace(/\/videos\/?$/, '');
        if (!base) {
            chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
            return;
        }
        await chrome.storage.local.set({
            downloadConfig: cfg, downloadPhase: 'list', channelBase: base
        });
        sendProgress('Step 1', 'Membuka daftar video…', 5);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: base + '/videos' });
    } finally {
        window.ytResearchDownloadRunning = false;
    }
}

async function downloadCollectList(state) {
    const cfg = state.downloadConfig || {};
    const want = parseInt(cfg.count, 10) || 5;

    // Urutan & pengumpulan sama persis dengan mode transcript — sudah terbukti.
    const list = await collectChannelVideos(cfg.sort || 'latest', want);
    if (!list || !list.length) {
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }

    await chrome.storage.local.set({ downloadPhase: 'running' });
    sendProgress('Step 2', `${list.length} video — mulai unduh…`, 15);
    chrome.runtime.sendMessage({
        action: 'y2RunList',
        list: list.map(v => ({ videoUrl: v.videoUrl, title: v.title })),
        config: cfg
    });
}

async function transcriptCollectList(state) {
    const cfg = state.transcriptConfig || {};
    const sort = cfg.sort || 'latest';
    const want = parseInt(cfg.count, 10) || 10;

    // PLAYLIST: tidak punya chip Popular/Latest/Oldest, dan urutannya sudah
    // ditentukan pemilik playlist. Menunggu chip di sini berarti menunggu
    // sesuatu yang tak akan pernah muncul.
    if (isPlaylistUrl(location.href)) {
        let prev = 0, stalled = 0;
        for (let i = 0; i < 40; i++) {
            const n = document.querySelectorAll(
                'yt-lockup-view-model, ytd-playlist-video-renderer').length;
            if (n >= want) break;
            if (n === prev) { if (++stalled >= 3) break; }
            else { stalled = 0; prev = n; }
            window.scrollTo(0, document.body.scrollHeight);
            sendProgress('Memuat playlist', `${n} video…`, Math.min(10 + i * 2, 30));
            await sleep(1500);
        }

        const all = parseVideoItems(0);
        const list = all.slice(0, want);
        if (!list.length) {
            chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
            return;
        }
        // Nama playlist dipakai untuk menamai file hasil.
        const plName = (
            document.querySelector('yt-dynamic-sizing-view-model h1')
            || document.querySelector('#title yt-formatted-string')
            || document.querySelector('h1')
        )?.textContent?.trim() || '';

        ytlog(`  playlist "${plName || '(nama kosong)'}" · ${list.length} dari ${all.length} video`);
        await chrome.storage.local.set({
            transcriptList: list, transcriptIndex: 0, transcriptPhase: 'video',
            transcriptChannel: plName,
        });
        sendProgress('Step 2', `Video 1/${list.length}: memuat…`, 35);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: list[0].videoUrl });
        return;
    }

    // Chip lebih andal daripada ?sort= — YouTube SPA sering membuang parameter URL.
    const titlesNow = () => [...document.querySelectorAll('ytd-rich-item-renderer')]
        .map(it => (it.querySelector('h3.ytLockupMetadataViewModelHeadingReset')?.getAttribute('title') || ''))
        .join('|');

    // Auto-continue berjalan segera setelah navigasi, saat YouTube baru merender
    // beberapa video pertama. Mengklik chip di kondisi itu membuat pengurutan
    // dan pembacaan daftar saling mendahului, sehingga hasilnya tetap urutan
    // Latest. Tunggu chip ada DAN jumlah item berhenti bertambah dulu.
    let seen = -1, steady = 0;
    for (let i = 0; i < 40; i++) {
        const chipReady = document.querySelector('button.ytChipShapeButtonReset[aria-label="Popular"]')
            || document.querySelector('button.ytChipShapeButtonReset[role="combobox"]');
        const n = document.querySelectorAll('ytd-rich-item-renderer').length;
        if (chipReady && n > 0 && n === seen) {
            if (++steady >= 2) break;      // stabil 2 pemeriksaan berturut-turut
        } else {
            steady = 0;
        }
        seen = n;
        await sleep(500);
    }

    if (sort !== 'latest') {
        const before = titlesNow();
        await clickChipAndWait(TR_SORT_CHIP[sort]);
        // Daftar diganti secara asinkron; tunggu sampai isinya benar-benar beda
        // daripada menebak dengan jeda tetap.
        for (let i = 0; i < 20; i++) {
            await sleep(700);
            if (titlesNow() && titlesNow() !== before) break;
        }
    } else {
        await clickChipAndWait('Latest');
        await sleep(1200);
    }

    // Gulir secukupnya saja: berhenti begitu jumlah video sudah cukup.
    let prev = 0, stalled = 0;
    for (let i = 0; i < 40; i++) {
        const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
        if (items.length >= want) break;
        if (items.length === prev) { if (++stalled >= 3) break; }
        else { stalled = 0; prev = items.length; }
        window.scrollTo(0, document.body.scrollHeight);
        sendProgress('Memuat daftar', `${items.length} video…`, Math.min(10 + i * 2, 30));
        await sleep(1500);
    }

    const all = parseVideoItems(0);
    const list = all.slice(0, want);
    if (list.length === 0) {
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }
    // Nama channel dipakai untuk menamai file hasil, mengikuti pola yt-transcript
    // (yt-toolkit): "{NamaChannel}_all_transcripts.txt".
    const channelName = (
        document.querySelector('yt-formatted-string.ytd-channel-name#text')?.textContent
        || document.querySelector('meta[property="og:title"]')?.getAttribute('content')
        || document.querySelector('h1 .yt-core-attributed-string')?.textContent
        || ''
    ).trim();

    ytlog(`  channel "${channelName || '(nama kosong)'}" · ${list.length} dari ${all.length} video`);
    await chrome.storage.local.set({
        transcriptList: list, transcriptIndex: 0, transcriptPhase: 'video',
        transcriptChannel: channelName
    });
    sendProgress('Step 2', `Video 1/${list.length}: memuat…`, 35);
    chrome.runtime.sendMessage({ action: 'navigateTo', url: list[0].videoUrl });
}

async function transcriptScrapeOne(state) {
    const cfg = state.transcriptConfig || {};
    const list = state.transcriptList || [];
    const idx = state.transcriptIndex || 0;
    const data = state.transcriptData || [];
    if (idx >= list.length) return;

    const v = list[idx];
    const pct = 35 + Math.round((idx / list.length) * 60);
    sendProgress(`Video ${idx + 1}/${list.length}`, (v.title || '').slice(0, 48), pct);

    // Tunggu halaman video benar-benar siap (judul sudah terisi), bukan jeda
    // tetap — video yang lambat memuat dulu terlewat begitu saja.
    let exactTitle = '';
    for (let i = 0; i < 30; i++) {              // sampai ~15 detik
        await sleep(500);
        exactTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            ?.textContent?.trim() || '';
        if (exactTitle) break;
    }
    if (!exactTitle) {
        exactTitle = v.title || '';
        ytlog(`  video ${idx + 1}: judul dari DOM KOSONG, pakai fallback "${exactTitle}"`);
    } else {
        ytlog(`  video ${idx + 1}: judul "${exactTitle.slice(0, 60)}"`);
    }
    let text = '';
    try {
        text = await scrapeTranscript();
    } catch (e) {
        console.warn('[YTResearch] transcript gagal', e);
    }
    ytlog(`  video ${idx + 1}: transcript ${text ? text.length + ' karakter' : 'TIDAK ADA'}`);
    if (text && cfg.timestamps === false) {
        text = text.replace(/\[\d+:\d+(?::\d+)?\]\s*/g, '');
    }
    data.push({
        title: exactTitle,
        videoUrl: v.videoUrl,
        transcript: text || '[TIDAK ADA TRANSCRIPT]'
    });

    // Mode "video tertentu" tidak pernah membuka halaman channel, jadi nama
    // channel diambil dari halaman video ini — kalau tidak, semua file hasil
    // bernama "channel_all_transcripts.txt" dan saling bertabrakan.
    if (!state.transcriptChannel) {
        const ch = (
            document.querySelector('ytd-video-owner-renderer ytd-channel-name a')
            || document.querySelector('ytd-channel-name#channel-name a')
            || document.querySelector('#owner #channel-name a')
        )?.textContent?.trim();
        if (ch) await chrome.storage.local.set({ transcriptChannel: ch });
    }

    const next = idx + 1;
    if (next >= list.length) {
        await chrome.storage.local.set({ transcriptData: data, transcriptPhase: 'done' });
        chrome.runtime.sendMessage({ action: 'transcriptJobDone' });
        return;
    }
    await chrome.storage.local.set({ transcriptData: data, transcriptIndex: next });
    chrome.runtime.sendMessage({ action: 'navigateTo', url: list[next].videoUrl });
}

async function runScraping(mode, deepdiveOptions, researchConfig) {
    const pageType = getPageType();
    console.log(`[YTResearch] runScraping mode=${mode} page=${pageType}`);

    if (mode === 'transcript') {
        const cfg = (await chrome.storage.local.get(['transcriptConfig'])).transcriptConfig || {};
        await runTranscriptMode(cfg);
        return;
    }

    if (mode === 'download') {
        const cfg = (await chrome.storage.local.get(['downloadConfig'])).downloadConfig || {};
        await runDownloadMode(cfg);
        return;
    }

    if (mode === 'research') {
        const cfg = researchConfig || (await chrome.storage.local.get(['researchConfig'])).researchConfig || {};

        // Mode "urls" — user pasted a list of channel URLs; skip search, scrape each directly
        if (cfg.mode === 'urls') {
            const channels = (cfg.urls || [])
                .map(u => ({ url: normalizeChannelUrl(u) || (u.startsWith('http') ? u.replace(/\/videos\/?$/, '') : null), name: '' }))
                .filter(c => c.url);
            if (channels.length === 0) {
                console.error('[YTResearch] No valid channel URLs');
                chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
                return;
            }
            await chrome.storage.local.set({
                nicheQueue: [''], nicheIndex: 0,
                nicheChannelQueue: channels, nicheChannelIndex: 0,
                nicheResults: [], researchPhase: 'channel-latest',
                estTotalChannels: channels.length, doneChannels: 0, nicheCurrentRow: null
            });
            sendProgress(`Channel 1/${channels.length}`, 'Scraping channels…', 0);
            await sleep(300);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: channels[0].url + '/videos' });
            return;
        }

        // Niche batch — kicks off from any YouTube page by navigating to the first search
        const niches = (cfg.niches || []).filter(Boolean);
        if (niches.length === 0) {
            console.error('[YTResearch] No niches selected');
            chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
            return;
        }
        const estTotalChannels = niches.length * (cfg.channelsPerNiche || 10);
        await chrome.storage.local.set({
            nicheQueue: niches, nicheIndex: 0, nicheChannelQueue: [], nicheChannelIndex: 0,
            nicheResults: [], researchPhase: 'search', estTotalChannels, doneChannels: 0, nicheCurrentRow: null,
            runStartedAt: Date.now()
        });
        sendProgress(`Niche 1/${niches.length}`, `Searching "${niches[0]}"…`, 0);
        await sleep(300);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: buildSearchUrl(niches[0], cfg.suffix, cfg.dateFilter) });
        return;
    }

    if (pageType === 'other') {
        console.error('[YTResearch] Must be on a YouTube channel page');
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }

    {
        await chrome.storage.local.set({ scrapePhase: null, deepdiveChannelInfo: null, deepdiveVideoList: null, deepdiveVideoIndex: 0 });
        await runDeepDive(deepdiveOptions || {});
    }
}

// ===================== GUARD — register listeners once =====================

if (!window.ytResearchLoaded) {
    window.ytResearchLoaded = true;
    window.ytResearchStopRequested = false;
    let isMessageDriven = false;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('[YTResearch] Message:', request.action);

        if (request.action === 'startScraping') {
            isMessageDriven = true;
            window.ytResearchStopRequested = false;
            runScraping(request.mode, request.deepdiveOptions, request.researchConfig);
            sendResponse({ status: 'started' });
        } else if (request.action === 'stopScraping') {
            window.ytResearchStopRequested = true;
            sendResponse({ status: 'stopped' });
        }

        return true;
    });

    // Auto-continue after navigation (same pattern as yt-analytic-scrape)
    chrome.storage.local.get(['isScraping', 'mode', 'scrapePhase', 'researchPhase', 'deepdiveOptions', 'deepdiveChannelInfo', 'deepdiveVideoList', 'deepdiveVideoIndex', 'channelBase', 'transcriptConfig', 'transcriptPhase', 'transcriptList', 'transcriptIndex', 'transcriptData', 'downloadConfig', 'downloadPhase'], (state) => {
        if (isMessageDriven) { console.log('[YTResearch] Message-driven flow active, skipping auto-continue'); return; }
        const pageType = getPageType();
        if (!state.isScraping) return;

        const phase = state.scrapePhase;
        const mode = state.mode;

        console.log(`[YTResearch] Auto-continue: mode=${mode} phase=${phase} researchPhase=${state.researchPhase} page=${pageType}`);

        if (mode === 'download') {
            // Hanya satu fase di sisi YouTube: kumpulkan daftar. Sisanya
            // (buka y2mate, klik, unduh) dikerjakan background.js.
            if (state.downloadPhase === 'list'
                && pageType && pageType.startsWith('channel-videos')) {
                downloadCollectList(state);
            }
            return;
        }

        if (mode === 'transcript') {
            const tp = state.transcriptPhase;
            if (tp === 'list' && pageType
                && (pageType.startsWith('channel-videos') || pageType === 'playlist')) {
                transcriptCollectList(state);
            } else if (tp === 'video' && pageType === 'watch') {
                transcriptScrapeOne(state);
            }
            return;
        }

        if (mode === 'research') {
            const rp = state.researchPhase;
            const isChannelPage = pageType === 'channel-videos-latest'
                || pageType === 'channel-videos-popular'
                || pageType === 'channel-videos-oldest';
            // YouTube SPA strips ?sort=p/?sort=da from URL after navigation,
            // so channel-popular and channel-oldest may land on channel-videos-latest pageType.
            // Trust researchPhase from storage, not URL-derived pageType for those phases.
            const shouldContinue =
                (rp === 'search' && pageType === 'search-results') ||
                (rp === 'channel-latest' && isChannelPage) ||
                (rp === 'channel-popular' && isChannelPage) ||
                (rp === 'channel-oldest' && isChannelPage);

            if (shouldContinue) {
                runNicheResearch();
            } else if (rp && rp.startsWith('channel-') && !isChannelPage) {
                // Landed on an unexpected page (redirect, /user/ home, 'other').
                // Don't hang the whole run — skip this channel and move on.
                console.warn(`[YTResearch] Research stuck on page=${pageType} for phase=${rp}, skipping channel`);
                skipStuckChannel();
            }
            return;
        }

        if (pageType === 'other') return;

        if (mode === 'deepdive') {
            const deepdiveOptions = state.deepdiveOptions || {};
            const shouldContinue =
                (pageType === 'channel-home' && phase === 'channel-home') ||
                (pageType === 'channel-videos-latest' && phase === 'videos') ||
                (pageType === 'watch' && phase === 'video-detail');

            if (shouldContinue) {
                runDeepDive(deepdiveOptions);
            }
        }
    });

    console.log('[YTResearch] Content script loaded. Page type:', getPageType());
}
