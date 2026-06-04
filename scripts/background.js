function openResultsWindow() {
    chrome.windows.create({
        url: chrome.runtime.getURL('results/results.html'),
        type: 'popup',
        width: 860,
        height: 580
    }, (win) => {
        if (win) chrome.storage.local.set({ resultsWindowId: win.id });
    });
}

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
                researchConfig: request.researchConfig || null,
                researchResult: null,
                deepdiveData: [],
                lastProgress: null,
                scrapePhase: null,
                videoFinishTimes: [],
                lastEtaSeconds: null,
                // Research-niche batch state
                researchPhase: null,
                nicheQueue: [],
                nicheIndex: 0,
                nicheChannelQueue: [],
                nicheChannelIndex: 0,
                nicheResults: [],
                nicheCurrentRow: null,
                doneChannels: 0,
                estTotalChannels: 0
            });
            setScrapingState(true, 'Starting...');
            injectToTab(tabId, request);

            // Auto-open live results window for research mode
            if (request.mode === 'research') {
                chrome.storage.local.get(['resultsWindowId'], (s) => {
                    const existingId = s.resultsWindowId;
                    if (existingId) {
                        chrome.windows.get(existingId, (win) => {
                            if (!chrome.runtime.lastError && win) {
                                chrome.windows.update(existingId, { focused: true });
                            } else {
                                openResultsWindow();
                            }
                        });
                    } else {
                        openResultsWindow();
                    }
                });
            }

            sendResponse({ success: true });
        });
        return true;
    }

    else if (request.action === 'stopScraping') {
        chrome.storage.local.get(['scrapingTabId', 'mode', 'nicheResults', 'nicheQueue'], (r) => {
            // Export whatever was collected before stopping
            if (r.mode === 'research') {
                const rows = r.nicheResults || [];
                if (rows.length > 0) {
                    const csv = generateNicheCSV(rows);
                    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                    chrome.downloads.download({ url: dataUrl, filename: `yt-niche-research_partial_${Date.now()}.csv`, saveAs: false });
                    setScrapingState(false, `Stopped. ${rows.length} channels exported.`);
                } else {
                    setScrapingState(false, 'Stopped. (no data yet)');
                }
            } else {
                setScrapingState(false, 'Stopped.');
            }
            if (r.scrapingTabId) {
                injectToTab(r.scrapingTabId, { action: 'stopScraping' });
            }
        });
        sendResponse({ success: true });
    }

    else if (request.action === 'updateProgress') {
        chrome.storage.local.get(['videoFinishTimes', 'lastEtaSeconds'], (r) => {
            let etaSeconds = null;
            if (request.videoCompleted) {
                const times = r.videoFinishTimes || [];
                times.push(Date.now());
                chrome.storage.local.set({ videoFinishTimes: times });
                if (times.length >= 2 && request.videosLeft != null) {
                    const intervals = [];
                    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
                    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                    etaSeconds = Math.round(avgMs * request.videosLeft / 1000);
                    chrome.storage.local.set({ lastEtaSeconds: etaSeconds });
                }
            } else if (r.videoFinishTimes && r.videoFinishTimes.length >= 2 && request.videosLeft != null) {
                const times = r.videoFinishTimes;
                const intervals = [];
                for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
                const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                etaSeconds = Math.round(avgMs * request.videosLeft / 1000);
            } else {
                // Reuse last known ETA so popup doesn't revert to "working…"
                etaSeconds = r.lastEtaSeconds ?? null;
            }

            const progressData = {
                countText: request.countText,
                phase: request.phase,
                pct: request.pct,
                etaSeconds
            };
            chrome.storage.local.set({ lastProgress: progressData });
            chrome.runtime.sendMessage({ action: 'updateProgress', ...progressData }).catch(() => {});
        });
        return true;
    }

    else if (request.action === 'scrapingJobDone') {
        chrome.storage.local.get(['mode', 'researchResult', 'nicheResults', 'nicheQueue', 'deepdiveChannelData', 'deepdiveVideoData', 'deepdiveOptions'], (r) => {
            chrome.storage.local.set({ lastProgress: null });

            if (r.mode === 'research') {
                const rows = r.nicheResults || [];
                const nicheCount = (r.nicheQueue || []).length;
                if (rows.length > 0) {
                    const csv = generateNicheCSV(rows);
                    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                    chrome.downloads.download({ url: dataUrl, filename: `yt-niche-research_${Date.now()}.csv`, saveAs: false });
                    setScrapingState(false, `Done! ${rows.length} channels from ${nicheCount} niche${nicheCount > 1 ? 's' : ''}.`);
                } else {
                    setScrapingState(false, 'Done! (no channels found)');
                }
                // Navigate back to YouTube home
                chrome.storage.local.get(['scrapingTabId'], (t) => {
                    if (t.scrapingTabId) chrome.tabs.update(t.scrapingTabId, { url: 'https://www.youtube.com/' });
                });
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

function parseNumStr(val) {
    if (val == null) return '';
    const s = String(val).trim().toLowerCase().replace(/,/g, '');
    const m = s.match(/^([\d.]+)\s*([kmb])?/);
    if (!m) return '';
    const n = parseFloat(m[1]);
    if (isNaN(n)) return '';
    if (m[2] === 'k') return Math.round(n * 1000);
    if (m[2] === 'm') return Math.round(n * 1000000);
    if (m[2] === 'b') return Math.round(n * 1000000000);
    return Math.round(n);
}

function relativeToDays(dateStr) {
    if (!dateStr) return '';
    const s = String(dateStr).trim().toLowerCase();
    const m = s.match(/(\d+)\s*(s|sec|m(?!o)|min|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)/);
    if (!m) return 0; // "X hours ago" or unrecognised → treat as today
    const n = parseInt(m[1]);
    const u = m[2];
    if (u === 's' || u === 'sec' || u === 'm' || u === 'min' || u === 'h' || u === 'hr' || u === 'hour') return 0;
    if (u === 'd' || u === 'day') return n;
    if (u === 'w' || u === 'wk' || u === 'week') return n * 7;
    if (u === 'mo' || u === 'month') return n * 30;
    if (u === 'y' || u === 'yr' || u === 'year') return n * 365;
    return '';
}

// Niche order mirrors docs/list_niche.md and popup.js NICHE_PRESETS.
// Used to print a stable niche number in the "No." CSV column.
const NICHE_PRESETS = [
    'EDM', 'Reggaeton English', 'Reggaeton Latino', 'HipHop', 'Bachata', 'Jazz', 'Rock', 'Country',
    'Pop Ballad', 'Cubano Jazz', 'Deep House', 'Bollywood Pop Romance', 'Mediterranean Music',
    'Italiano Vintage', 'Amapiano', 'Afro House', 'Afro Soul', 'Afrobeat Tribal', 'Flamenco Rumba',
    'Flamenco Oud Andalusia', 'Cumbia', 'Arabian House', 'Telugu Music', 'Sinhala Music', 'Zulu Music',
    'Ubuntu Music', 'Kizomba', 'Lambada', 'Phonk', 'Trance', 'German Trance', 'Latin Trance', 'Italo Disco',
    'Disco Polo', 'Latino Disco', 'French Chanson', 'Tango', 'Latin Blues', 'Progressive House Night Drive',
    'Turkish Deep House', 'Portuguese Pop Ballad', 'Sertanejo', 'Samba', 'Bossa Nova', 'Mariachi',
    'Jazz Groove', 'Latin Jazz Groove', 'Darbuka', 'Turkish Sufi Rock', 'Shaabi', 'Nuevo Flamenco',
    'Baul', 'Brazilian Funk', 'Vintage Latino'
];

function nicheNumber(label) {
    const idx = NICHE_PRESETS.indexOf(label);
    return idx === -1 ? '' : String(idx + 1);
}

function generateNicheCSV(rows) {
    const headers = ['No.', 'Niche', 'Channel URL', 'Avg Views (5 Latest)', 'Latest Upload Date', 'Most Popular Views', 'Oldest Upload Date', 'Oldest Upload Date (days)'];
    const csvRows = rows.map(v => [
        escape(nicheNumber(v.niche)), escape(v.niche), escape(v.channelUrl),
        escape(parseNumStr(v.avgViews)), escape(v.latestDate),
        escape(parseNumStr(v.popularViews)), escape(v.oldestDate),
        escape(relativeToDays(v.oldestDate))
    ].join(','));
    return [headers.join(','), ...csvRows].join('\n');
}

function generateVideoDataCSV(videoList, opts) {
    const headers = ['Video Title', 'Description', 'Hashtags', 'Views', 'Upload Date', 'Likes', 'Comments', 'How This Was Made', 'Transcript'];

    const rows = videoList.map(v => {
        const cells = [
            escape(v.title), escape(v.description), escape(v.hashtags || ''),
            escape(v.views), escape(v.date), escape(v.likes), escape(v.comments),
            escape(v.howThisWasMade), escape(v.transcript || '')
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
        activeMode: 'deepdive',
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
