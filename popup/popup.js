document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const statusCardWrap = document.getElementById('statusCardWrap');
    const progressCardWrap = document.getElementById('progressCardWrap');
    const statusIconCircle = document.getElementById('statusIconCircle');
    const statusIconSvg = document.getElementById('statusIconSvg');
    const statusDot = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');
    const statusSub = document.getElementById('statusSub');
    const progressCount = document.getElementById('progressCount');
    const progressTitle = document.getElementById('progressTitle');
    const progressFill = document.getElementById('progressFill');
    const etaPill = document.getElementById('etaPill');
    const etaEstimating = document.getElementById('etaEstimating');
    const themeToggle = document.getElementById('themeToggle');
    const settingsWrap = document.getElementById('settingsWrap');
    const resultsWrap = document.getElementById('resultsWrap');
    const resultsContent = document.getElementById('resultsContent');
    const resultsCopyBtn = document.getElementById('resultsCopyBtn');
    const footerText = document.getElementById('footerText');
    const deepdiveAccordionHeader = document.getElementById('deepdiveAccordionHeader');
    const deepdiveOptionsList = document.getElementById('deepdiveOptionsList');
    const deepdiveSummary = document.getElementById('deepdiveSummary');
    const deepdiveArrow = document.getElementById('deepdiveArrow');
    const descriptionWarning = null; // removed
    const filterCountWrap = document.getElementById('filterCountWrap');
    const filterDateWrap = document.getElementById('filterDateWrap');
    const filterCount = document.getElementById('filterCount');
    const filterDirection = document.getElementById('filterDirection');
    const filterFrom = document.getElementById('filterFrom');
    const filterTo = document.getElementById('filterTo');

    // Research Niche elements
    const nicheWrap = document.getElementById('nicheWrap');
    const transcriptWrap = document.getElementById('transcriptWrap');
    const downloadWrap = document.getElementById('downloadWrap');
    const nicheChannelsPerNiche = document.getElementById('nicheChannelsPerNiche');
    const nicheSuffix = document.getElementById('nicheSuffix');
    const nicheDateFilter = document.getElementById('nicheDateFilter');
    const nicheAccordionHeader = document.getElementById('nicheAccordionHeader');
    const nichePanel = document.getElementById('nichePanel');
    const nicheArrow = document.getElementById('nicheArrow');
    const nicheSummary = document.getElementById('nicheSummary');
    const nicheList = document.getElementById('nicheList');
    const nicheAddInput = document.getElementById('nicheAddInput');
    const nicheAddBtn = document.getElementById('nicheAddBtn');
    const nicheSelectAll = document.getElementById('nicheSelectAll');
    const nicheSelectNone = document.getElementById('nicheSelectNone');
    const nicheByNicheBlock = document.getElementById('nicheByNicheBlock');
    const nicheByUrlBlock = document.getElementById('nicheByUrlBlock');
    const manualUrls = document.getElementById('manualUrls');
    const manualUrlCount = document.getElementById('manualUrlCount');

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

    let activeMode = 'deepdive';

    const ICONS = {
        check: '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/>',
        error: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" fill="currentColor"/>',
    };

    const FOOTER_TEXT = {
        research: 'Open any YouTube page, pick niches, then click Start. <br> Keep the tab active while scraping. Try 1–2 niches first.',
        deepdive: 'Open a YouTube channel page (/videos), then click Start. <br> Keep the tab active while scraping to get comment counts.',
        transcript: 'Isi URL channel atau playlist, atau tempel URL/ID video tertentu. <br> Biarkan tab aktif selama proses berjalan.',
    };

    // ── Mode tabs ──
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activeMode = tab.dataset.mode;
            chrome.storage.local.set({ activeMode });
            renderMode();
        });
    });

    function renderMode() {
        document.querySelectorAll('.mode-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === activeMode);
        });
        footerText.innerHTML = FOOTER_TEXT[activeMode] || FOOTER_TEXT.research;

        // Settings panels only when not scraping; each mode shows its own
        const scraping = startButton.disabled;
        settingsWrap.style.display = (activeMode === 'deepdive' && !scraping) ? '' : 'none';
        nicheWrap.style.display = (activeMode === 'research' && !scraping) ? '' : 'none';
        transcriptWrap.style.display = (activeMode === 'transcript' && !scraping) ? '' : 'none';
        downloadWrap.style.display = (activeMode === 'download' && !scraping) ? '' : 'none';
        const lbl = document.getElementById('startLabel');
        if (lbl) {
            lbl.textContent = activeMode === 'download' ? 'Start Download'
                : activeMode === 'transcript' ? 'Start Transcript'
                : 'Start research';
        }
        // Results only for research
        if (activeMode !== 'research') {
            resultsWrap.style.display = 'none';
        }
    }

    // ── Theme ──
    themeToggle.addEventListener('click', () => {
        const current = document.body.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        chrome.storage.local.set({ theme: next });
    });

    function applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        themeToggle.textContent = theme === 'dark' ? '☀' : '🌙';
    }

    // ── Deepdive options accordion ──
    deepdiveAccordionHeader.addEventListener('click', () => {
        const open = deepdiveOptionsList.style.display !== 'none';
        deepdiveOptionsList.style.display = open ? 'none' : '';
        deepdiveArrow.textContent = open ? '▼' : '▲';
    });

    function readVideoFilter() {
        const mode = document.querySelector('input[name="videoFilter"]:checked')?.value || 'all';
        if (mode === 'count') return { mode, count: parseInt(filterCount.value, 10) || 10, direction: filterDirection.value || 'latest' };
        if (mode === 'date') return { mode, from: filterFrom.value, to: filterTo.value };
        return { mode: 'all' };
    }

    function updateFilterUI(mode) {
        filterCountWrap.style.display = mode === 'count' ? '' : 'none';
        filterDateWrap.style.display = mode === 'date' ? '' : 'none';
    }

    function saveDeepidiveOptions() {
        const opts = {
            channelInfo: document.getElementById('optChannelInfo').checked,
            channelImages: document.getElementById('optChannelImages').checked,
            videoData: document.getElementById('optVideoData').checked,
            thumbnails: document.getElementById('optThumbnails').checked,
            videoDescriptions: true, // always scrape descriptions
        };
        chrome.storage.local.set({ deepdiveOptions: opts, videoFilter: readVideoFilter() });
        updateDeepiveSummary();
    }

    function updateDeepiveSummary() {
        const checked = ['optChannelInfo', 'optChannelImages', 'optVideoData', 'optThumbnails'].filter(id => document.getElementById(id)?.checked).length;
        deepdiveSummary.textContent = `${checked} selected`;
    }

    deepdiveOptionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', saveDeepidiveOptions);
    });

    document.querySelectorAll('input[name="videoFilter"]').forEach(radio => {
        radio.addEventListener('change', () => { updateFilterUI(radio.value); saveDeepidiveOptions(); });
    });
    filterCount.addEventListener('input', saveDeepidiveOptions);
    filterDirection.addEventListener('change', saveDeepidiveOptions);
    filterFrom.addEventListener('change', saveDeepidiveOptions);
    filterTo.addEventListener('change', saveDeepidiveOptions);

    // ── Research Niche options ──
    function addNicheCheckbox(niche, checked) {
        if ([...nicheList.querySelectorAll('input')].some(i => i.value === niche)) return;
        const label = document.createElement('label');
        label.className = 'column-toggle-label';
        label.title = niche;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = niche;
        cb.checked = !!checked;
        cb.addEventListener('change', saveNicheConfig);
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + niche));
        nicheList.appendChild(label);
    }

    function getSelectedNiches() {
        return [...nicheList.querySelectorAll('input:checked')].map(i => i.value);
    }

    function updateNicheSummary() {
        nicheSummary.textContent = `${getSelectedNiches().length} selected`;
    }

    function saveNicheConfig() {
        updateNicheSummary();
        chrome.storage.local.set({
            nicheSelection: getSelectedNiches(),
            nicheAllOptions: [...nicheList.querySelectorAll('input')].map(i => i.value),
            nicheChannelsPerNiche: parseInt(nicheChannelsPerNiche.value, 10) || 10,
            nicheSuffix: nicheSuffix.value,
            nicheDateFilter: nicheDateFilter.value
        });
    }

    nicheAccordionHeader.addEventListener('click', () => {
        const open = nichePanel.style.display !== 'none';
        nichePanel.style.display = open ? 'none' : '';
        nicheArrow.textContent = open ? '▼' : '▲';
    });

    nicheAddBtn.addEventListener('click', () => {
        const val = nicheAddInput.value.trim();
        if (!val) return;
        addNicheCheckbox(val, true);
        nicheAddInput.value = '';
        saveNicheConfig();
    });
    nicheAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nicheAddBtn.click(); }
    });

    nicheSelectAll.addEventListener('click', () => {
        nicheList.querySelectorAll('input').forEach(i => { i.checked = true; });
        saveNicheConfig();
    });
    nicheSelectNone.addEventListener('click', () => {
        nicheList.querySelectorAll('input').forEach(i => { i.checked = false; });
        saveNicheConfig();
    });

    nicheChannelsPerNiche.addEventListener('input', saveNicheConfig);
    nicheSuffix.addEventListener('input', saveNicheConfig);
    nicheDateFilter.addEventListener('change', saveNicheConfig);

    // ── Research source mode (By Niche / By Channel URLs) ──
    function getResearchMode() {
        return document.querySelector('input[name="researchMode"]:checked')?.value || 'niche';
    }

    function parseManualUrls() {
        return manualUrls.value.split('\n').map(s => s.trim()).filter(Boolean);
    }

    function updateResearchModeUI() {
        const m = getResearchMode();
        nicheByNicheBlock.style.display = m === 'niche' ? '' : 'none';
        nicheByUrlBlock.style.display = m === 'urls' ? '' : 'none';
        if (m === 'urls') manualUrlCount.textContent = `${parseManualUrls().length} URLs`;
    }

    document.querySelectorAll('input[name="researchMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateResearchModeUI();
            chrome.storage.local.set({ researchSourceMode: getResearchMode() });
        });
    });
    manualUrls.addEventListener('input', () => {
        manualUrlCount.textContent = `${parseManualUrls().length} URLs`;
        chrome.storage.local.set({ manualUrls: manualUrls.value });
    });

    // ── Status card helpers ──
    function showStatusCard(label, sub, iconName, dotColor) {
        statusCardWrap.style.display = '';
        progressCardWrap.style.display = 'none';

        statusLabel.textContent = label;
        statusSub.textContent = sub;
        statusIconSvg.innerHTML = ICONS[iconName] || ICONS.check;
        statusIconCircle.className = 'status-icon-circle';
        statusDot.style.background = dotColor;
        statusIconCircle.querySelector('svg').style.color = dotColor;
    }

    function showProgressCard(countText, titleText, pct, etaSeconds) {
        statusCardWrap.style.display = 'none';
        progressCardWrap.style.display = '';
        settingsWrap.style.display = 'none';
        nicheWrap.style.display = 'none';

        progressCount.textContent = countText || 'Working…';
        progressTitle.textContent = titleText || '';
        progressFill.style.width = `${pct || 0}%`;

        if (etaSeconds != null) {
            const min = Math.floor(etaSeconds / 60);
            const sec = etaSeconds % 60;
            etaPill.textContent = `~${min > 0 ? min + 'm ' : ''}${sec}s left`;
            etaPill.style.display = '';
            etaEstimating.style.display = 'none';
        } else {
            etaPill.style.display = 'none';
            etaEstimating.style.display = '';
        }
    }

    // ── UI state ──
    function updateUI(isScraping, status, result) {
        startButton.disabled = isScraping;
        stopButton.disabled = !isScraping;

        if (isScraping) return;

        const s = (status || '').toLowerCase();
        if (s.includes('done') || s.includes('complete')) {
            showStatusCard('Complete', status || 'Scraping finished successfully', 'check', '#16a34a');
            if (activeMode === 'research' && result) renderResearchResults(result);
        } else if (s.includes('error') || s.includes('fail') || s.includes('injection')) {
            showStatusCard(status, 'Check the console for details', 'error', '#f59e0b');
            resultsWrap.style.display = 'none';
        } else if (s.includes('stop')) {
            showStatusCard('Stopped', 'Click Start to begin a new research', 'check', '#606060');
            resultsWrap.style.display = 'none';
        } else {
            showStatusCard('Ready', 'Open a YouTube channel page to begin', 'check', '#16a34a');
            resultsWrap.style.display = 'none';
        }

        if (activeMode === 'deepdive') {
            settingsWrap.style.display = '';
        }
        if (activeMode === 'research') {
            nicheWrap.style.display = '';
        }
    }

    // ── Research results rendering ──
    function renderResearchResults(result) {
        if (!result || activeMode !== 'research') return;

        let html = '';

        if (result.latest && result.latest.length > 0) {
            html += `<div class="results-section">
                <div class="results-section-title">5 Latest Videos</div>`;
            result.latest.forEach(v => {
                html += `<div class="result-item">
                    <div class="result-title">${escHtml(v.title)}</div>
                    <div class="result-meta">${escHtml(v.views)} &middot; ${escHtml(v.date)}</div>
                </div>`;
            });
            html += `</div>`;
        }

        if (result.popular) {
            html += `<div class="results-section">
                <div class="results-section-title">Most Popular</div>
                <div class="result-item">
                    <div class="result-title">${escHtml(result.popular.title)}</div>
                    <div class="result-meta">${escHtml(result.popular.views)} &middot; ${escHtml(result.popular.date)}</div>
                </div>
            </div>`;
        }

        if (result.oldest) {
            html += `<div class="results-section">
                <div class="results-section-title">Oldest Video</div>
                <div class="result-item">
                    <div class="result-title">${escHtml(result.oldest.title)}</div>
                    <div class="result-meta">${escHtml(result.oldest.views)} &middot; ${escHtml(result.oldest.date)}</div>
                </div>
            </div>`;
        }

        resultsContent.innerHTML = html;
        resultsWrap.style.display = '';
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Copy results ──
    resultsCopyBtn.addEventListener('click', () => {
        chrome.storage.local.get(['researchResult'], (r) => {
            if (!r.researchResult) return;
            const res = r.researchResult;
            const lines = [];

            if (res.channelUrl) lines.push(`Channel: ${res.channelUrl}\n`);

            if (res.latest && res.latest.length > 0) {
                lines.push('=== 5 LATEST VIDEOS ===');
                res.latest.forEach((v, i) => {
                    lines.push(`${i + 1}. ${v.title}`);
                    lines.push(`   ${v.views} · ${v.date}`);
                });
                lines.push('');
            }

            if (res.popular) {
                lines.push('=== MOST POPULAR ===');
                lines.push(res.popular.title);
                lines.push(`${res.popular.views} · ${res.popular.date}`);
                lines.push('');
            }

            if (res.oldest) {
                lines.push('=== OLDEST VIDEO ===');
                lines.push(res.oldest.title);
                lines.push(`${res.oldest.views} · ${res.oldest.date}`);
            }

            navigator.clipboard.writeText(lines.join('\n')).then(() => {
                resultsCopyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    resultsCopyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z" fill="currentColor"/></svg> Copy results`;
                }, 1500);
            });
        });
    });

    // ── Buttons ──
    /**
     * Terima ID telanjang, URL penuh, dan youtu.be — dipisah baris atau koma.
     * Urutan dipertahankan, duplikat dibuang.
     */
    function parseVideoIds(raw) {
        const out = [], seen = new Set();
        for (const chunk of (raw || '').split(/[\n,]+/)) {
            const t = chunk.trim();
            if (!t) continue;
            let id = null;
            const m = t.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
            if (m) id = m[1];
            else if (/^[A-Za-z0-9_-]{11}$/.test(t)) id = t;
            if (id && !seen.has(id)) { seen.add(id); out.push(id); }
        }
        return out;
    }

    // Panel log: dibaca dari storage, jadi tetap ada walau service worker
    // sudah mati dan popup ditutup-buka.
    const ytShowLog = document.getElementById('ytShowLog');
    const ytLogBox = document.getElementById('ytLogBox');
    if (ytShowLog && ytLogBox) {
        ytShowLog.addEventListener('click', () => {
            const buka = ytLogBox.style.display === 'none';
            ytLogBox.style.display = buka ? '' : 'none';
            ytShowLog.textContent = buka ? 'Sembunyikan log' : 'Lihat log terakhir';
            if (!buka) return;
            chrome.storage.local.get('y2RunLog', (r) => {
                const baris = r.y2RunLog || [];
                ytLogBox.textContent = baris.length ? baris.join('\n') : '(belum ada log)';
                ytLogBox.scrollTop = ytLogBox.scrollHeight;
            });
        });
    }

    const ytCopyLog = document.getElementById('ytCopyLog');
    if (ytCopyLog) {
        ytCopyLog.addEventListener('click', () => {
            chrome.storage.local.get('y2RunLog', async (r) => {
                const teks = (r.y2RunLog || []).join('\n');
                if (!teks) { ytCopyLog.textContent = 'Kosong'; }
                else {
                    try {
                        await navigator.clipboard.writeText(teks);
                        ytCopyLog.textContent = 'Tersalin';
                    } catch (e) {
                        ytCopyLog.textContent = 'Gagal';
                    }
                }
                setTimeout(() => { ytCopyLog.textContent = 'Salin'; }, 1500);
            });
        });
    }

    // Tab Transcript: blok channel vs video tertentu
    function applyTrSource(v) {
        const ids = v === 'ids';
        document.getElementById('trChannelBlock').style.display = ids ? 'none' : '';
        document.getElementById('trIdsBlock').style.display = ids ? '' : 'none';
        if (!ids) applyTrUrlKind();
    }

    // Playlist tidak punya chip Popular/Latest/Oldest — urutannya milik pemilik
    // playlist. Menampilkan pilihan urutan di situ menjanjikan yang tak ditepati.
    function applyTrUrlKind() {
        const url = (document.getElementById('trUrl')?.value || '').trim();
        const playlist = /[?&]list=/.test(url) && !/[?&]v=/.test(url);
        const sort = document.getElementById('trSort');
        const hint = document.getElementById('trPlaylistHint');
        if (sort) sort.style.display = playlist ? 'none' : '';
        if (hint) hint.style.display = playlist ? '' : 'none';
    }
    document.querySelectorAll('input[name="trSource"]').forEach(r => {
        r.addEventListener('change', () => {
            if (!r.checked) return;
            applyTrSource(r.value);
            chrome.storage.local.set({ trSource: r.value });
        });
    });
    [['trIds', 'trIds'], ['trUrl', 'trUrl'], ['trCount', 'trCount']].forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            chrome.storage.local.set({ [key]: el.value });
            if (id === 'trUrl') applyTrUrlKind();
        });
    });
    {
        const el = document.getElementById('trSort');
        if (el) el.addEventListener('change', () => chrome.storage.local.set({ trSort: el.value }));
    }

    // Blok channel vs daftar ID saling menggantikan
    function applyDlSource(v) {
        const ids = v === 'ids';
        document.getElementById('dlChannelBlock').style.display = ids ? 'none' : '';
        document.getElementById('dlIdsBlock').style.display = ids ? '' : 'none';
    }
    document.querySelectorAll('input[name="dlSource"]').forEach(r => {
        r.addEventListener('change', () => {
            if (!r.checked) return;
            applyDlSource(r.value);
            chrome.storage.local.set({ dlSource: r.value });
        });
    });

    // Popup Chrome dibuang dari memori tiap ditutup, jadi isian harus
    // disimpan sendiri — kalau tidak, textarea selalu kosong saat dibuka lagi.
    [['dlIds', 'dlIds'], ['dlUrl', 'dlUrl'], ['dlCount', 'dlCount']].forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => chrome.storage.local.set({ [key]: el.value }));
    });
    [['dlSort', 'dlSort'], ['dlKind', 'dlKind'], ['dlQuality', 'dlQuality']].forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => chrome.storage.local.set({ [key]: el.value }));
    });

    startButton.addEventListener('click', () => {
        if (activeMode === 'download') {
            const source = (document.querySelector('input[name="dlSource"]:checked') || {}).value || 'channel';

            if (source === 'ids') {
                const ids = parseVideoIds(document.getElementById('dlIds').value);
                if (!ids.length) {
                    showStatusCard('Tidak ada ID', 'Tempel minimal satu video ID atau URL', 'error', '#f59e0b');
                    return;
                }
                const downloadConfig = {
                    source: 'ids',
                    ids,
                    kind: document.getElementById('dlKind').value,
                    quality: document.getElementById('dlQuality').value
                };
                startButton.disabled = true;
                stopButton.disabled = false;
                resultsWrap.style.display = 'none';
                showProgressCard('Starting…', `${ids.length} video`, 0);
                chrome.runtime.sendMessage({ action: 'startScraping', mode: 'download', downloadConfig }, () => {
                    if (chrome.runtime.lastError) updateUI(false, 'Error: Failed to start');
                });
                return;
            }

            const url = document.getElementById('dlUrl').value.trim();
            if (!url) {
                showStatusCard('No URL', 'Masukkan URL channel dulu', 'error', '#f59e0b');
                return;
            }
            const downloadConfig = {
                source: 'channel',
                url,
                sort: document.getElementById('dlSort').value,
                count: parseInt(document.getElementById('dlCount').value, 10) || 5,
                kind: document.getElementById('dlKind').value,
                quality: document.getElementById('dlQuality').value
            };
            startButton.disabled = true;
            stopButton.disabled = false;
            resultsWrap.style.display = 'none';
            showProgressCard('Starting…', '', 0);
            chrome.runtime.sendMessage({ action: 'startScraping', mode: 'download', downloadConfig }, () => {
                if (chrome.runtime.lastError) updateUI(false, 'Error: Failed to start');
            });
            return;
        }

        if (activeMode === 'transcript') {
            const trSrc = (document.querySelector('input[name="trSource"]:checked') || {}).value || 'channel';

            if (trSrc === 'ids') {
                const ids = parseVideoIds(document.getElementById('trIds').value);
                if (!ids.length) {
                    showStatusCard('Tidak ada video', 'Tempel minimal satu video ID atau URL', 'error', '#f59e0b');
                    return;
                }
                const transcriptConfig = {
                    source: 'ids',
                    ids,
                    timestamps: document.getElementById('trTimestamps').checked
                };
                startButton.disabled = true;
                stopButton.disabled = false;
                resultsWrap.style.display = 'none';
                showProgressCard('Starting…', `${ids.length} video`, 0);
                chrome.runtime.sendMessage({ action: 'startScraping', mode: 'transcript', transcriptConfig }, () => {
                    if (chrome.runtime.lastError) updateUI(false, 'Error: Failed to start');
                });
                return;
            }

            const url = document.getElementById('trUrl').value.trim();
            if (!url) {
                showStatusCard('No URL', 'Masukkan URL channel dulu', 'error', '#f59e0b');
                return;
            }
            const transcriptConfig = {
                source: 'channel',
                url,
                sort: document.getElementById('trSort').value,
                count: parseInt(document.getElementById('trCount').value, 10) || 10,
                timestamps: document.getElementById('trTimestamps').checked
            };
            startButton.disabled = true;
            stopButton.disabled = false;
            resultsWrap.style.display = 'none';
            showProgressCard('Starting…', '', 0);
            chrome.runtime.sendMessage({ action: 'startScraping', mode: 'transcript', transcriptConfig }, () => {
                if (chrome.runtime.lastError) updateUI(false, 'Error: Failed to start');
            });
            return;
        }

        if (activeMode === 'research') {
            let researchConfig;
            if (getResearchMode() === 'urls') {
                const urls = parseManualUrls();
                if (urls.length === 0) {
                    showStatusCard('No URLs', 'Paste at least one channel URL', 'error', '#f59e0b');
                    return;
                }
                researchConfig = { mode: 'urls', urls };
            } else {
                const niches = getSelectedNiches();
                if (niches.length === 0) {
                    showStatusCard('No niches selected', 'Pick at least one niche to research', 'error', '#f59e0b');
                    return;
                }
                researchConfig = {
                    mode: 'niche',
                    niches,
                    channelsPerNiche: parseInt(nicheChannelsPerNiche.value, 10) || 10,
                    suffix: nicheSuffix.value.trim(),
                    dateFilter: nicheDateFilter.value
                };
            }
            startButton.disabled = true;
            stopButton.disabled = false;
            resultsWrap.style.display = 'none';
            showProgressCard('Starting…', '', 0);
            chrome.runtime.sendMessage({ action: 'startScraping', mode: 'research', researchConfig }, () => {
                if (chrome.runtime.lastError) updateUI(false, 'Error: Failed to start');
            });
            return;
        }

        const deepdiveOptions = {};
        deepdiveOptionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            deepdiveOptions[cb.value] = cb.checked;
        });

        startButton.disabled = true;
        stopButton.disabled = false;
        resultsWrap.style.display = 'none';
        showProgressCard('Starting…', '', 0);

        chrome.runtime.sendMessage({
            action: 'startScraping',
            mode: activeMode,
            deepdiveOptions,
            videoFilter: readVideoFilter()
        }, (response) => {
            if (chrome.runtime.lastError) {
                updateUI(false, 'Error: Failed to start');
            }
        });
    });

    stopButton.addEventListener('click', () => {
        stopButton.disabled = true;
        chrome.runtime.sendMessage({ action: 'stopScraping' });
    });

    // ── Live messages ──
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'updateStatus') {
            updateUI(request.isScraping, request.status, request.result);
        } else if (request.action === 'updateProgress') {
            startButton.disabled = true;
            stopButton.disabled = false;
            progressCardWrap.style.display = '';
            statusCardWrap.style.display = 'none';
            settingsWrap.style.display = 'none';
            nicheWrap.style.display = 'none';

            progressCount.textContent = request.countText || 'Working…';
            progressTitle.textContent = request.phase || '';
            const pct = request.pct || 0;
            progressFill.style.width = `${pct}%`;

            if (request.etaSeconds != null) {
                const min = Math.floor(request.etaSeconds / 60);
                const sec = request.etaSeconds % 60;
                etaPill.textContent = `~${min > 0 ? min + 'm ' : ''}${sec}s left`;
                etaPill.style.display = '';
                etaEstimating.style.display = 'none';
            } else {
                etaPill.style.display = 'none';
                etaEstimating.style.display = '';
            }
        }
    });

    // ── Initial load ──
    chrome.storage.local.get(['activeMode', 'theme', 'deepdiveOptions', 'videoFilter', 'isScraping', 'status', 'researchResult', 'lastProgress', 'nicheSelection', 'nicheAllOptions', 'nicheChannelsPerNiche', 'nicheSuffix', 'nicheDateFilter', 'researchSourceMode', 'manualUrls', 'dlSource', 'dlIds', 'dlUrl', 'dlCount', 'dlSort', 'dlKind', 'dlQuality', 'trSource', 'trIds', 'trUrl', 'trCount', 'trSort'], (r) => {
        activeMode = r.activeMode || 'deepdive';

        applyTheme(r.theme || 'dark');

        // Restore research niche config (presets + any custom niches added before)
        const allNiches = (r.nicheAllOptions && r.nicheAllOptions.length) ? r.nicheAllOptions : NICHE_PRESETS;
        const selected = new Set(r.nicheSelection || []); // empty = nothing checked by default
        nicheList.innerHTML = '';
        allNiches.forEach(n => addNicheCheckbox(n, selected.has(n)));
        updateNicheSummary();
        if (r.nicheChannelsPerNiche) nicheChannelsPerNiche.value = r.nicheChannelsPerNiche;
        nicheSuffix.value = (r.nicheSuffix != null && r.nicheSuffix !== '') ? r.nicheSuffix : `mix ${new Date().getFullYear()}`;
        if (r.nicheDateFilter) nicheDateFilter.value = r.nicheDateFilter;

        // Restore research source mode + manual URLs
        if (r.manualUrls) manualUrls.value = r.manualUrls;

        // Pulihkan isian tab Download
        const setVal = (id, v) => { const e = document.getElementById(id); if (e && v != null) e.value = v; };
        setVal('dlIds', r.dlIds);
        setVal('dlUrl', r.dlUrl);
        setVal('dlCount', r.dlCount);
        setVal('dlSort', r.dlSort);
        setVal('dlKind', r.dlKind);
        setVal('dlQuality', r.dlQuality);
        setVal('trIds', r.trIds);
        setVal('trUrl', r.trUrl);
        setVal('trCount', r.trCount);
        setVal('trSort', r.trSort);
        const trSrc = r.trSource || 'channel';
        const trRadio = document.querySelector(`input[name="trSource"][value="${trSrc}"]`);
        if (trRadio) trRadio.checked = true;
        applyTrSource(trSrc);

        const src = r.dlSource || 'channel';
        const radio = document.querySelector(`input[name="dlSource"][value="${src}"]`);
        if (radio) radio.checked = true;
        applyDlSource(src);
        const srcMode = r.researchSourceMode || 'niche';
        const srcRadio = document.querySelector(`input[name="researchMode"][value="${srcMode}"]`);
        if (srcRadio) srcRadio.checked = true;
        updateResearchModeUI();

        // Restore deepdive options
        if (r.deepdiveOptions) {
            ['channelInfo', 'channelImages', 'videoData', 'thumbnails'].forEach(key => {
                const el = document.getElementById('opt' + key.charAt(0).toUpperCase() + key.slice(1));
                if (el && r.deepdiveOptions[key] !== undefined) el.checked = r.deepdiveOptions[key];
            });
            saveDeepidiveOptions();
        }

        if (r.videoFilter) {
            const m = r.videoFilter.mode || 'all';
            const radio = document.querySelector(`input[name="videoFilter"][value="${m}"]`);
            if (radio) radio.checked = true;
            if (m === 'count' && r.videoFilter.count) filterCount.value = r.videoFilter.count;
            if (m === 'count' && r.videoFilter.direction) filterDirection.value = r.videoFilter.direction;
            if (m === 'date') {
                if (r.videoFilter.from) filterFrom.value = r.videoFilter.from;
                if (r.videoFilter.to) filterTo.value = r.videoFilter.to;
            }
            updateFilterUI(m);
        }

        renderMode();

        if (r.isScraping && r.lastProgress) {
            startButton.disabled = true;
            stopButton.disabled = false;
            const p = r.lastProgress;
            showProgressCard(p.countText, p.phase, p.pct, p.etaSeconds);
        } else {
            updateUI(r.isScraping ?? false, r.status ?? 'Ready', r.researchResult);
        }
    });
});
