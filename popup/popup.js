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
    const descriptionWarning = document.getElementById('descriptionWarning');

    let activeMode = 'research';

    const ICONS = {
        check: '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/>',
        error: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" fill="currentColor"/>',
    };

    const FOOTER_TEXT = {
        research: 'Open a YouTube channel\'s Videos tab, then click Start.',
        deepdive: 'Open a YouTube channel page (@handle or /videos), then click Start.',
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
        footerText.textContent = FOOTER_TEXT[activeMode] || FOOTER_TEXT.research;

        // Settings only visible in deepdive and when not scraping
        const scraping = startButton.disabled;
        if (activeMode === 'deepdive' && !scraping) {
            settingsWrap.style.display = '';
        } else {
            settingsWrap.style.display = 'none';
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

    function updateDeepiveSummary() {
        const checked = deepdiveOptionsList.querySelectorAll('input:checked').length;
        deepdiveSummary.textContent = `${checked} selected`;
    }

    function saveDeepidiveOptions() {
        const opts = {};
        deepdiveOptionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            opts[cb.value] = cb.checked;
        });
        chrome.storage.local.set({ deepdiveOptions: opts });
        updateDeepiveSummary();
        descriptionWarning.style.display = document.getElementById('optVideoDescriptions').checked ? '' : 'none';
    }

    deepdiveOptionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', saveDeepidiveOptions);
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

    function showProgressCard(countText, titleText, pct) {
        statusCardWrap.style.display = 'none';
        progressCardWrap.style.display = '';
        settingsWrap.style.display = 'none';

        progressCount.textContent = countText || 'Working…';
        progressTitle.textContent = titleText || '';
        progressFill.style.width = `${pct || 0}%`;
        etaPill.style.display = 'none';
        etaEstimating.style.display = '';
    }

    // ── UI state ──
    function updateUI(isScraping, status, result) {
        startButton.disabled = isScraping;
        stopButton.disabled = !isScraping;

        if (isScraping) return;

        const s = (status || '').toLowerCase();
        if (s.includes('done') || s.includes('complete')) {
            showStatusCard('Complete', 'Scraping finished successfully', 'check', '#16a34a');
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
    startButton.addEventListener('click', () => {
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
            deepdiveOptions
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

            progressCount.textContent = request.countText || 'Working…';
            progressTitle.textContent = request.phase || '';
            const pct = request.pct || 0;
            progressFill.style.width = `${pct}%`;

            etaPill.style.display = 'none';
            etaEstimating.style.display = '';
        }
    });

    // ── Initial load ──
    chrome.storage.local.get(['activeMode', 'theme', 'deepdiveOptions', 'isScraping', 'status', 'researchResult', 'lastProgress'], (r) => {
        activeMode = r.activeMode || 'research';

        applyTheme(r.theme || 'dark');

        // Restore deepdive options
        if (r.deepdiveOptions) {
            deepdiveOptionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (r.deepdiveOptions[cb.value] !== undefined) {
                    cb.checked = r.deepdiveOptions[cb.value];
                }
            });
            updateDeepiveSummary();
            descriptionWarning.style.display = r.deepdiveOptions.videoDescriptions ? '' : 'none';
        }

        renderMode();

        if (r.isScraping && r.lastProgress) {
            startButton.disabled = true;
            stopButton.disabled = false;
            const p = r.lastProgress;
            showProgressCard(p.countText, p.phase, p.pct);
        } else {
            updateUI(r.isScraping ?? false, r.status ?? 'Ready', r.researchResult);
        }
    });
});
