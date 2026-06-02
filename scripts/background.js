const setScrapingState = async (isScraping, status, extra) => {
    await chrome.storage.local.set({ isScraping, status });
    try {
        await chrome.runtime.sendMessage({ action: 'updateStatus', isScraping, status, ...extra });
    } catch (e) {
        if (!e.message?.includes('Receiving end does not exist')) throw e;
    }
};

function injectToTab(tabId, command) {
    // Try sending to existing content script first
    chrome.tabs.sendMessage(tabId, command, (response) => {
        if (!chrome.runtime.lastError) return; // success
        // Content script not ready — inject then send
        console.log('[Background] Content script not found, injecting...');
        chrome.scripting.executeScript({
            target: { tabId },
            files: ['scripts/content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.error(`[Background] Injection failed: ${chrome.runtime.lastError.message}`);
                setScrapingState(false, 'Injection failed.');
                return;
            }
            chrome.tabs.sendMessage(tabId, command);
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'startScraping') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) {
                setScrapingState(false, 'No active tab found.');
                sendResponse({ success: false });
                return;
            }
            chrome.storage.local.set({
                isScraping: true,
                scrapingTabId: tabId,
                mode: request.mode,
                deepdiveOptions: request.deepdiveOptions || {},
                videoFilter: request.videoFilter || { mode: 'all' },
                researchResult: null,
                deepdiveData: [],
                lastProgress: null,
                scrapePhase: null
            });
            setScrapingState(true, 'Starting...');
            injectToTab(tabId, request);
            sendResponse({ success: true });
        });
        return true;
    }

    else if (request.action === 'stopScraping') {
        chrome.storage.local.get(['scrapingTabId'], (r) => {
            setScrapingState(false, 'Stopped.');
            if (r.scrapingTabId) {
                injectToTab(r.scrapingTabId, { action: 'stopScraping' });
            }
        });
        sendResponse({ success: true });
    }

    else if (request.action === 'updateProgress') {
        const progressData = {
            countText: request.countText,
            phase: request.phase,
            pct: request.pct
        };
        chrome.storage.local.set({ lastProgress: progressData });
        chrome.runtime.sendMessage({ action: 'updateProgress', ...progressData }).catch(() => {});
    }

    else if (request.action === 'scrapingJobDone') {
        chrome.storage.local.get(['mode', 'researchResult', 'deepdiveChannelData', 'deepdiveVideoData', 'deepdiveOptions'], (r) => {
            chrome.storage.local.set({ lastProgress: null });

            if (r.mode === 'research') {
                const result = r.researchResult || request.result;
                chrome.storage.local.set({ researchResult: result });
                setScrapingState(false, 'Done!', { result });
                return;
            }

            // deepdive — export 1 or 2 CSVs
            const opts = r.deepdiveOptions || {};
            const ts = Date.now();
            let downloadCount = 0;

            if (opts.channelInfo && r.deepdiveChannelData && r.deepdiveChannelData.channelName) {
                const csv = generateChannelInfoCSV(r.deepdiveChannelData);
                const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                chrome.downloads.download({ url: dataUrl, filename: `yt-channel-info_${ts}.csv`, saveAs: false });
                downloadCount++;
            }

            if (opts.videoData && r.deepdiveVideoData && r.deepdiveVideoData.length > 0) {
                const csv = generateVideoDataCSV(r.deepdiveVideoData, opts);
                const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                chrome.downloads.download({ url: dataUrl, filename: `yt-video-data_${ts}.csv`, saveAs: false });
                downloadCount++;
            }

            setScrapingState(false, downloadCount > 0 ? `Done! ${downloadCount} CSV downloaded.` : 'Done! (no data)');
        });
        sendResponse({ success: true });
        return true;
    }

    else if (request.action === 'downloadThumbnail') {
        chrome.downloads.download({ url: request.url, filename: request.filename, saveAs: false });
    }

    else if (request.action === 'navigateTo') {
        chrome.storage.local.get(['scrapingTabId'], (r) => {
            if (r.scrapingTabId) {
                chrome.tabs.update(r.scrapingTabId, { url: request.url });
            }
        });
        sendResponse({ success: true });
    }

    return true;
});

function escape(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function generateChannelInfoCSV(info) {
    const headers = ['Channel Name', 'Subscribers', 'Total Videos', 'Total Views', 'Channel URL', 'Country', 'Joined Date', 'Channel Description'];
    const row = [
        escape(info.channelName), escape(info.subscribers), escape(info.totalVideos), escape(info.totalViews),
        escape(info.channelUrl), escape(info.country), escape(info.joinedDate), escape(info.channelDescription)
    ].join(',');
    return [headers.join(','), row].join('\n');
}

function generateVideoDataCSV(videoList, opts) {
    const headers = ['Video Title', 'Description', 'Hashtags', 'Views', 'Upload Date', 'Likes', 'Comments', 'How This Was Made'];

    const rows = videoList.map(v => {
        const cells = [
            escape(v.title), escape(v.description), escape(v.hashtags || ''),
            escape(v.views), escape(v.date), escape(v.likes), escape(v.comments), escape(v.howThisWasMade)
        ];
        return cells.join(',');
    });

    return [headers.join(','), ...rows].join('\n');
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        isScraping: false,
        status: 'Ready',
        mode: 'research',
        activeMode: 'research',
        researchResult: null,
        deepdiveData: [],
        lastProgress: null,
        deepdiveOptions: {
            channelInfo: true,
            channelImages: true,
            videoData: true,
            thumbnails: true,
            videoDescriptions: true
        }
    });
});
