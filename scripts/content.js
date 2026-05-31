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

function sendProgress(countText, phase, pct) {
    chrome.runtime.sendMessage({ action: 'updateProgress', countText, phase, pct });
}

// ===================== VIDEO ITEM PARSER =====================

function parseVideoItems(limit) {
    const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
    const results = [];
    for (const item of items) {
        if (limit && results.length >= limit) break;

        const titleEl = item.querySelector('#video-title-link, #video-title, a#video-title, yt-formatted-string#video-title');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (!title) continue;

        const metaSpans = item.querySelectorAll('#metadata-line span.inline-metadata-item');
        const views = metaSpans[0] ? metaSpans[0].textContent.trim() : '';
        const date = metaSpans[1] ? metaSpans[1].textContent.trim() : '';

        const linkEl = item.querySelector('a#video-title-link') || item.querySelector('a#thumbnail') || item.querySelector('a[href*="/watch?v="]');
        const videoUrl = linkEl ? linkEl.href : '';

        results.push({ title, views, date, videoUrl });
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
        channelDescription
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
        channelDescription
    };
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

async function runDeepDive(deepdiveOptions) {
    const pageType = getPageType();
    const state = await chrome.storage.local.get(['scrapePhase', 'channelBase', 'deepdiveChannelInfo', 'deepdiveVideoList', 'deepdiveVideoIndex']);
    const phase = state.scrapePhase;

    console.log(`[YTResearch] runDeepDive page=${pageType} phase=${phase}`);

    if (window.ytResearchStopRequested) {
        chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
        return;
    }

    // Phase: collect channel info from home page
    if (deepdiveOptions.channelInfo && !phase && pageType !== 'channel-home') {
        const channelBase = getChannelBaseUrl();
        await chrome.storage.local.set({ channelBase, scrapePhase: 'channel-home' });
        sendProgress('Step 1', 'Loading channel home…', 5);
        chrome.runtime.sendMessage({ action: 'navigateTo', url: channelBase });
        return;
    }

    if (phase === 'channel-home' || (deepdiveOptions.channelInfo && pageType === 'channel-home' && !phase)) {
        sendProgress('Step 1', 'Scraping channel info…', 10);
        const channelInfo = await scrapeChannelInfo();
        console.log('[YTResearch] Channel info scraped:', JSON.stringify(channelInfo));
        await chrome.storage.local.set({ deepdiveChannelInfo: channelInfo, scrapePhase: 'done' });
        // TEMP: finish here to verify channel info before proceeding to video scraping
        await finishDeepDive(deepdiveOptions, { ...state, deepdiveChannelInfo: channelInfo, deepdiveVideoList: [] });
        return;
    }

    // Phase: scroll and collect all videos
    if (!phase || phase === 'videos' || (pageType === 'channel-videos-latest' && !phase)) {
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

        const videoList = parseVideoItems(0); // all items
        console.log(`[YTResearch] Deep dive collected ${videoList.length} videos`);

        if (!deepdiveOptions.videoDescriptions) {
            // No per-video pages needed — finish directly
            await chrome.storage.local.set({ deepdiveVideoList: videoList, scrapePhase: 'done' });
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: videoList });
            return;
        }

        // Need per-video descriptions
        await chrome.storage.local.set({
            deepdiveVideoList: videoList,
            deepdiveVideoIndex: 0,
            scrapePhase: 'video-description'
        });
        if (videoList.length > 0 && videoList[0].videoUrl) {
            sendProgress('Step 3', `Video 1/${videoList.length}: loading…`, 62);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: videoList[0].videoUrl });
        } else {
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: videoList });
        }
        return;
    }

    // Phase: scrape per-video descriptions
    if (phase === 'video-description' && pageType === 'watch') {
        const videoList = state.deepdiveVideoList || [];
        const idx = state.deepdiveVideoIndex || 0;
        const total = videoList.length;

        sendProgress(`Video ${idx + 1}/${total}`, 'Scraping description…', 62 + Math.round((idx / total) * 35));
        await sleep(2000);

        // Expand description if collapsed
        const expandBtn = document.querySelector('#expand, tp-yt-paper-button#expand, #description-inline-expander #expand');
        if (expandBtn) expandBtn.click();
        await sleep(500);

        const descEl = document.querySelector('#description #content yt-formatted-string')
            || document.querySelector('#description yt-formatted-string')
            || document.querySelector('[slot="content"] yt-formatted-string');
        const description = descEl ? descEl.innerText.trim() : '';

        videoList[idx] = { ...videoList[idx], description };

        const nextIdx = idx + 1;
        if (nextIdx >= total || window.ytResearchStopRequested) {
            await chrome.storage.local.set({ deepdiveVideoList: videoList, scrapePhase: 'done' });
            await finishDeepDive(deepdiveOptions, { ...state, deepdiveVideoList: videoList });
        } else {
            await chrome.storage.local.set({ deepdiveVideoList: videoList, deepdiveVideoIndex: nextIdx });
            sendProgress(`Video ${nextIdx + 1}/${total}`, 'Loading next video…', 62 + Math.round((nextIdx / total) * 35));
            await sleep(1000);
            chrome.runtime.sendMessage({ action: 'navigateTo', url: videoList[nextIdx].videoUrl });
        }
        return;
    }

    console.warn('[YTResearch] Unhandled deepdive state', { phase, pageType });
    chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
}

async function finishDeepDive(deepdiveOptions, state) {
    const videoList = state.deepdiveVideoList || [];
    const channelInfo = state.deepdiveChannelInfo || {};

    let data = videoList.map(v => ({
        channelName: channelInfo.channelName || '',
        subscribers: channelInfo.subscribers || '',
        totalVideos: channelInfo.totalVideos || '',
        channelUrl: channelInfo.channelUrl || '',
        country: channelInfo.country || '',
        joinedDate: channelInfo.joinedDate || '',
        totalViews: channelInfo.totalViews || '',
        channelDescription: channelInfo.channelDescription || '',
        title: v.title || '',
        views: v.views || '',
        date: v.date || '',
        description: v.description || ''
    }));

    // If no videos but have channel info, still export a row with channel data only
    if (data.length === 0 && channelInfo.channelName) {
        data = [{
            channelName: channelInfo.channelName || '',
            subscribers: channelInfo.subscribers || '',
            totalVideos: channelInfo.totalVideos || '',
            totalViews: channelInfo.totalViews || '',
            channelUrl: channelInfo.channelUrl || '',
            country: channelInfo.country || '',
            joinedDate: channelInfo.joinedDate || '',
            channelDescription: channelInfo.channelDescription || '',
            title: '', views: '', date: '', description: ''
        }];
    }

    await chrome.storage.local.set({ deepdiveData: data, scrapePhase: null });
    sendProgress('Done', `Collected ${data.length} videos`, 100);
    chrome.runtime.sendMessage({ action: 'scrapingJobDone' });
}

// ===================== MAIN ENTRY =====================

async function runScraping(mode, deepdiveOptions) {
    if (window.ytResearchScraping) {
        console.warn('[YTResearch] runScraping called while already running, ignoring');
        return;
    }
    window.ytResearchScraping = true;
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
    window.ytResearchScraping = false;
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
                (pageType === 'channel-videos-latest' && (phase === 'videos' || !phase)) ||
                (pageType === 'watch' && phase === 'video-description');

            if (shouldContinue) {
                runDeepDive(deepdiveOptions);
            }
        }
    });

    console.log('[YTResearch] Content script loaded. Page type:', getPageType());
}
