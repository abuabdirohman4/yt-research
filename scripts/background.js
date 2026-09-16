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

const bgSleep = ms => new Promise(r => setTimeout(r, ms));

const Y2_LOG_CAP = 300;

/**
 * Catat ke storage, bukan cuma console — service worker MV3 mati sendiri dan
 * log console ikut hilang. Ini yang membuat kegagalan bisa ditelusuri setelah
 * kejadian, tanpa harus menonton DevTools saat proses berjalan.
 */
// Chrome mengabaikan `filename` pada chrome.downloads.download() ketika url-nya
// skema data: — file mendarat sebagai "download.txt". Listener ini yang
// benar-benar menentukan namanya.
// Antrian nama yang menunggu. onDeterminingFilename bisa menyala SEBELUM
// callback download() mengembalikan id, jadi pencocokan lewat id tidak aman —
// pakai antrian FIFO, dan unduhan kita selalu satu per satu.
const antrianNama = [];

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (!antrianNama.length) return false;   // bukan unduhan kita
    suggest({ filename: antrianNama.shift(), conflictAction: 'uniquify' });
    return true;
});

/** Unduh teks/CSV dengan nama yang dijamin terpakai. */
function unduhTeks(dataUrl, filename) {
    antrianNama.push(filename);
    chrome.downloads.download({ url: dataUrl, saveAs: false }, (id) => {
        if (chrome.runtime.lastError || id === undefined) {
            const i = antrianNama.indexOf(filename);
            if (i >= 0) antrianNama.splice(i, 1);
            ytLog(`  GAGAL simpan: ${chrome.runtime.lastError?.message || 'tanpa id'}`);
        } else {
            ytLog(`  tersimpan sebagai ${filename} (id ${id})`);
        }
    });
}

let ytLogChain = Promise.resolve();

function ytLog(msg) {
    const time = new Date().toTimeString().slice(0, 8);
    const line = `${time}  ${msg}`;
    console.log('[YTR]', msg);
    // Dirantai: baca-ubah-tulis storage tanpa antrian saling menimpa kalau dua
    // log datang berdekatan, dan baris hilang diam-diam.
    ytLogChain = ytLogChain.then(async () => {
        const { y2RunLog = [] } = await chrome.storage.local.get('y2RunLog');
        y2RunLog.push(line);
        if (y2RunLog.length > Y2_LOG_CAP) y2RunLog.splice(0, y2RunLog.length - Y2_LOG_CAP);
        await chrome.storage.local.set({ y2RunLog });
    }).catch(() => { /* storage tak tersedia: log bukan alasan alur berhenti */ });
    return ytLogChain;
}

// Nama lama, dipakai alur y2mate. Sekarang log dipakai SEMUA mode.
const y2log = ytLog;

function sendProgressBg(phase, detail, percent) {
    const data = { phase, detail, percent };
    chrome.storage.local.set({ lastProgress: data });
    chrome.runtime.sendMessage({ action: 'updateProgress', ...data }).catch(() => {});
}

/** Kirim pesan ke satu tab, kembalikan balasan (atau null kalau gagal). */
function askTab(tabId, msg, frameId) {
    return new Promise(resolve => {
        const opts = frameId === undefined ? {} : { frameId };
        chrome.tabs.sendMessage(tabId, msg, opts, (resp) => {
            if (chrome.runtime.lastError) return resolve(null);
            resolve(resp);
        });
    });
}

/** Cari frameId milik iframe widget y2mate di tab ini. */
async function y2FindFrame(tabId) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
    if (!frames) return null;
    const f = frames.find(fr => /frame\.y2meta-uk\.com/.test(fr.url || ''));
    return f ? f.frameId : null;
}

/** Proses satu video sampai tombol Download diklik. */
async function y2OneVideo(tabId, videoUrl, cfg) {
    // 1. buka halaman y2mate
    await y2log(`  buka y2mate untuk ${videoUrl.slice(-11)}`);
    await chrome.tabs.update(tabId, { url: 'https://www.y2mate.in.net/convert/' });
    await bgSleep(3000);

    // 2. tempel URL + klik Start (di dokumen utama, bukan iframe)
    let submitted = null;
    for (let i = 0; i < 5 && !(submitted && submitted.ok); i++) {
        submitted = await askTab(tabId, { action: 'y2submit', videoUrl }, 0);
        if (!submitted) await bgSleep(1500);
    }
    if (!submitted || !submitted.ok) {
        await y2log('  GAGAL: URL tak bisa ditempel / Start tak merespons');
        return { ok: false, step: 'submit' };
    }
    await y2log('  URL ditempel, Start diklik');

    // 3. tunggu iframe widget muncul (halaman bernavigasi setelah Start)
    let frameId = null;
    for (let i = 0; i < 25 && frameId === null; i++) {
        await bgSleep(800);
        frameId = await y2FindFrame(tabId);
    }
    if (frameId === null) {
        await y2log('  GAGAL: iframe konversi tak muncul (y2mate bermasalah?)');
        return { ok: false, step: 'frame' };
    }
    await y2log(`  iframe siap (frameId ${frameId})`);

    // 4. di dalam iframe: pilih jenis + kualitas, lalu klik Download.
    // askTab bisa mengembalikan null kalau iframe belum siap menerima pesan —
    // dulu itu langsung dianggap selesai, sehingga loop melompat ke video
    // berikutnya dalam hitungan detik. Sekarang dicoba ulang beberapa kali.
    let res = null;
    for (let i = 0; i < 4 && !res; i++) {
        await bgSleep(1500);
        res = await askTab(tabId, {
            action: 'y2download',
            kind: cfg.kind || 'video',
            quality: cfg.quality || '720p'
        }, frameId);
    }
    if (!res) {
        await y2log('  GAGAL: iframe tak menjawab setelah 4 percobaan');
        return { ok: false, step: 'iframe-nomsg' };
    }
    if (!res.ok) {
        await y2log(`  GAGAL di langkah "${res.step}"${res.picked ? ` (pilih: ${res.picked})` : ''}`);
        return res;
    }
    await y2log(`  tombol Download diklik${res.picked ? ` — ${res.picked}` : ''}`);

    // 5. Klik saja tidak membuktikan apa pun — tunggu unduhan benar-benar
    // TERDAFTAR di Chrome. Tanpa ini, video yang gagal terlihat sukses.
    const started = await y2WaitDownloadStart(30000);
    await y2log(started
        ? '  unduhan MULAI (terdaftar di Chrome)'
        : '  GAGAL: tak ada unduhan terdaftar dalam 30 detik');
    return { ...res, ok: started, step: started ? 'done' : 'no-download' };
}

/**
 * Tunggu sampai ada unduhan baru terdaftar di Chrome (bukan sekadar tombol
 * diklik). Mengembalikan true kalau unduhan muncul dalam batas waktu.
 */
function y2WaitDownloadStart(timeoutMs) {
    return new Promise(resolve => {
        let selesai = false;
        const beres = (v) => {
            if (selesai) return;
            selesai = true;
            chrome.downloads.onCreated.removeListener(onNew);
            clearTimeout(timer);
            resolve(v);
        };
        const onNew = () => beres(true);
        const timer = setTimeout(() => beres(false), timeoutMs);
        chrome.downloads.onCreated.addListener(onNew);
    });
}

/**
 * Tunggu unduhan MAPAN, bukan selesai.
 *
 * Menunggu file 300 MB tuntas sebelum video berikutnya membuang waktu percuma —
 * Chrome sanggup menyelesaikannya sendiri di latar belakang. Yang berbahaya
 * hanya berpindah halaman SEBELUM unduhan benar-benar mengalir, karena
 * unduhan yang dipicu lewat navigasi bisa ikut batal.
 *
 * Mapan = byte yang diterima sudah bertambah antar pemeriksaan, atau
 * unduhannya memang sudah selesai.
 */
async function y2WaitDownloadsSettled(timeoutMs = 25000) {
    const until = Date.now() + timeoutMs;
    let sebelumnya = -1;
    while (Date.now() < until) {
        const aktif = await chrome.downloads.search({ state: 'in_progress' });
        if (!aktif.length) return true;                 // sudah selesai/tak ada
        const byte = aktif.reduce((n, d) => n + (d.bytesReceived || 0), 0);
        if (byte > 0 && byte === sebelumnya) return true;  // sempat diam = sudah mengalir
        if (byte > 1024 * 1024) return true;               // >1 MB masuk = aman ditinggal
        sebelumnya = byte;
        await bgSleep(1500);
    }
    return false;
}

/** Tunggu semua unduhan benar-benar tuntas (dipakai di akhir daftar saja). */
async function y2WaitDownloadsIdle(timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        const aktif = await chrome.downloads.search({ state: 'in_progress' });
        if (!aktif.length) return true;
        await bgSleep(2000);
    }
    return false;
}

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
        chrome.storage.local.set({ y2RunLog: [] });
        ytLog(`=== MULAI mode "${request.mode}" ===`);
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
                transcriptConfig: request.transcriptConfig || null,
                downloadConfig: request.downloadConfig || null,
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
                    ytLog(`Niche DIHENTIKAN: ${rows.length} channel tersimpan`);
                    unduhTeks(dataUrl, `yt-niche-research_partial_${Date.now()}.csv`);
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

    else if (request.action === 'ytlog') {
        ytLog(request.msg);
        return false;
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

    // ===== MODE DOWNLOAD (y2mate) =====
    // Satu video = satu siklus: buka y2mate -> tempel URL -> tunggu iframe ->
    // pilih jenis+kualitas -> klik Download. Diorkestrasi di sini karena
    // butuh berpindah halaman, yang menghapus state content script.
    else if (request.action === 'y2log') {
        y2log(request.msg);
        return false;
    }

    else if (request.action === 'y2RunList') {
        chrome.storage.local.get(['scrapingTabId'], async (r) => {
            const tabId = r.scrapingTabId;
            const list = request.list || [];
            const cfg = request.config || {};
            let ok = 0, gagal = 0;

            await chrome.storage.local.set({ y2RunLog: [] });   // mulai bersih
            await y2log(`=== Mulai: ${list.length} video, ${cfg.kind || 'video'} ${cfg.quality || '720p'} ===`);

            for (let i = 0; i < list.length; i++) {
                const v = list[i];
                const label = (v.title || v.videoUrl || '').slice(0, 44);
                await y2log(`[${i + 1}/${list.length}] ${label}`);
                sendProgressBg(`Video ${i + 1}/${list.length}`, label,
                    Math.round((i / list.length) * 100));

                const res = await y2OneVideo(tabId, v.videoUrl, cfg).catch(e => ({
                    ok: false, step: 'exception', error: String(e).slice(0, 80)
                }));
                if (res && res.ok) { ok++; await y2log(`  OK`); }
                else { gagal++; await y2log(`  -> dilewati (${res?.step || 'tak diketahui'})`); }
                // Unduhan sebelumnya masih menulis ke disk; berpindah halaman
                // saat itu bisa membatalkannya. Tunggu sampai reda dulu.
                if (i < list.length - 1) {
                    // Cukup pastikan unduhan sudah mengalir; sisanya diurus
                    // Chrome di latar belakang sementara kita lanjut.
                    await y2WaitDownloadsSettled(25000);
                    await bgSleep(cfg.delay || 3000);
                }
            }

            // Jangan tahan status sampai semua file tuntas — beri tahu saja
            // kalau masih ada yang berjalan di latar belakang.
            await y2WaitDownloadsSettled(20000);
            const sisa = await chrome.downloads.search({ state: 'in_progress' });
            const catatan = sisa.length ? ` (${sisa.length} masih mengunduh)` : '';
            await y2log(`=== Selesai: ${ok} berhasil, ${gagal} gagal${catatan} ===`);
            setScrapingState(false, `Selesai — ${ok} terunduh, ${gagal} gagal.${catatan}`);
            chrome.storage.local.set({ lastProgress: null });
            if (tabId) chrome.tabs.update(tabId, { url: 'https://www.youtube.com/' });
        });
        return true;
    }

    else if (request.action === 'transcriptJobDone') {
        chrome.storage.local.get(['transcriptData', 'transcriptConfig', 'transcriptChannel'], (r) => {
            chrome.storage.local.set({ lastProgress: null });
            ytLog(`=== Transcript selesai: ${(r.transcriptData || []).length} video ===`);
            ytLog(`  channel/playlist: ${r.transcriptChannel || '(kosong)'}`);
            const data = r.transcriptData || [];
            const ok = data.filter(d => d.transcript && !d.transcript.startsWith('[TIDAK ADA')).length;

            if (data.length > 0) {
                const txt = generateTranscriptTxt(data, r.transcriptConfig || {});
                const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(txt);

                // SATU video -> pakai judul videonya; nama channel tidak cukup
                // membedakan kalau beberapa video diambil satu per satu.
                // BANYAK video -> pakai nama channel + cakupan.
                const cfg = r.transcriptConfig || {};
                let filename;
                if (data.length === 1) {
                    filename = `${snakeName(data[0].title, 'transcript')}.txt`;
                } else {
                    const ch = snakeName(r.transcriptChannel, 'channel');
                    const scope = cfg.source === 'ids'
                        ? `${data.length}_video`
                        : `${data.length}_${cfg.sort || 'latest'}`;
                    filename = `transcripts_${scope}_${ch}.txt`;
                }

                ytLog(`nama file: ${filename}`);
                ytLog(`  ${data.length} video · judul[0]: ${(data[0] && data[0].title) || '(kosong)'}`);
                unduhTeks(dataUrl, filename);
                setScrapingState(false, `Done! ${ok}/${data.length} transcript.`);
            } else {
                setScrapingState(false, 'Done! (tidak ada transcript)');
            }
            chrome.storage.local.get(['scrapingTabId'], (t) => {
                if (t.scrapingTabId) chrome.tabs.update(t.scrapingTabId, { url: 'https://www.youtube.com/' });
            });
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
                    ytLog(`Niche selesai: ${rows.length} channel dari ${nicheCount} niche`);
                    unduhTeks(dataUrl, `yt-niche-research_${Date.now()}.csv`);
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
                ytLog(`Deep Dive: profil channel -> yt-channel-info_${ts}.csv`);
                unduhTeks(dataUrl, `yt-channel-info_${ts}.csv`);
                downloadCount++;
            }

            if (opts.videoData && r.deepdiveVideoData && r.deepdiveVideoData.length > 0) {
                const csv = generateVideoDataCSV(r.deepdiveVideoData, opts);
                const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                ytLog(`Deep Dive: ${(r.deepdiveVideoData || []).length} video -> yt-video-data_${ts}.csv`);
                unduhTeks(dataUrl, `yt-video-data_${ts}.csv`);
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

// Format sama dengan yt-transcript (yt-toolkit) supaya file hasilnya bisa
// langsung dipakai yt-slides tanpa konversi.
/**
 * Judul/nama -> snake_case lowercase, sesuai aturan vault second-brain §2.
 * Semua tanda baca (strip, titik dua, tanda tanya, kurung) DIBUANG — pemisah
 * kata cukup underscore.
 */
function snakeName(text, fallback = 'transcript', limit = 80) {
    const s = (text || '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')     // buang tanda baca
        .trim()
        .replace(/[\s-]+/g, '_')       // spasi & strip -> underscore
        .replace(/_+/g, '_')            // rapatkan underscore beruntun
        .replace(/^_|_$/g, '');
    return s.slice(0, limit).replace(/_$/, '') || fallback;
}

function generateTranscriptTxt(data, cfg) {
    const bar = '='.repeat(52);
    const dash = '-'.repeat(52);
    const sortLabel = { popular: 'POPULAR', latest: 'LATEST', oldest: 'OLDEST' }[cfg.sort] || 'LATEST';
    const parts = [
        `${bar}\nCHANNEL TRANSCRIPTS (${sortLabel})\n` +
        `Total Videos: ${data.length} | Export Date: ${new Date().toLocaleDateString()}\n${bar}\n`
    ];
    data.forEach((d, i) => {
        parts.push(`\n${dash}\nVIDEO ${i + 1}: ${d.title}\nURL: ${d.videoUrl}\n${dash}\n\n${d.transcript}\n`);
    });
    return parts.join('\n');
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
    const headers = ['No.', 'Niche', 'Channel URL', 'Subscribers', 'Avg Views (5 Latest)', 'Latest Upload Date', 'Most Popular Views', 'Oldest Upload Date', 'Oldest Upload Date (days)'];
    const csvRows = rows.map(v => [
        escape(nicheNumber(v.niche)), escape(v.niche), escape(v.channelUrl),
        escape(v.subscribers || ''), escape(parseNumStr(v.avgViews)), escape(v.latestDate),
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
