let globalUsers = [];
let currentSortColumn = 'total_loc_changed';
let currentSortDesc = true;
let currentTeamFilter = '';
let currentSearchQuery = '';
let currentStatusFilter = 'active';
let prevMonthStats = null;
let prevMonthTotals = null;

// Show 🚀 instead of a numeric % badge when positive growth exceeds this threshold (%)
const ROCKET_THRESHOLD = 200;

// Number of days shown in the rolling DAU window and per-user detail chart (all-time mode)
const DAU_WINDOW_DAYS = 30;

// Pixel height of the bar drawing area in the org-level DAU chart
const DAU_CHART_HEIGHT = 120;

// Pixel height of the bar drawing area in the per-user detail (combined turns/LOC) chart
const USER_CHART_HEIGHT = 170;

// Maximum individually labelled slices in a donut chart; everything beyond is rolled into "Other"
const DONUT_MAX_SEGMENTS = 8;

// Minimum slice share (%) to render a percentage label directly on the donut ring
const DONUT_LABEL_MIN_PCT = 5;

// Minimum slice share (%) to render a callout leader line and text outside the ring
const DONUT_CALLOUT_MIN_PCT = 3;

// Row index limit: entrance animation is staggered only for the first N table rows to avoid jank on large lists
const TABLE_ANIM_ROW_LIMIT = 50;

// Per-row delay increment for staggered entrance animation (seconds)
const TABLE_ANIM_DELAY_STEP = 0.015;

// Maximum stagger delay cap so the last visible animated row never waits too long (seconds)
const TABLE_ANIM_DELAY_MAX = 0.5;

// Fuzzy search: accepted match window = query length × this multiplier (controls how spread-out matched chars can be)
const FUZZY_MATCH_SPREAD = 2;

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

// sign: +1 for added (show +N), -1 for deleted (show -N); zero is always unsigned
function signedLoc(n, sign) {
    if (!n) return '0';
    return (sign < 0 ? '-' : '+') + formatNumber(n);
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
        renderDAUChart();
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
        document.getElementById('users-body').innerHTML = `<tr><td colspan="12" class="loading">Failed to load data. Make sure backend is running.</td></tr>`;
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
        2: 'total_loc_changed',
        3: 'turns',
        4: 'doc_loc_changed',
        5: 'code_loc_changed',
        6: 'perf_score',
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
    return (lastMatch - firstMatch + 1) <= q.length * FUZZY_MATCH_SPREAD;
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
    if (!isFinite(pct) || pct > ROCKET_THRESHOLD) {
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
    const filteredOutput = sortedUsers.reduce((acc, u) => acc + u.total_suggested_changed + u.total_loc_changed, 0);
    const filteredInteractions = sortedUsers.reduce((acc, u) => acc + u.turns, 0);
    document.getElementById('stat-total-users').textContent = formatNumber(sortedUsers.length);
    document.getElementById('stat-total-interactions').textContent = formatNumber(filteredInteractions);
    document.getElementById('stat-total-loc').textContent = formatNumber(filteredOutput);

    // Update header diff badges — compute prev totals from same filtered user set
    let prevFilteredUsers = 0, prevFilteredInteractions = 0, prevFilteredLoc = 0;
    if (prevMonthStats) {
        for (const u of sortedUsers) {
            const p = prevMonthStats[u.user_login];
            if (p) {
                prevFilteredUsers++;
                prevFilteredInteractions += p.turns || 0;
                prevFilteredLoc += (p.total_suggested_changed || 0) + (p.total_loc_changed || 0);
            }
        }
    }
    document.getElementById('stat-diff-users').innerHTML = prevMonthStats ? diffAbsBadge(sortedUsers.length, prevFilteredUsers) : '';
    document.getElementById('stat-diff-interactions').innerHTML = prevMonthStats ? diffBadge(filteredInteractions, prevFilteredInteractions, true) : '';
    document.getElementById('stat-diff-loc').innerHTML = prevMonthStats ? diffBadge(filteredOutput, prevFilteredLoc, true) : '';

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

    renderDonutSection(sortedUsers);

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
            <td style="color: var(--text-muted); font-size: 0.9em;">
                ${lineNumber}
            </td>
            <td>
                <div class="user-cell" style="white-space: nowrap; flex-direction: column; align-items: flex-start; gap: 0.1rem;">
                    <span style="font-weight: 600;">${user.human_name}${revokedMark}${newUserMark}</span>
                    <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.user_login}</span>
                    <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.team || ''}</span>
                </div>
            </td>
            <!-- Output: grand total (suggested+applied) | 💡 suggested LOC | ✏️ applied LOC -->
            <td style="white-space: nowrap;" title="Grand total = suggested + applied LOC&#10;💡 Suggested LOC = loc_suggested_to_add + loc_suggested_to_delete&#10;✏️ Applied LOC = loc_added + loc_deleted">
                ${formatNumber(user.total_suggested_changed + user.total_loc_changed)}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">💡 ${formatNumber(user.total_suggested_changed)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">✏️ ${formatNumber(user.total_loc_changed)}</span>
            </td>
            <!-- Turns: total interactions | 🏃 output LOC per turn | 🎯 acceptance rate -->
            <td title="Total interaction turns&#10;🏃 Output LOC per turn (suggested + applied)&#10;🎯 Acceptance Rate: code_acceptance_activity / code_generation_activity">
                <span class="metric-high" style="font-size: 1.1em;">${formatNumber(user.turns)}</span>
                ${prev ? diffBadge(user.turns, prev.turns, true) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${user.turns > 0 ? '🏃\u202f' + formatNumber(Math.round((user.total_suggested_changed + user.total_loc_changed) / user.turns)) : '🏃 —'}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">🎯 ${user.acceptance_rate}</span>
            </td>
            <td style="white-space: nowrap;" title="${user.all_doc_languages_list && user.all_doc_languages_list.length ? 'Doc languages: ' + user.all_doc_languages_list.join(', ') : ''}">
                ${formatNumber(user.doc_loc_changed)}
                ${prev ? diffArrowOnly(user.doc_loc_changed, prev.doc_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${signedLoc(user.doc_loc_added, 1)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${signedLoc(user.doc_loc_deleted, -1)}</span>
            </td>
            <td style="white-space: nowrap;">
                ${formatNumber(user.code_loc_changed)}
                ${prev ? diffBadge(user.code_loc_changed, prev.code_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${signedLoc(user.code_loc_added, 1)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${signedLoc(user.code_loc_deleted, -1)}</span>
            </td>
            <td style="white-space: nowrap;" title="PERF = max(code added, code deleted) / active days&#10;${formatNumber(user.perf_score)} loc/day">
                <span>${formatNumber(user.perf_score)}</span>
                ${prev ? diffBadge(user.perf_score, prev.perf_score, true) : ''}
            </td>
            <td style="max-width: 7rem;" title="${user.all_languages_list && user.all_languages_list.length ? 'Languages: ' + user.all_languages_list.join(', ') : ''}">${user.favorite_language}</td>
            <td style="max-width: 8rem; overflow-wrap: break-word;" title="${user.all_models_list && user.all_models_list.length ? 'Models: ' + user.all_models_list.join(', ') : ''}">${user.favorite_model}</td>
            <td style="white-space: nowrap;" title="${user.all_ides_list && user.all_ides_list.length ? 'IDEs: ' + user.all_ides_list.join(', ') : ''}">${user.favorite_ide}</td>
            <td>
                ${user.active_days_count}
                ${prev ? diffAbsBadge(user.active_days_count, prev.active_days_count) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">🤖 ${user.agent_days_count}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">💬 ${user.chat_days_count}</span>
            </td>
            <td style="color:var(--text-muted); font-size: 0.9em; white-space: nowrap;">${getFriendlyDate(user.last_active_day)}</td>
        `;

        // micro-animation for table rows
        tr.style.opacity = '0';
        tr.style.transform = 'translateX(-10px)';
        // Fast animation to not be annoying for large lists
        tr.style.transition = `opacity 0.2s ease, transform 0.2s ease`;

        // add brief delay only on initial load to avoid jank on sorting
        if (idx < TABLE_ANIM_ROW_LIMIT) {
            tr.style.transitionDelay = `${Math.min(idx * TABLE_ANIM_DELAY_STEP, TABLE_ANIM_DELAY_MAX)}s`;
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
    if (user.all_ides_list && user.all_ides_list.length) {
        const ideLabels = user.all_ides_list.map(ide => {
            const v = user.ide_versions && user.ide_versions[ide];
            if (v) {
                const detail = [];
                if (v.ide_version) detail.push(v.ide_version);
                if (v.plugin && v.plugin_version) detail.push(`${v.plugin} ${v.plugin_version}`);
                else if (v.plugin) detail.push(v.plugin);
                return detail.length ? `${ide} <span style="color:var(--text-muted);font-size:0.9em">(${detail.join(', ')})</span>` : ide;
            }
            return ide;
        });
        rows.push(`<div class="meta-row"><span class="meta-label">IDEs:</span> ${ideLabels.join(', ')}</div>`);
    }
    if (!rows.length) return '';
    return `<div class="user-meta-section">${rows.join('')}</div>`;
}

// ── User detail modal ──

function openUserModal(user) {
    const overlay = document.getElementById('user-modal');
    let titleHTML = user.human_name + (user.team ? '  ·  ' + user.team : '') + `  ·  <span style="font-size:0.8em;color:var(--text-muted);font-weight:400">${user.user_login}</span>`;
    document.getElementById('modal-title').innerHTML = titleHTML;
    document.getElementById('modal-body').innerHTML = buildCombinedChart(user.daily || [], currentMonthFilter) + buildUserMetaSection(user);
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

function computeDAU(users, days = DAU_WINDOW_DAYS, month = '') {
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const dayCountMap = {};
    for (const u of users) {
        if (Array.isArray(u.daily)) {
            for (const d of u.daily) {
                dayCountMap[d.day] = (dayCountMap[d.day] || 0) + 1;
            }
        }
    }

    const result = [];

    if (month) {
        // Show every calendar day of the selected month
        const [yyyy, mm] = month.split('-').map(Number);
        const daysInMonth = new Date(yyyy, mm, 0).getDate(); // day 0 of next month = last day of this month
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(yyyy, mm - 1, d);
            const iso = localISODate(dt);
            result.push({
                day: iso,
                count: dayCountMap[iso] || 0,
                dow: dayNames[dt.getDay()],
                isWeekend: dt.getDay() === 0 || dt.getDay() === 6
            });
        }
    } else {
        // All-time: last 30 days counting back from the latest day that has any data
        const allDays = Object.keys(dayCountMap).sort();
        if (!allDays.length) return [];
        const endDate = new Date(allDays[allDays.length - 1] + 'T00:00:00');
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
    }

    return result;
}

function buildDAUChart(users, totalUsers, month) {
    const total = totalUsers || users.length;
    const data = computeDAU(users, 30, month || '');
    if (!data.length) return '<p style="color:var(--text-muted)">No data available.</p>';
    const maxCount = Math.max(...data.map(d => d.count), 1);
    const chartH = DAU_CHART_HEIGHT;
    let bars = '';
    for (const d of data) {
        const h = Math.round((d.count / maxCount) * chartH);
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
        const parts = d.day.split('-');
        const label = parts[2] + '.' + parts[1];
        const dowStyle = d.isWeekend ? 'color:rgba(239,68,68,0.5)' : '';
        bars += `
            <div class="bar-col-combined" title="${d.day}: ${d.count} active user${d.count !== 1 ? 's' : ''} (${pct}% of ${total})">
                <div class="bar-area" style="height:${chartH}px">
                    <div class="bar-stack" style="height:${h}px">
                        <div class="bar-seg-dau" style="height:${h}px"></div>
                    </div>
                    ${d.count ? `<div class="dau-count-label" style="bottom:${h + 3}px">${d.count}<br><span style="font-size:0.75em;opacity:0.65">${pct}%</span></div>` : ''}
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
    const filteredUsers = currentTeamFilter ? globalUsers.filter(u => u.team === currentTeamFilter) : globalUsers;
    container.innerHTML = buildDAUChart(filteredUsers, filteredUsers.length, currentMonthFilter);
    const avgStat = document.getElementById('dau-avg-stat');
    if (avgStat) {
        const data = computeDAU(filteredUsers, 30, currentMonthFilter);
        const activeBizDays = data.filter(d => !d.isWeekend && d.count > 0);
        if (activeBizDays.length) {
            const total = filteredUsers.length;
            const dauSum = activeBizDays.reduce((s, d) => s + d.count, 0);
            const avgDAU = Math.round(dauSum / activeBizDays.length);
            const pct = total > 0 ? Math.round(avgDAU / total * 100) : 0;

            // avg turns per user = total turns ÷ total users in period
            const totalTurns = filteredUsers.reduce((s, u) => s + (u.turns || 0), 0);
            const avgTurns = total > 0 ? Math.round(totalTurns / total) : 0;

            // avg perf = sum of individual perf_scores ÷ number of users who have any active days
            const activeUsers = filteredUsers.filter(u => (u.active_days_count || 0) > 0);
            const avgPerf = activeUsers.length > 0
                ? Math.round(activeUsers.reduce((s, u) => s + (u.perf_score || 0), 0) / activeUsers.length)
                : 0;

            // prev-month equivalents (only available when a month is selected)
            let prevAvgTurns = null, prevAvgPerf = null;
            if (prevMonthStats) {
                const prevUsers = filteredUsers.map(u => prevMonthStats[u.user_login]).filter(Boolean);
                if (prevUsers.length) {
                    prevAvgTurns = Math.round(prevUsers.reduce((s, p) => s + (p.turns || 0), 0) / prevUsers.length);
                    const prevActive = prevUsers.filter(p => (p.active_days_count || 0) > 0);
                    prevAvgPerf = prevActive.length > 0
                        ? Math.round(prevActive.reduce((s, p) => s + (p.perf_score || 0), 0) / prevActive.length)
                        : 0;
                }
            }

            avgStat.innerHTML = `
                <div style="display:flex;gap:1.5rem;align-items:flex-start">
                    <div style="text-align:right">
                        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:2px">Avg DAU</div>
                        <div style="font-size:1rem;color:var(--text-main);font-weight:600;line-height:1;white-space:nowrap">${avgDAU}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">${pct}%</div>
                    </div>
                    <div style="width:1px;background:rgba(255,255,255,0.1);align-self:stretch"></div>
                    <div style="text-align:right">
                        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:2px">Avg Turns</div>
                        <div style="font-size:1rem;color:var(--fame-color);font-weight:600;line-height:1;white-space:nowrap">${formatNumber(avgTurns)} ${diffBadge(avgTurns, prevAvgTurns, true)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">per user</div>
                    </div>
                    <div style="width:1px;background:rgba(255,255,255,0.1);align-self:stretch"></div>
                    <div style="text-align:right">
                        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:2px">Avg Perf</div>
                        <div style="font-size:1rem;color:var(--text-main);font-weight:600;line-height:1;white-space:nowrap">${formatNumber(avgPerf)} ${diffBadge(avgPerf, prevAvgPerf, true)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">LOC / user / day</div>
                    </div>
                </div>`;
        } else {
            avgStat.innerHTML = '';
        }
    }
}

function buildCombinedChart(daily, month) {
    if (!daily.length && !month) return '<p style="color:var(--text-muted)">No daily data available.</p>';

    const allDays = fillDailyGaps(daily, month);

    const maxLoc = Math.max(...allDays.map(d => (d.code_loc||0) + (d.doc_loc||0)), 1);
    const maxTurns = Math.max(...allDays.map(d => d.user_initiated + d.code_generation), 1);
    const chartH = USER_CHART_HEIGHT;

    let bars = '';
    for (const d of allDays) {
        const codeLoc = d.code_loc || 0;
        const docLoc = d.doc_loc || 0;
        const totalLoc = codeLoc + docLoc;
        const locBottom = Math.round((totalLoc / maxLoc) * chartH);

        const turnsTotal = d.user_initiated + d.code_generation;
        const hUser = Math.round((d.user_initiated / maxTurns) * chartH);
        const hGen  = Math.round((d.code_generation / maxTurns) * chartH);

        const parts = d.day.split('-');
        const label = parts[2] + '.' + parts[1];
        const dowStyle = d.isWeekend ? 'color:rgba(239,68,68,0.5)' : '';

        const locTitle = `LOC: ${formatNumber(totalLoc)} (Code: ${formatNumber(codeLoc)}, Doc: ${formatNumber(docLoc)})`;
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
            <span style="margin-left:0.5rem;padding-left:0.75rem;border-left:1px solid rgba(255,255,255,0.1)"><span class="legend-line"></span>Total LOC coding</span>
        </div>`;
}

function fillDailyGaps(daily, month) {
    const dayMap = {};
    for (const d of daily) dayMap[d.day] = d;
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const allDays = [];

    if (month) {
        // Show every calendar day of the selected month
        const [yyyy, mm] = month.split('-').map(Number);
        const daysInMonth = new Date(yyyy, mm, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dt = new Date(yyyy, mm - 1, day);
            const iso = localISODate(dt);
            const entry = dayMap[iso] || { day: iso, user_initiated: 0, code_generation: 0, code_loc: 0, doc_loc: 0 };
            entry.dow = dayNames[dt.getDay()];
            entry.isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
            allDays.push(entry);
        }
    } else {
        // All-time: last 30 days counting back from the latest day with data
        if (!daily.length) return [];
        const sortedDays = [...daily].sort((a, b) => a.day.localeCompare(b.day));
        const endDate = new Date(sortedDays[sortedDays.length - 1].day + 'T00:00:00');
        for (let i = DAU_WINDOW_DAYS - 1; i >= 0; i--) {
            const dt = new Date(endDate);
            dt.setDate(endDate.getDate() - i);
            const iso = localISODate(dt);
            const entry = dayMap[iso] || { day: iso, user_initiated: 0, code_generation: 0, code_loc: 0, doc_loc: 0 };
            entry.dow = dayNames[dt.getDay()];
            entry.isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
            allDays.push(entry);
        }
    }
    return allDays;
}

// ── LOC Breakdown Donut Charts ──

const DONUT_COLORS = [
    '#818cf8', '#38bdf8', '#34d399', '#f59e0b',
    '#f87171', '#a78bfa', '#fb923c', '#4ade80',
    '#e879f9', '#94a3b8'
];

function buildDonutChart(locMap, title, splitFn) {
    if (!splitFn) splitFn = label => label.split('_');
    const entries = Object.entries(locMap)
        .map(([label, value]) => ({ label, value }))
        .filter(d => d.value > 0)
        .sort((a, b) => b.value - a.value);

    if (!entries.length) {
        return `<div class="donut-card glass"><h3 class="donut-title">${title}</h3><p class="donut-empty">No data</p></div>`;
    }

    const MAX = DONUT_MAX_SEGMENTS;
    let segments = entries.slice(0, MAX);
    if (entries.length > MAX) {
        const rest = entries.slice(MAX).reduce((s, d) => s + d.value, 0);
        segments.push({ label: 'Other', value: rest });
    }

    const total = segments.reduce((s, d) => s + d.value, 0);

    // Geometry — circle centered at origin, viewBox gives label room on all sides
    const r = 130, sw = 44;
    const C = 2 * Math.PI * r;
    const GAP = 2;
    const outerR    = r + sw / 2;       // 152 — outer edge of ring
    const kneeR     = outerR + 18;      // 170 — tip of radial leader
    const elbowExt  = 26;               // horizontal run of elbow
    const textOff   = 6;                // gap between elbow end and text

    let svgSegs   = '';
    let svgLabels = '';
    let startDeg  = -90;                // degrees, top of circle
    let startRad  = -Math.PI / 2;       // radians, matching startDeg

    segments.forEach((d, i) => {
        const pct        = d.value / total;
        const pctDisplay = Math.round(pct * 100);
        if (pctDisplay === 0) { startDeg += pct * 360; startRad += pct * 2 * Math.PI; return; }

        const color   = DONUT_COLORS[i % DONUT_COLORS.length];
        const dashLen = Math.max(0, pct * C - GAP);

        const midRad = startRad + pct * Math.PI;
        const cosA   = Math.cos(midRad);
        const sinA   = Math.sin(midRad);

        // Arc segment wrapped in <g> with <title> for native hover tooltip
        svgSegs += `<g><title>${d.label}: ${pctDisplay}%</title><circle cx="0" cy="0" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${dashLen.toFixed(2)} ${C.toFixed(2)}" transform="rotate(${startDeg.toFixed(2)})" /></g>`;

        // Percentage text on the ring for segments >= 5%
        if (pctDisplay >= DONUT_LABEL_MIN_PCT) {
            const lx = r * cosA;
            const ly = r * sinA;
            svgSegs += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="19" font-weight="700" font-family="Inter,sans-serif" pointer-events="none">${pctDisplay}%</text>`;
        }

        // Callout label (name only, truncated; full name available on hover via <title>)
        if (pctDisplay >= DONUT_CALLOUT_MIN_PCT) {
            const sx = (outerR + 3) * cosA;
            const sy = (outerR + 3) * sinA;
            const kx = kneeR * cosA;
            const ky = kneeR * sinA;

            const isRight = cosA >= 0;
            const ex      = kx + (isRight ? elbowExt : -elbowExt);
            const ey      = ky;
            const tx      = ex + (isRight ? textOff : -textOff);
            const anchor  = isRight ? 'start' : 'end';

            const parts = splitFn(d.label);
            const lineH = 13; // px between tspan lines
            const totalH = (parts.length - 1) * lineH;
            const tspans = parts.map((p, pi) => {
                const dy = pi === 0 ? (-totalH / 2).toFixed(1) : lineH;
                return `<tspan x="${tx.toFixed(1)}" dy="${dy}">${p}</tspan>`;
            }).join('');

            svgLabels += `
                <line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${kx.toFixed(1)}" y2="${ky.toFixed(1)}" stroke="${color}" stroke-width="1.3" opacity="0.5"/>
                <line x1="${kx.toFixed(1)}" y1="${ky.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="1.3" opacity="0.5"/>
                <text x="${tx.toFixed(1)}" y="${ey.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="central" fill="rgba(255,255,255,0.7)" font-size="12" font-family="Inter,sans-serif">
                    <title>${d.label}: ${pctDisplay}%</title>${tspans}
                </text>`;
        }

        startDeg += pct * 360;
        startRad += pct * 2 * Math.PI;
    });

    // viewBox: ±(outerR + kneeRun + elbowExt + textOff + ~80px text) → ±270 → 540 total
    return `<div class="donut-card glass">
        <h3 class="donut-title">${title}</h3>
        <svg class="donut-svg" viewBox="-270 -260 540 520" width="100%">
            <circle cx="0" cy="0" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${sw}" />
            ${svgSegs}
            ${svgLabels}
        </svg>
    </div>`;
}

function renderDonutSection(filteredUsers) {
    const locByModel = {};
    const locByCodeLanguage = {};
    const locByDocLanguage = {};
    const locByIde = {};
    const locByFeature = {};
    let totalCodeLoc = 0;
    let totalDocLoc = 0;

    for (const u of filteredUsers) {
        if (u.loc_by_model) {
            for (const [m, loc] of Object.entries(u.loc_by_model)) {
                locByModel[m] = (locByModel[m] || 0) + loc;
            }
        }
        if (u.loc_by_code_language) {
            for (const [l, loc] of Object.entries(u.loc_by_code_language)) {
                locByCodeLanguage[l] = (locByCodeLanguage[l] || 0) + loc;
            }
        }
        if (u.loc_by_doc_language) {
            for (const [l, loc] of Object.entries(u.loc_by_doc_language)) {
                locByDocLanguage[l] = (locByDocLanguage[l] || 0) + loc;
            }
        }
        if (u.loc_by_ide) {
            for (const [i, loc] of Object.entries(u.loc_by_ide)) {
                locByIde[i] = (locByIde[i] || 0) + loc;
            }
        }
        if (u.loc_by_feature) {
            for (const [f, loc] of Object.entries(u.loc_by_feature)) {
                locByFeature[f] = (locByFeature[f] || 0) + loc;
            }
        }
        totalCodeLoc += (u.code_loc_changed || 0);
        totalDocLoc  += (u.doc_loc_changed  || 0);
    }

    const locByActivity = {};
    if (totalCodeLoc > 0) locByActivity['Coding']   = totalCodeLoc;
    if (totalDocLoc  > 0) locByActivity['Steering'] = totalDocLoc;

    const splitModelLabel = label => { const f = label.indexOf('-'); if (f === -1) return [label]; const s = label.indexOf('-', f + 1); return s === -1 ? [label] : [label.slice(0, s), label.slice(s + 1)]; };
    document.getElementById('donut-model').innerHTML    = buildDonutChart(locByModel,        'by Model', splitModelLabel);
    document.getElementById('donut-language').innerHTML = buildDonutChart(locByFeature,      'by Feature');
    document.getElementById('donut-ide').innerHTML      = buildDonutChart(locByIde,          'by IDE');
    document.getElementById('donut-activity').innerHTML = buildDonutChart(locByActivity,     'by Activity');
    document.getElementById('donut-feature').innerHTML  = buildDonutChart(locByCodeLanguage, 'Coding by Language');
    document.getElementById('donut-syntax').innerHTML   = buildDonutChart(locByDocLanguage,  'Steering by Syntax');
}

