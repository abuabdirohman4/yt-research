// y2mate.js — dijalankan di halaman y2mate.in.net DAN di iframe frame.y2meta-uk.com
// (manifest: all_frames: true).
//
// Temuan yang membentuk file ini (diuji langsung di browser, 11 Sep 2026):
//   1. Input URL TIDAK bisa diisi lewat `input.value = ...` — form terkirim
//      kosong dan halaman balik bersih. Yang bekerja: execCommand('insertText').
//   2. Tombol menerima element.click() biasa. Tidak perlu chrome.debugger
//      (beda dari kasus gemini-batch-image).
//   3. Tabel resolusi ada di IFRAME lintas-domain. Dokumen utama benar-benar
//      kosong: 0 tabel, 0 tombol, teks "720p" tak terbaca. Karena itu script
//      ini harus jalan di kedua frame.
//   4. Akses langsung ke frame.y2meta-uk.com/test.php?videoId=... -> 403
//      Forbidden (cek Referer). Jalur pintas tertutup, harus lewat halaman utama.
//   5. Tidak perlu menunggu 10-15 detik seperti tulisan di pop-up; begitu
//      tombol Download bisa diklik, langsung bisa.

const Y2 = {
    MAIN: /y2mate\.in\.net/,
    FRAME: /frame\.y2meta-uk\.com/,
};

const y2sleep = ms => new Promise(r => setTimeout(r, ms));

/** Tunggu sampai fn() mengembalikan nilai truthy, atau menyerah. */
async function y2waitFor(fn, timeoutMs = 20000, stepMs = 400) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        try {
            const v = fn();
            if (v) return v;
        } catch (e) { /* DOM belum siap */ }
        await y2sleep(stepMs);
    }
    return null;
}

/** Isi input teks dengan cara yang diterima situs ini. */
function y2fillInput(el, text) {
    el.focus();
    el.select?.();
    // execCommand menghasilkan event input tepercaya di mata halaman;
    // menugaskan .value langsung diabaikan (terbukti gagal 4x saat uji).
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
        // cadangan: setter native + event manual
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return el.value === text;
}

// ===================== HALAMAN UTAMA =====================

/** Tempel URL video lalu tekan Start. */
async function y2submitUrl(videoUrl) {
    const input = await y2waitFor(() => document.getElementById('inputUrl'), 15000);
    const start = document.getElementById('btn-submit');
    if (!input || !start) return false;
    if (!y2fillInput(input, videoUrl)) return false;
    start.click();
    return true;
}

// ===================== DI DALAM IFRAME =====================

/** Klik tab "Video" atau "Audio". */
async function y2pickKind(kind) {
    const want = kind === 'audio' ? 'audio' : 'video';
    const tab = await y2waitFor(() =>
        [...document.querySelectorAll('a,button,li,div,span')]
            .find(e => e.textContent.trim().toLowerCase() === want
                && e.offsetParent !== null), 20000);
    if (!tab) return false;
    tab.click();
    await y2sleep(1200);
    return true;
}

/**
 * Klik baris kualitas yang diminta. Kalau tidak ada, ambil yang terdekat
 * di bawahnya — lebih baik dapat 480p daripada gagal total.
 */
async function y2pickQuality(quality) {
    const rows = await y2waitFor(() => {
        const r = [...document.querySelectorAll('table tr')]
            .filter(tr => tr.querySelector('a,button'));
        return r.length ? r : null;
    }, 20000);
    if (!rows) return null;

    const num = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : null; };
    const want = num(quality);

    let pick = rows.find(tr => tr.innerText.toLowerCase().includes(
        String(quality).toLowerCase()));

    if (!pick && want) {
        // urutkan menurun, ambil yang <= diminta
        const scored = rows
            .map(tr => ({ tr, n: num(tr.innerText) }))
            .filter(x => x.n)
            .sort((a, b) => b.n - a.n);
        pick = (scored.find(x => x.n <= want) || scored[scored.length - 1])?.tr;
    }
    if (!pick) return null;

    const btn = pick.querySelector('a,button');
    if (!btn) return null;
    btn.click();
    return pick.innerText.replace(/\s+/g, ' ').trim().slice(0, 30);
}

/**
 * Klik tombol Download di pop-up. Pop-up muncul dalam keadaan memuat
 * (placeholder abu-abu) lalu terisi; kita tunggu tombol yang benar-benar
 * bisa diklik, bukan jeda tetap.
 */
async function y2clickDownload() {
    const btn = await y2waitFor(() => {
        const cands = [...document.querySelectorAll('a,button')]
            .filter(e => /^\s*download\s*$/i.test(e.textContent || '')
                && e.offsetParent !== null);
        // abaikan tautan navigasi footer ("YouTube Downloader" dll)
        return cands.find(e => !/youtube|converter|mp3/i.test(e.textContent || ''))
            || null;
    }, 30000);
    if (!btn) return false;
    btn.click();
    return true;
}

// ===================== ROUTER PESAN =====================

if (!window.__y2mateLoaded) {
    window.__y2mateLoaded = true;

    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
        const inFrame = Y2.FRAME.test(location.href);

        if (req.action === 'y2submit' && !inFrame) {
            y2submitUrl(req.videoUrl).then(ok => sendResponse({ ok }));
            return true;
        }

        // Langkah di bawah ini HANYA ada di dalam iframe.
        if (req.action === 'y2download' && inFrame) {
            (async () => {
                const kindOk = await y2pickKind(req.kind || 'video');
                if (!kindOk) return sendResponse({ ok: false, step: 'kind' });

                const picked = await y2pickQuality(req.quality || '720p');
                if (!picked) return sendResponse({ ok: false, step: 'quality' });

                const dlOk = await y2clickDownload();
                sendResponse({ ok: dlOk, step: dlOk ? 'done' : 'download', picked });
            })();
            return true;
        }

        if (req.action === 'y2ping') {
            sendResponse({ inFrame, url: location.href });
            return true;
        }
    });
}
