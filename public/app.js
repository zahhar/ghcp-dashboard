let globalUsers = [];
let currentSortColumn = 'code_loc_changed';
let currentSortDesc = true;
let currentTeamFilter = '';
let currentSearchQuery = '';
let currentStatusFilter = 'active';
let prevMonthStats = null;
let prevMonthTotals = null;

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

let currentMonthFilter = '';

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
    setupTableSorting();

    document.getElementById('month-filter').addEventListener('change', (e) => {
        currentMonthFilter = e.target.value;
        fetchDashboardData(currentMonthFilter);
    });

    document.getElementById('team-filter').addEventListener('change', (e) => {
        currentTeamFilter = e.target.value;
        renderUsersTable();
    });

    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentStatusFilter = e.target.value;
        renderUsersTable();
    });

    document.getElementById('user-search').addEventListener('input', (e) => {
        currentSearchQuery = e.target.value.trim();
        renderUsersTable();
    });
});

async function fetchDashboardData(month = '') {
    try {
        const url = month ? `/api/stats?month=${month}` : '/api/stats';
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();

        // Update header stats
        document.getElementById('stat-total-users').textContent = formatNumber(data.totalUsers);
        document.getElementById('stat-total-interactions').textContent = formatNumber(data.totalInteractions);
        if (data.totalOrgLocChanged !== undefined) {
            document.getElementById('stat-total-loc').textContent = formatNumber(data.totalOrgLocChanged);
        }

        // Populate month dropdown if present in response and not populated yet
        const monthFilterEl = document.getElementById('month-filter');
        if (data.availableMonths && monthFilterEl.options.length <= 1) {
            data.availableMonths.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                const [yyyy, mm] = m.split('-');
                const d = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
                opt.textContent = d.toLocaleString('default', { month: 'long', year: 'numeric' });
                monthFilterEl.appendChild(opt);
            });
        }

        // Populate team dropdown if present in response and not populated yet
        const teamFilterEl = document.getElementById('team-filter');
        if (data.availableTeams && teamFilterEl.options.length <= 1) {
            data.availableTeams.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
                teamFilterEl.appendChild(opt);
            });
        }

        globalUsers = data.users || [];
        prevMonthStats = data.prevMonthStats || null;
        prevMonthTotals = data.prevMonthTotals || null;

        // Render Tables
        renderUsersTable();
        renderDAUChart();

    } catch (error) {
        console.error('Error fetching stats:', error);
        document.getElementById('users-body').innerHTML = `<tr><td colspan="11" class="loading">Failed to load data. Make sure backend is running.</td></tr>`;
    }
}

// Returns YYYY-MM-DD in LOCAL time (avoids UTC-offset date shift from toISOString)
function localISODate(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getFriendlyDate(dateString) {
    if (!dateString) return '-';
    // dateString format is assumed to be YYYY-MM-DD
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    const formattedDate = `${parts[2]}.${parts[1]}.${parts[0]}`;

    // Calculate relative string
    const targetDate = new Date(dateString);
    const today = new Date();
    // Normalize to midnight to do purely day-level diffs
    targetDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today - targetDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let relativeStr = '';
    if (diffDays === 0) relativeStr = 'today';
    else if (diffDays === 1) relativeStr = 'yesterday';
    else if (diffDays > 1 && diffDays < 7) relativeStr = `${diffDays} days ago`;
    else if (diffDays >= 7 && diffDays < 14) relativeStr = '1 week ago';
    else if (diffDays >= 14 && diffDays < 30) relativeStr = `${Math.floor(diffDays / 7)} weeks ago`;
    else if (diffDays >= 30) relativeStr = '1+ month ago';
    else relativeStr = 'in the future?';

    return `${formattedDate}<br><span style="font-size:0.8em;color:var(--text-muted)">${relativeStr}</span>`;
}

function setupTableSorting() {
    // Map column index to property names in the user object
    const sortMapping = {
        0: null, // # is not sortable
        1: 'human_name',
        2: 'code_loc_changed',
        3: 'avg_loc_added_daily',
        4: 'doc_loc_changed',
        5: 'config_loc_changed',
        6: 'turns',
        7: 'favorite_language',
        8: 'favorite_model',
        9: 'favorite_ide',
        10: 'active_days_count',
        11: 'last_active_day'
    };

    const headers = document.querySelectorAll('#users-table th');

    // Store original text
    headers.forEach(th => {
        th.dataset.originalText = th.innerText;
    });

    // Helper to update visual sort indicators
    function updateHeaders() {
        headers.forEach((th, index) => {
            let text = th.dataset.originalText;
            if (sortMapping[index] === currentSortColumn) {
                text += currentSortDesc ? ' ▼' : ' ▲';
            }
            th.innerText = text;
        });
    }

    updateHeaders(); // initial state

    headers.forEach((th, index) => {
        th.style.cursor = 'pointer';
        th.title = "Click to sort";
        th.addEventListener('click', () => {
            const prop = sortMapping[index];
            if (!prop) return;

            // Toggle sort direction if clicking same column
            if (currentSortColumn === prop) {
                currentSortDesc = !currentSortDesc;
            } else {
                currentSortColumn = prop;
                // Default to descending for numbers, ascending for strings (human_name)
                currentSortDesc = prop !== 'human_name';
            }

            updateHeaders();
            renderUsersTable();
        });
    });
}

function fuzzyMatch(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (!q) return true;
    if (t.includes(q)) return true;
    // Subsequence match: chars of query appear in order, not too spread out
    let qi = 0, firstMatch = -1, lastMatch = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            if (firstMatch === -1) firstMatch = ti;
            lastMatch = ti;
            qi++;
        }
    }
    if (qi < q.length) return false;
    return (lastMatch - firstMatch + 1) <= q.length * 2;
}

function matchesSearch(user, query) {
    if (!query) return true;
    const fields = [
        user.human_name, user.user_login, user.team,
        user.favorite_language, user.favorite_model, user.favorite_ide
    ];
    return fields.some(f => f && fuzzyMatch(query, String(f)));
}

function diffBadge(current, previous, skipNew) {
    if (previous === undefined || previous === null) return '';
    if (previous === 0 && current === 0) return '';
    if (previous === 0) return skipNew ? '' : '<span class="diff-badge diff-new">new</span>';
    const diff = current - previous;
    if (diff === 0) return '<span class="diff-badge diff-neutral">= 0%</span>';
    const pct = Math.round(((current - previous) / previous) * 100);
    if (!isFinite(pct) || Math.abs(pct) > 999) {
        return diff > 0 ? '<span class="diff-badge diff-up">🚀</span>' : '<span class="diff-badge diff-down">📉</span>';
    }
    const cls = pct > 0 ? 'diff-up' : 'diff-down';
    const arrow = pct > 0 ? '▲' : '▼';
    return `<span class="diff-badge ${cls}">${arrow} ${Math.abs(pct)}%</span>`;
}

function diffArrowOnly(current, previous) {
    if (previous === undefined || previous === null) return '';
    if (previous === 0 && current === 0) return '';
    if (previous === 0 && current > 0) return '<span class="diff-badge diff-new">new</span>';
    const diff = current - previous;
    if (diff === 0) return '';
    return diff > 0
        ? '<span class="diff-badge diff-up">▲</span>'
        : '<span class="diff-badge diff-down">▼</span>';
}

function diffAbsBadge(current, previous) {
    if (previous === undefined || previous === null) return '';
    const diff = current - previous;
    if (diff === 0) return '';
    const cls = diff > 0 ? 'diff-up' : 'diff-down';
    const sign = diff > 0 ? '+' : '';
    return `<span class="diff-badge ${cls}">${sign}${diff}</span>`;
}

function renderUsersTable() {
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';

    // Apply team filter
    let sortedUsers = currentTeamFilter
        ? globalUsers.filter(u => u.team === currentTeamFilter)
        : [...globalUsers];

    // Apply status filter
    if (currentStatusFilter === 'active') {
        sortedUsers = sortedUsers.filter(u => !u.revoked);
    } else if (currentStatusFilter === 'revoked') {
        sortedUsers = sortedUsers.filter(u => u.revoked);
    }

    // Apply search filter
    if (currentSearchQuery) {
        sortedUsers = sortedUsers.filter(u => matchesSearch(u, currentSearchQuery));
    }

    // Update header stats to reflect current filter
    const filteredLocChanged = sortedUsers.reduce((acc, u) => acc + u.total_loc_changed, 0);
    const filteredInteractions = sortedUsers.reduce((acc, u) => acc + u.turns, 0);
    document.getElementById('stat-total-users').textContent = formatNumber(sortedUsers.length);
    document.getElementById('stat-total-interactions').textContent = formatNumber(filteredInteractions);
    document.getElementById('stat-total-loc').textContent = formatNumber(filteredLocChanged);

    // Update header diff badges — compute prev totals from same filtered user set
    let prevFilteredUsers = 0, prevFilteredInteractions = 0, prevFilteredLoc = 0;
    if (prevMonthStats) {
        for (const u of sortedUsers) {
            const p = prevMonthStats[u.user_login];
            if (p) {
                prevFilteredUsers++;
                prevFilteredInteractions += p.turns || 0;
                prevFilteredLoc += (p.code_loc_changed || 0) + (p.doc_loc_changed || 0) + (p.config_loc_changed || 0);
            }
        }
    }
    document.getElementById('stat-diff-users').innerHTML = prevMonthStats ? diffAbsBadge(sortedUsers.length, prevFilteredUsers) : '';
    document.getElementById('stat-diff-interactions').innerHTML = prevMonthStats ? diffBadge(filteredInteractions, prevFilteredInteractions, true) : '';
    document.getElementById('stat-diff-loc').innerHTML = prevMonthStats ? diffBadge(filteredLocChanged, prevFilteredLoc, true) : '';

    // Sort logic
    if (currentSortColumn !== 'rank') {
        sortedUsers.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];


            // string vs number comparisons
            if (typeof valA === 'string' && typeof valB === 'string') {
                const cmp = valA.localeCompare(valB);
                return currentSortDesc ? -cmp : cmp;
            }

            // Default number / object comparison
            if (valA < valB) return currentSortDesc ? 1 : -1;
            if (valA > valB) return currentSortDesc ? -1 : 1;
            return 0;
        });
    }

    sortedUsers.forEach((user, idx) => {
        const lineNumber = idx + 1;
        const tr = document.createElement('tr');
        const prev = prevMonthStats ? prevMonthStats[user.user_login] : null;

        if (user.revoked) {
            tr.classList.add('revoked-user');
        }

        const revokedMark = user.revoked ? ' <span style="font-size: 0.9em;">❌</span>' : '';
        const newUserMark = (prevMonthStats && !prev) ? ' <span class="diff-badge diff-new">new</span>' : '';

        // Keep user_login hidden in anonymized mode, but preserve the original rendering for easy restore.
        // <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.team ? user.team + ' | ' : ''}${user.user_login}</span>

        tr.innerHTML = `
            <td style="text-align: center; color: var(--text-muted); font-size: 0.9em;">
                ${lineNumber}
            </td>
            <td>
                <div class="user-cell" style="white-space: nowrap; flex-direction: column; align-items: flex-start; gap: 0.1rem;">
                    <span style="font-weight: 600;">${user.human_name}${revokedMark}${newUserMark}</span>
                    <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.team || ''}</span>
                </div>
            </td>
            <td style="white-space: nowrap;">
                ${formatNumber(user.code_loc_changed)}
                ${prev ? diffBadge(user.code_loc_changed, prev.code_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    +${formatNumber(user.code_loc_added)} | -${formatNumber(user.code_loc_deleted)}
                </span>
            </td>
            <td style="white-space: nowrap; text-align: left;">
                <span class="metric-high">${formatNumber(user.avg_loc_added_daily)}</span>
                ${prev ? diffBadge(user.avg_loc_added_daily, prev.avg_loc_added_daily, true) : ''}
                <br>
                <span style="font-size:0.75em;color:var(--text-muted);font-weight:400">loc/day</span>
            </td>
            <td style="white-space: nowrap;" title="${user.all_doc_languages_list && user.all_doc_languages_list.length ? 'Doc languages: ' + user.all_doc_languages_list.join(', ') : ''}">
                ${formatNumber(user.doc_loc_changed)}
                ${prev ? diffArrowOnly(user.doc_loc_changed, prev.doc_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    +${formatNumber(user.doc_loc_added)} | -${formatNumber(user.doc_loc_deleted)}
                </span>
            </td>
            <td style="white-space: nowrap;" title="${user.all_config_languages_list && user.all_config_languages_list.length ? 'Config languages: ' + user.all_config_languages_list.join(', ') : ''}">
                ${formatNumber(user.config_loc_changed)}
                ${prev ? diffArrowOnly(user.config_loc_changed, prev.config_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    +${formatNumber(user.config_loc_added)} | -${formatNumber(user.config_loc_deleted)}
                </span>
            </td>
            <td>
                <span style="font-size: 1.1em;">${formatNumber(user.turns)}</span>
                ${prev ? diffBadge(user.turns, prev.turns, true) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">🎯 ${user.acceptance_rate}</span>
            </td>
            <td style="white-space: nowrap;" title="${user.all_languages_list && user.all_languages_list.length ? 'Languages: ' + user.all_languages_list.join(', ') : ''}">${user.favorite_language}</td>
            <td style="white-space: nowrap;" title="${user.all_models_list && user.all_models_list.length ? 'Models: ' + user.all_models_list.join(', ') : ''}">${user.favorite_model}</td>
            <td style="white-space: nowrap;" title="${user.all_ides_list && user.all_ides_list.length ? 'IDEs: ' + user.all_ides_list.join(', ') : ''}">${user.favorite_ide}</td>
            <td>
                ${user.active_days_count}
                ${prev ? diffAbsBadge(user.active_days_count, prev.active_days_count) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    🤖 ${user.agent_days_count} | 💬 ${user.chat_days_count}
                </span>
            </td>
            <td style="color:var(--text-muted); font-size: 0.9em; white-space: nowrap;">${getFriendlyDate(user.last_active_day)}</td>
        `;

        // micro-animation for table rows
        tr.style.opacity = '0';
        tr.style.transform = 'translateX(-10px)';
        // Fast animation to not be annoying for large lists
        tr.style.transition = `opacity 0.2s ease, transform 0.2s ease`;

        // add brief delay only on initial load to avoid jank on sorting
        if (idx < 50) {
            tr.style.transitionDelay = `${Math.min(idx * 0.015, 0.5)}s`;
        }

        tbody.appendChild(tr);

        // Row click opens user detail popup
        tr.addEventListener('click', () => openUserModal(user));

        // Trigger reflow
        void tr.offsetWidth;
        tr.style.opacity = '1';
    });
}

function buildUserMetaSection(user) {
    const rows = [];
    if (user.all_languages_list && user.all_languages_list.length) {
        rows.push(`<div class="meta-row"><span class="meta-label">Languages:</span> ${user.all_languages_list.join(', ')}</div>`);
    }
    if (user.all_models_list && user.all_models_list.length) {
        rows.push(`<div class="meta-row"><span class="meta-label">Models:</span> ${user.all_models_list.join(', ')}</div>`);
    }
    if (!rows.length) return '';
    return `<div class="user-meta-section">${rows.join('')}</div>`;
}

// ── User detail modal ──

function openUserModal(user) {
    const overlay = document.getElementById('user-modal');
    let titleHTML = user.human_name + (user.team ? '  ·  ' + user.team : '');
    const ideParts = [];
    if (user.last_ide_name) {
        ideParts.push(user.last_ide_version ? `${user.last_ide_name} ${user.last_ide_version}` : user.last_ide_name);
    }
    if (user.last_plugin && user.last_plugin_version) {
        ideParts.push(`${user.last_plugin} ${user.last_plugin_version}`);
    } else if (user.last_plugin) {
        ideParts.push(user.last_plugin);
    }
    if (ideParts.length) {
        titleHTML += `<span style="font-size:0.8em;color:var(--text-muted);font-weight:400">  ·  ${ideParts.join(', ')}</span>`;
    }
    document.getElementById('modal-title').innerHTML = titleHTML;
    document.getElementById('modal-body').innerHTML = buildCombinedChart(user.daily || []) + buildUserMetaSection(user);
    overlay.style.display = 'flex';

    function close() {
        overlay.style.display = 'none';
        overlay.removeEventListener('click', onOverlay);
        document.getElementById('modal-close').removeEventListener('click', close);
        document.removeEventListener('keydown', onKey);
    }
    function onOverlay(e) { if (e.target === overlay) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    overlay.addEventListener('click', onOverlay);
    document.getElementById('modal-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
}

// ── Daily Active Users chart ──

function computeDAU(users, days = 30) {
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const dayCountMap = {};
    for (const u of users) {
        if (Array.isArray(u.daily)) {
            for (const d of u.daily) {
                dayCountMap[d.day] = (dayCountMap[d.day] || 0) + 1;
            }
        }
    }
    const allDays = Object.keys(dayCountMap).sort();
    if (!allDays.length) return [];
    const endDate = new Date(allDays[allDays.length - 1] + 'T00:00:00');
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
        const dt = new Date(endDate);
        dt.setDate(endDate.getDate() - i);
        const iso = localISODate(dt);
        result.push({
            day: iso,
            count: dayCountMap[iso] || 0,
            dow: dayNames[dt.getDay()],
            isWeekend: dt.getDay() === 0 || dt.getDay() === 6
        });
    }
    return result;
}

function buildDAUChart(users) {
    const data = computeDAU(users, 31);
    if (!data.length) return '<p style="color:var(--text-muted)">No data available.</p>';
    const maxCount = Math.max(...data.map(d => d.count), 1);
    const chartH = 120;
    let bars = '';
    for (const d of data) {
        const h = Math.round((d.count / maxCount) * chartH);
        const parts = d.day.split('-');
        const label = parts[2] + '.' + parts[1];
        const dowStyle = d.isWeekend ? 'color:rgba(239,68,68,0.5)' : '';
        bars += `
            <div class="bar-col-combined" title="${d.day}: ${d.count} active user${d.count !== 1 ? 's' : ''}">
                <div class="bar-area" style="height:${chartH}px">
                    <div class="bar-stack" style="height:${h}px">
                        <div class="bar-seg-dau" style="height:${h}px"></div>
                    </div>
                    ${d.count ? `<div class="dau-count-label" style="bottom:${h + 3}px">${d.count}</div>` : ''}
                </div>
                <span class="bar-label">${label}<br><span style="${dowStyle}">${d.dow}</span></span>
            </div>`;
    }
    return `<div class="combined-chart">${bars}</div>`;
}

function renderDAUChart() {
    const container = document.getElementById('dau-chart-container');
    if (!container) return;
    if (!globalUsers.length) { container.innerHTML = ''; return; }
    container.innerHTML = buildDAUChart(globalUsers);
}

function buildCombinedChart(daily) {
    if (!daily.length) return '<p style="color:var(--text-muted)">No daily data available.</p>';

    const allDays = fillDailyGaps(daily);

    const maxLoc = Math.max(...allDays.map(d => (d.code_loc||0) + (d.doc_loc||0) + (d.config_loc||0)), 1);
    const maxTurns = Math.max(...allDays.map(d => d.user_initiated + d.code_generation), 1);
    const chartH = 170;

    let bars = '';
    for (const d of allDays) {
        const codeLoc = d.code_loc || 0;
        const docLoc = d.doc_loc || 0;
        const configLoc = d.config_loc || 0;
        const totalLoc = codeLoc + docLoc + configLoc;
        const locBottom = Math.round((totalLoc / maxLoc) * chartH);

        const turnsTotal = d.user_initiated + d.code_generation;
        const hUser = Math.round((d.user_initiated / maxTurns) * chartH);
        const hGen  = Math.round((d.code_generation / maxTurns) * chartH);

        const parts = d.day.split('-');
        const label = parts[2] + '.' + parts[1];
        const dowStyle = d.isWeekend ? 'color:rgba(239,68,68,0.5)' : '';

        const locTitle = `LOC: ${formatNumber(totalLoc)} (Code: ${formatNumber(codeLoc)}, Doc: ${formatNumber(docLoc)}, Config: ${formatNumber(configLoc)})`;
        const turnsTitle = `Turns: ${turnsTotal} (User: ${d.user_initiated}, CodeGen: ${d.code_generation})`;

        bars += `
            <div class="bar-col-combined" title="${turnsTitle}">
                <div class="bar-area" style="height:${chartH}px">
                    <div class="bar-stack" style="height:${hUser + hGen}px">
                        <div class="bar-seg-user" style="height:${hUser}px"></div>
                        <div class="bar-seg-codegen" style="height:${hGen}px"></div>
                    </div>
                    ${totalLoc ? `<div class="loc-step" style="bottom:${locBottom}px" title="${locTitle}"><span class="loc-val">${formatNumber(totalLoc)}</span></div>` : ''}
                </div>
                <span class="bar-label">${label}<br><span style="${dowStyle}">${d.dow}</span></span>
            </div>`;
    }

    return `
        <div class="combined-chart">${bars}</div>
        <div class="chart-legend">
            <span><span class="legend-dot" style="background:#818cf8"></span>Chat asks</span>
            <span><span class="legend-dot" style="background:#38bdf8"></span>Agent runs</span>
            <span style="margin-left:0.5rem;padding-left:0.75rem;border-left:1px solid rgba(255,255,255,0.1)"><span class="legend-line"></span>LOC changed</span>
        </div>`;
}

function fillDailyGaps(daily) {
    const dayMap = {};
    for (const d of daily) dayMap[d.day] = d;

    const startDate = new Date(daily[0].day + 'T00:00:00');
    const endDate = new Date(daily[daily.length - 1].day + 'T00:00:00');
    const allDays = [];
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let dt = new Date(startDate); dt <= endDate; dt.setDate(dt.getDate() + 1)) {
        const iso = localISODate(dt);
        const entry = dayMap[iso] || { day: iso, user_initiated: 0, code_generation: 0, code_loc: 0, doc_loc: 0, config_loc: 0 };
        entry.dow = dayNames[dt.getDay()];
        entry.isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
        allDays.push(entry);
    }
    return allDays;
}

