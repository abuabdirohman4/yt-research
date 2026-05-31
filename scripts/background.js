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
        chrome.storage.local.get(['mode', 'researchResult', 'deepdiveData', 'deepdiveOptions'], (r) => {
            chrome.storage.local.set({ lastProgress: null });

            if (r.mode === 'research') {
                const result = r.researchResult || request.result;
                chrome.storage.local.set({ researchResult: result });
                setScrapingState(false, 'Done!', { result });
            } else {
                // deepdive — export CSV
                const data = r.deepdiveData || [];
                if (data.length === 0) {
                    setScrapingState(false, 'Done! (no data)');
                    return;
                }
                const opts = r.deepdiveOptions || {};
                const csv = generateDeepDiveCSV(data, opts);
                const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                const filename = `yt-research-deepdive_${Date.now()}.csv`;
                chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Download failed:', chrome.runtime.lastError.message);
                    }
                });
                setScrapingState(false, 'Done! CSV downloaded.');
            }
        });
        sendResponse({ success: true });
        return true;
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

function generateDeepDiveCSV(data, opts) {
    const headers = [];
    if (opts.channelInfo) headers.push(
        'Channel Name', 'Subscribers', 'Total Videos', 'Total Views',
        'Channel URL', 'Country', 'Joined Date', 'Channel Description'
    );
    headers.push('Video Title');
    if (opts.videoMeta) headers.push('Views', 'Upload Date');
    if (opts.videoDescriptions) headers.push('Description');

    const escape = (val) => {
        if (val == null) return '';
        const s = String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };

    const rows = data.map(row => {
        const cells = [];
        if (opts.channelInfo) {
            cells.push(
                escape(row.channelName), escape(row.subscribers), escape(row.totalVideos), escape(row.totalViews),
                escape(row.channelUrl), escape(row.country), escape(row.joinedDate), escape(row.channelDescription)
            );
        }
        cells.push(escape(row.title));
        if (opts.videoMeta) cells.push(escape(row.views), escape(row.date));
        if (opts.videoDescriptions) cells.push(escape(row.description));
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
            videoTitles: true,
            videoMeta: true,
            videoDescriptions: false
        }
    });
});
