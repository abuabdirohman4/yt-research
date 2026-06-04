// ===================== HELPERS (mirrored from background.js / content.js) =====================

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

const OLDEST_MIN_DAYS = 30;

function flagRow(row) {
    const reasons = [];
    if (row.avgViews === '' || row.avgViews == null || Number(row.avgViews) === 0) reasons.push('avg empty');
    if (row.popularViews === '' || row.popularViews == null) reasons.push('popular empty');
    const oldest = row.oldestDate;
    if (!oldest) {
        reasons.push('oldest missing');
    } else if (ageScore(oldest) < OLDEST_MIN_DAYS) {
        reasons.push(`oldest <${OLDEST_MIN_DAYS}d`);
    }
    return { flagged: reasons.length > 0, reasons };
}

function fmt(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    if (!isNaN(n) && n >= 1000) return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : (n / 1000).toFixed(1) + 'K';
    return String(val);
}

function channelHandle(url) {
    if (!url) return '?';
    const m = url.match(/\/@([^/?#]+)/) || url.match(/\/channel\/([^/?#]+)/);
    return m ? '@' + m[1] : url.replace('https://www.youtube.com', '').replace('/videos', '');
}

// ===================== RENDER =====================

function render(state) {
    const { nicheResults: rows = [], researchConfig: cfg = {}, nicheIndex = 0,
            nicheQueue = [], isScraping, status, doneChannels = 0, estTotalChannels = 0 } = state;

    const tbody = document.getElementById('tbody');
    const empty = document.getElementById('empty');
    const statusEl = document.getElementById('status');

    // Status line
    if (statusEl) {
        if (!isScraping && rows.length > 0) {
            statusEl.textContent = status || `Done — ${rows.length} channels`;
            statusEl.className = status && status.toLowerCase().includes('stop') ? 'stopped' : 'done';
        } else {
            statusEl.textContent = status || 'Scraping…';
            statusEl.className = '';
        }
    }

    if (!tbody) return;

    // Smart scroll: preserve position unless at bottom
    const wrap = document.getElementById('scroll-wrap');
    const atBottom = wrap ? (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40) : true;
    const prevTop = wrap ? wrap.scrollTop : 0;

    const target = cfg.channelsPerNiche || 10;
    const activeNiche = (nicheQueue)[nicheIndex] || null;

    // Count rows per niche
    const nicheCounts = {};
    for (const r of rows) {
        nicheCounts[r.niche || ''] = (nicheCounts[r.niche || ''] || 0) + 1;
    }

    tbody.innerHTML = '';
    let flagCount = 0;

    if (!rows.length) {
        empty.style.display = 'block';
    } else {
        empty.style.display = 'none';
        let prevNiche = null;

        for (const row of rows) {
            const niche = row.niche || '';

            // Niche header row
            if (niche && niche !== prevNiche) {
                const count = nicheCounts[niche] || 0;
                const isUnder = niche !== activeNiche && count < target;
                const headTr = document.createElement('tr');
                headTr.className = 'niche-head' + (isUnder ? ' niche-head-under' : '');
                const no = nicheNumber(niche);
                const prefix = isUnder ? '⚠ ' : '';
                headTr.innerHTML = `<td colspan="6">${prefix}${no ? no + ' · ' : ''}${niche} (${count}/${target})</td>`;
                tbody.appendChild(headTr);
                prevNiche = niche;
            }

            const { flagged } = flagRow(row);
            if (flagged) flagCount++;

            const tr = document.createElement('tr');
            if (flagged) tr.classList.add('row-flag');

            const no = nicheNumber(niche);
            const ch = channelHandle(row.channelUrl);
            const chUrl = row.channelUrl || '';
            const flagPrefix = flagged ? '⚠ ' : '';
            const linkHtml = chUrl
                ? `${flagPrefix}<a class="ch-link" href="${chUrl}" target="_blank" rel="noopener" title="${chUrl}">${ch}</a>`
                : `${flagPrefix}${ch}`;

            tr.innerHTML = `
                <td title="${no}">${no}</td>
                <td title="${niche}">${niche}</td>
                <td>${linkHtml}</td>
                <td>${fmt(row.avgViews)}</td>
                <td>${fmt(row.popularViews)}</td>
                <td>${row.oldestDate || '—'}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    // Smart scroll restore
    if (wrap) {
        if (atBottom) {
            wrap.scrollTop = wrap.scrollHeight;
        } else {
            wrap.scrollTop = prevTop;
        }
    }

    // Update window title with flag count
    const flagPart = flagCount > 0 ? ` · ⚠ ${flagCount} flagged` : '';
    document.title = `YT Research · ${rows.length} channels${flagPart}`;
}

// ===================== INIT =====================

const WATCH_KEYS = ['nicheResults', 'researchConfig', 'nicheIndex', 'nicheQueue',
                    'isScraping', 'status', 'doneChannels', 'estTotalChannels'];

let cachedState = {};

function loadAndRender() {
    chrome.storage.local.get(WATCH_KEYS, (state) => {
        cachedState = { ...cachedState, ...state };
        render(cachedState);
    });
}

// Initial load
loadAndRender();

// Live updates via storage change listener
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let relevant = false;
    for (const key of WATCH_KEYS) {
        if (key in changes) {
            cachedState[key] = changes[key].newValue;
            relevant = true;
        }
    }
    if (relevant) render(cachedState);
});
