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

/** Teruskan catatan ke background agar tersimpan di satu tempat. */
function y2note(msg) {
    console.log('[Y2:frame]', msg);
    try { chrome.runtime.sendMessage({ action: 'y2log', msg: `    ${msg}` }); } catch (e) {}
}

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
    if (!tab) { y2note(`tab "${want}" tak ketemu`); return false; }
    tab.click();
    await y2sleep(1200);
    y2note(`tab "${want}" diklik`);
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
    if (!rows) { y2note('tabel kualitas tak muncul'); return null; }

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
    if (!pick) { y2note(`kualitas ${quality} tak ada di daftar`); return null; }

    const btn = pick.querySelector('a,button');
    if (!btn) { y2note('baris kualitas tanpa tombol'); return null; }
    btn.click();
    y2note(`baris dipilih: ${pick.innerText.replace(/\s+/g, ' ').trim().slice(0, 24)}`);
    return pick.innerText.replace(/\s+/g, ' ').trim().slice(0, 30);
}

/**
 * Klik tombol Download di pop-up. Pop-up muncul dalam keadaan memuat
 * (placeholder abu-abu) lalu terisi; kita tunggu tombol yang benar-benar
 * bisa diklik, bukan jeda tetap.
 */
async function y2clickDownload() {
    // Pop-up muncul lebih dulu dalam keadaan MEMUAT: kerangka abu-abu, judul
    // kosong, dan tombolnya sudah ada di DOM tapi belum berfungsi. Mengklik di
    // fase itu tidak memulai unduhan apa pun — inilah sebab video terlewat.
    // Penanda benar-benar siap: judul pop-up sudah terisi DAN tombol punya href
    // sungguhan (bukan '#'), atau teks pendamping "Wait ... start download".
    const btn = await y2waitFor(() => {
        // PENTING: halaman punya 6 tombol bertulisan "Download" — lima di antaranya
        // adalah tombol BARIS TABEL (1080p, 720p, ...). Mengambil yang pertama
        // cocok berarti mengklik ulang baris resolusi, pop-up terbuka lagi, dan
        // unduhan tidak pernah mulai. Tombol pop-up dikenali dari: TIDAK berada
        // di dalam <table>.
        const cands = [...document.querySelectorAll('a,button')]
            .filter(e => /^\s*download\s*$/i.test(e.textContent || '')
                && e.offsetParent !== null
                && !/youtube|converter|mp3/i.test(e.textContent || '')
                && !e.closest('table'));
        if (!cands.length) return null;

        // Pop-up bisa muncul lebih dulu sebagai kerangka kosong; tunggu isinya.
        const siap = cands.find(e => {
            const href = e.getAttribute('href');
            if (href && href !== '#' && !/^javascript:/i.test(href)) return true;
            const modal = e.closest('.modal, [role="dialog"], div');
            const teks = (modal?.innerText || '').trim();
            return teks.length > 40;
        });
        return siap || cands[cands.length - 1] || null;
    }, 45000);

    if (!btn) {
        y2note('tombol Download di pop-up tak muncul dalam 45 detik');
        return false;
    }
    y2note('tombol Download pop-up ditemukan');

    // Setelah diklik, unduhan dimulai lewat navigasi/anchor. Beri jeda singkat
    // supaya permintaan sempat terkirim sebelum halaman ditinggalkan.
    btn.click();
    await y2sleep(2500);
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
