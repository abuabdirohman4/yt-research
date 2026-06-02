// ===================== HELPERS =====================

function getPageType() {
    const url = window.location.href;
    const urlObj = new URL(url);
    const sort = urlObj.searchParams.get('sort');

    const isChannelVideos = /youtube\.com\/@[^/?#]+\/videos/.test(url)
        || /youtube\.com\/channel\/[^/?#]+\/videos/.test(url);

    const isChannelHome = /youtube\.com\/@[^/?#]+\/?(?:[?#]|$)/.test(url)
        || /youtube\.com\/channel\/[^/?#]+\/?(?:[?#]|$)/.test(url);

    const isWatch = /youtube\.com\/watch/.test(url);

    if (isChannelVideos) {
        if (sort === 'p') return 'channel-videos-popular';
        if (sort === 'da') return 'channel-videos-oldest';
        return 'channel-videos-latest';
    }
    if (isChannelHome) return 'channel-home';
    if (isWatch) return 'watch';
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
    const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
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

        if (newTitleEl) {
            title = (newTitleEl.getAttribute('title') || newLinkEl?.textContent || '').trim();
            views = newMetaSpans[0] ? newMetaSpans[0].textContent.trim() : '';
            date = newMetaSpans[1] ? newMetaSpans[1].textContent.trim() : '';
            videoUrl = newLinkEl ? new URL(newLinkEl.getAttribute('href'), 'https://www.youtube.com').href : '';
        } else {
            title = (legacyTitleLinkEl?.title || legacyTitleEl?.textContent || '').trim();
            views = legacyMetaSpans[0] ? legacyMetaSpans[0].textContent.trim() : '';
            date = legacyMetaSpans[1] ? legacyMetaSpans[1].textContent.trim() : '';
            const linkEl = legacyTitleLinkEl || item.querySelector('a#thumbnail') || item.querySelector('a[href*="/watch?v="]');
            videoUrl = linkEl ? linkEl.href : '';
        }

        if (!title) continue;
        const videoId = videoUrl ? new URL(videoUrl).searchParams.get('v') : '';
        const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
        results.push({ title, views, date, videoUrl, thumbnailUrl });
    }
    console.log(`[YTResearch] parseVideoItems: ${items.length} items found, ${results.length} with titles`);
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
    const btn = document.querySelector('button[aria-label="Show transcript"]');
    if (!btn) return '';
    btn.click();
    try {
        await waitForElement('yt-section-list-renderer[data-target-id="PAmodern_transcript_view"]', 8000);
    } catch (e) {
        return '';
    }
    await sleep(1000);
    const segments = document.querySelectorAll(
        'yt-section-list-renderer[data-target-id="PAmodern_transcript_view"] transcript-segment-view-model'
    );
    if (!segments.length) return '';
    const parts = [];
    for (const seg of segments) {
        const ts = seg.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.textContent?.trim() || '';
        const text = seg.querySelector('span[role="text"]')?.textContent?.trim() || '';
        if (ts && text) parts.push(`[${ts}] ${text}`);
        else if (text) parts.push(text);
    }
    return parts.join(' ');
}

// ===================== CHANNEL RESEARCH SCRAPER =====================

async function runChannelResearch() {
    const pageType = getPageType();
    const phase = await chrome.storage.local.get(['scrapePhase']).then(r => r.scrapePhase);

    console.log(`[YTResearch] runChannelResearch page=${pageType} phase=${phase}`);

    if (pageType === 'channel-videos-latest' && !phase) {
        // Phase 1: scrape 5 latest
        sendProgress('Phase 1/3', 'Scraping 5 latest videos…', 10);
        try {
            await waitForElement('ytd-rich-item-renderer, ytd-grid-video-renderer', 12000);
        } catch (e) {
            console.error('[YTResearch] No video items found on latest page');
            chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
            return;
        }
        await sleep(1500);

        const latest = parseVideoItems(5);
        console.log('[YTResearch] Latest:', latest);

        const channelBase = getChannelBaseUrl();
        await chrome.storage.local.set({
            scrapePhase: 'popular',
            researchLatest: latest,
            channelBase
        });

        sendProgress('Phase 2/3', 'Navigating to popular sort…', 33);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: channelBase + '/videos?view=0&sort=p' });
        return;
    }

    if (pageType === 'channel-videos-popular' || phase === 'popular') {
        // Phase 2: scrape most popular
        sendProgress('Phase 2/3', 'Scraping most popular video…', 45);
        try {
            await waitForElement('ytd-rich-item-renderer, ytd-grid-video-renderer', 12000);
        } catch (e) {
            console.warn('[YTResearch] No video items on popular page');
        }
        await sleep(1500);

        const popularItems = parseVideoItems(1);
        const popular = popularItems[0] || null;
        console.log('[YTResearch] Popular:', popular);

        const { channelBase } = await chrome.storage.local.get(['channelBase']);
        await chrome.storage.local.set({ scrapePhase: 'oldest', researchPopular: popular });

        sendProgress('Phase 3/3', 'Navigating to oldest sort…', 66);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: channelBase + '/videos?view=0&sort=da' });
        return;
    }

    if (pageType === 'channel-videos-oldest' || phase === 'oldest') {
        // Phase 3: scrape oldest
        sendProgress('Phase 3/3', 'Scraping oldest video…', 80);
        try {
            await waitForElement('ytd-rich-item-renderer, ytd-grid-video-renderer', 12000);
        } catch (e) {
            console.warn('[YTResearch] No video items on oldest page');
        }
        await sleep(1500);

        const oldestItems = parseVideoItems(1);
        const oldest = oldestItems[0] || null;
        console.log('[YTResearch] Oldest:', oldest);

        const { researchLatest, researchPopular, channelBase } = await chrome.storage.local.get([
            'researchLatest', 'researchPopular', 'channelBase'
        ]);

        const result = {
            channelUrl: channelBase,
            latest: researchLatest || [],
            popular: researchPopular || null,
            oldest: oldest
        };

        await chrome.storage.local.set({ researchResult: result, scrapePhase: null });
        sendProgress('Done', 'Research complete', 100);
        chrome.runtime.sendMessage({ action: 'scrapingJobDone', result });
        return;
    }

    console.error('[YTResearch] Unexpected page type for research:', pageType);
    chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
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

        // Infinite scroll: scroll until no new items
        let prevCount = 0;
        let scrollAttempts = 0;
        const MAX_SCROLL = 100;
        while (scrollAttempts < MAX_SCROLL) {
            if (window.ytResearchStopRequested) break;
            const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
            if (items.length === prevCount && scrollAttempts > 0) break;
            prevCount = items.length;
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

async function runScraping(mode, deepdiveOptions) {
    const pageType = getPageType();
    console.log(`[YTResearch] runScraping mode=${mode} page=${pageType}`);

    if (pageType === 'other') {
        console.error('[YTResearch] Must be on a YouTube channel page');
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }

    if (mode === 'research') {
        await chrome.storage.local.set({ scrapePhase: null, researchLatest: null, researchPopular: null });
        await runChannelResearch();
    } else {
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
            runScraping(request.mode, request.deepdiveOptions);
            sendResponse({ status: 'started' });
        } else if (request.action === 'stopScraping') {
            window.ytResearchStopRequested = true;
            sendResponse({ status: 'stopped' });
        }

        return true;
    });

    // Auto-continue after navigation (same pattern as yt-analytic-scrape)
    chrome.storage.local.get(['isScraping', 'mode', 'scrapePhase', 'deepdiveOptions', 'deepdiveChannelInfo', 'deepdiveVideoList', 'deepdiveVideoIndex', 'channelBase', 'researchLatest', 'researchPopular'], (state) => {
        if (isMessageDriven) { console.log('[YTResearch] Message-driven flow active, skipping auto-continue'); return; }
        const pageType = getPageType();
        if (!state.isScraping) return;
        if (pageType === 'other') return;

        const phase = state.scrapePhase;
        const mode = state.mode;

        console.log(`[YTResearch] Auto-continue: mode=${mode} phase=${phase} page=${pageType}`);

        if (mode === 'research') {
            const shouldContinue =
                (pageType === 'channel-videos-popular' && phase === 'popular') ||
                (pageType === 'channel-videos-oldest' && phase === 'oldest') ||
                (pageType === 'channel-videos-latest' && !phase);

            if (shouldContinue) {
                runChannelResearch();
            }
        } else if (mode === 'deepdive') {
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
