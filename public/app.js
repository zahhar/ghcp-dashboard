let globalUsers = [];
let globalTeams = {}; // team id → { id, title, unit } — populated from availableTeams response
let globalLastDay = ''; // last active day across all users in current dataset
let currentSortColumn = 'total_output';
let currentSortDesc = true;
let currentTeamFilter = '';
let currentScopeFilter = ''; // 'e:ID' = enterprise, 'o:ID' = organization
let currentSearchQuery = '';
let currentStatusFilter = 'active';
let currentManagerFilter = '';
let prevMonthStats = null;
let prevMonthTotals = null;
let watchModelUse = []; // model names from config.watch_model_use
let watchModelUseGroups = {}; // grouped model names from config.watch_model_use
let globalPreferredEnterpriseIds = []; // enterprise IDs with preferred_license: true in config.json

let globalManagers = []; // distinct manager names from teams data

const PHASE_LABELS = {
    0: '0: No cohort',
    1: '1: Code first',
    2: '2: Agent first',
    3: '3: Multi-agent'
};

const PHASE_DESCRIPTIONS = {
    0: 'Phase 0 — No cohort: User did not meet the engagement criteria for any phase',
    1: 'Phase 1 — Code first: Engaged with code completion and/or IDE agent mode (at least 2 days in the last 28-day window)',
    2: 'Phase 2 — Agent first: Engaged with a single GitHub-based agent surface — Copilot cloud agent, code review, or CLI (at least 2 days)',
    3: 'Phase 3 — Multi-agent: Engaged with two or more GitHub-based agent surfaces, or with the new GitHub Copilot app'
};

function normalizeWatchModelUseConfig(raw) {
    const flat = [];
    const groups = {};
    const seen = new Set();

    const addModel = (model) => {
        const value = String(model || '').trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        flat.push(value);
    };

    if (Array.isArray(raw)) {
        raw.forEach(addModel);
    } else if (raw && typeof raw === 'object') {
        for (const [groupName, models] of Object.entries(raw)) {
            if (!Array.isArray(models)) continue;
            groups[groupName] = [];
            for (const model of models) {
                const value = String(model || '').trim();
                if (!value) continue;
                groups[groupName].push(value);
                addModel(value);
            }
        }
    }

    return { flat, groups };
}

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

// ── Version comparison helpers ──

// Convert a version string to a comparable integer.
// Takes the part before the first dash (e.g. "1.9.0-251" → "1.9.0"), removes dots, returns integer.
// Returns -1 for null / unparseable values.
function versionToInt(v) {
    if (!v || typeof v !== 'string') return -1;
    const base = v.split('-')[0];
    // Parse each dot-separated segment; skip non-numeric parts (e.g. Eclipse build qualifier "v20260601")
    const parts = base.split('.').map(p => parseInt(p, 10)).filter(n => !isNaN(n));
    if (!parts.length) return -1;
    const p0 = parts[0] || 0;
    const p1 = parts[1] || 0;
    // Cap patch to 99999 so build-date segments like "2026061502" don't overtake a newer X.Y+1.0
    const p2 = Math.min(parts[2] || 0, 99999);
    return p0 * 100000000000 + p1 * 1000000 + p2;
}

// Module-level cache of the latest (max) version per IDE, per plugin, and for CLI,
// computed from the currently filtered user set. Populated by renderDonutSection.
let latestVersions = { ides: {}, plugins: {}, cli: -1 };

// Recomputes latestVersions from the given user set (should be ALL API users, not filtered).
function updateLatestVersions(users) {
    const target = { ides: {}, plugins: {}, cli: -1 };
    function _scan(ideVersionsMap) {
        for (const [ide, v] of Object.entries(ideVersionsMap)) {
            if (v.ide_version) {
                const n = versionToInt(v.ide_version);
                if (n > (target.ides[ide] ?? -1)) target.ides[ide] = n;
            }
            if (v.plugin && v.plugin_version) {
                const n = versionToInt(v.plugin_version);
                if (n > (target.plugins[v.plugin] ?? -1)) target.plugins[v.plugin] = n;
            }
        }
    }
    for (const u of users) {
        if (u.account_ides && Object.keys(u.account_ides).length > 0) {
            for (const acct of Object.values(u.account_ides)) {
                if (acct.ide_versions) _scan(acct.ide_versions);
            }
        } else if (u.ide_versions) {
            _scan(u.ide_versions);
        }
        if (u.account_cli && Object.keys(u.account_cli).length > 0) {
            for (const cliVer of Object.values(u.account_cli)) {
                if (cliVer) { const n = versionToInt(cliVer); if (n > target.cli) target.cli = n; }
            }
        } else if (u.cli_version) {
            const n = versionToInt(u.cli_version);
            if (n > target.cli) target.cli = n;
        }
    }
    latestVersions = target;
}

// Returns true if any of the user's accounts (IDE or CLI) is below the
// period-maximum version stored in `latestVersions`.
// Always uses per-account data so that a user with one up-to-date and one
// outdated account is correctly flagged.
function userHasAnyOutdated(u) {
    const acctIdes = u.account_ides && Object.keys(u.account_ides).length > 0
        ? Object.values(u.account_ides)
        : (u.ide_versions ? [{ ide_versions: u.ide_versions }] : []);
    for (const acct of acctIdes) {
        if (!acct.ide_versions) continue;
        for (const [ide, v] of Object.entries(acct.ide_versions)) {
            if (v.ide_version) {
                const latest = latestVersions.ides[ide] ?? -1;
                if (latest > 0 && versionToInt(v.ide_version) < latest) return true;
            }
            if (v.plugin && v.plugin_version) {
                const latest = latestVersions.plugins[v.plugin] ?? -1;
                if (latest > 0 && versionToInt(v.plugin_version) < latest) return true;
            }
        }
    }
    const cliVersions = u.account_cli && Object.keys(u.account_cli).length > 0
        ? Object.values(u.account_cli).filter(Boolean)
        : (u.cli_version ? [u.cli_version] : []);
    for (const cliVer of cliVersions) {
        if (latestVersions.cli > 0 && versionToInt(cliVer) < latestVersions.cli) return true;
    }
    return false;
}

// Returns the ide_versions entry for the user's favorite_ide, searching across all accounts.
function getPrimaryIdeVersionInfo(u) {
    const fav = u.favorite_ide_raw;
    if (!fav) return null;
    // User-level ide_versions aggregates across all accounts — simplest and most reliable.
    if (u.ide_versions && u.ide_versions[fav]) return u.ide_versions[fav];
    // Fallback: search per-account data.
    if (u.account_ides) {
        for (const acct of Object.values(u.account_ides)) {
            const v = acct.ide_versions && acct.ide_versions[fav];
            if (v) return v;
        }
    }
    return null;
}

// Returns true if the user's primary (favorite) IDE or its plugin is outdated.
function isPrimaryIdeOutdated(u) {
    const fav = u.favorite_ide_raw;
    if (!fav) return false;
    if (fav === 'cli') {
        if (!u.cli_version) return false;
        return latestVersions.cli > 0 && versionToInt(u.cli_version) < latestVersions.cli;
    }
    const v = getPrimaryIdeVersionInfo(u);
    if (!v) return false;
    if (v.ide_version) {
        const latest = latestVersions.ides[fav] ?? -1;
        if (latest > 0 && versionToInt(v.ide_version) < latest) return true;
    }
    if (v.plugin && v.plugin_version) {
        const latest = latestVersions.plugins[v.plugin] ?? -1;
        if (latest > 0 && versionToInt(v.plugin_version) < latest) return true;
    }
    return false;
}

// Builds the same HTML snippet shown for the primary IDE in the user popup,
// suitable for embedding in the custom hover tooltip.
function buildPrimaryIdeTooltipHTML(u) {
    const fav = u.favorite_ide_raw;
    if (!fav) return '';
    if (fav === 'cli') {
        if (!u.cli_version) return '';
        const outdated = latestVersions.cli > 0 && versionToInt(u.cli_version) < latestVersions.cli;
        const cliDetail = u.cli_version + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : '');
        const cliLabel = `CLI <span style="color:var(--text-muted);font-size:0.85em">(${cliDetail})</span>`;
        let cliHtml = `<span style="font-size:0.8em;color:var(--text-muted)"><b>IDE:</b> ${cliLabel}</span>`;
        if (u.all_ides_list && u.all_ides_list.length > 1) {
            cliHtml += `<div style="margin-top:6px;font-size:0.78em;color:var(--text-muted)">All IDEs: ${u.all_ides_list.join(', ')}</div>`;
        }
        return cliHtml;
    }
    const v = getPrimaryIdeVersionInfo(u);
    if (!v) return '';
    const detail = [];
    if (v.ide_version) {
        const latestN = latestVersions.ides[fav] ?? -1;
        const outdated = latestN > 0 && versionToInt(v.ide_version) < latestN;
        detail.push(v.ide_version + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : ''));
    }
    if (v.plugin && v.plugin_version) {
        const latestN = latestVersions.plugins[v.plugin] ?? -1;
        const outdated = latestN > 0 && versionToInt(v.plugin_version) < latestN;
        detail.push(`${v.plugin} ${v.plugin_version}` + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : ''));
    } else if (v.plugin) {
        detail.push(v.plugin);
    }
    if (!detail.length) return '';
    const ideLabel = `${fav} <span style="color:var(--text-muted);font-size:0.85em">(${detail.join(', ')})</span>`;
    let html = `<span style="font-size:0.8em;color:var(--text-muted)"><b>IDE:</b> ${ideLabel}</span>`;
    if (u.all_ides_list && u.all_ides_list.length > 1) {
        html += `<div style="margin-top:6px;font-size:0.78em;color:var(--text-muted)">All IDEs: ${u.all_ides_list.join(', ')}</div>`;
    }
    return html;
}

const DEFAULT_STATUS_FILTER = 'active';
const DEFAULT_SORT_COLUMN = 'total_output';
const DEFAULT_SORT_DESC = true;
const SORT_MAPPING = {
    0: null, // # is not sortable
    1: 'human_name',
    2: 'total_output',
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
const SORTABLE_COLUMNS = new Set(Object.values(SORT_MAPPING).filter(Boolean));

function isMonthToken(value) {
    return /^\d{4}-\d{2}$/.test(value || '');
}

function hasOption(selectEl, value) {
    return Array.from(selectEl.options).some(opt => opt.value === value);
}

function sanitizeStateFromUrl(state) {
    const normalized = { ...state };

    normalized.month = isMonthToken(normalized.month) ? normalized.month : '';
    normalized.team = normalized.team || '';
    normalized.scope = normalized.scope || '';
    normalized.search = (normalized.search || '').trim();
    normalized.status = (normalized.status === 'active' || normalized.status === 'revoked') ? normalized.status : '';

    if (normalized.phase !== '') {
        const phaseNum = parseInt(normalized.phase, 10);
        normalized.phase = [0, 1, 2, 3].includes(phaseNum) ? String(phaseNum) : '';
    }

    if (!SORTABLE_COLUMNS.has(normalized.sort)) {
        normalized.sort = DEFAULT_SORT_COLUMN;
        normalized.desc = DEFAULT_SORT_DESC;
    } else {
        normalized.desc = !!normalized.desc;
    }

    return normalized;
}

function parseStateFromUrl() {
    const url = new URL(window.location.href);
    const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map(s => decodeURIComponent(s));

    let team = '';
    let month = '';

    if (segments.length === 1) {
        if (isMonthToken(segments[0])) month = segments[0];
        else if (segments[0].toLowerCase() !== 'all') team = segments[0];
    } else if (segments.length >= 2) {
        const first = segments[0];
        const second = segments[1];
        if (isMonthToken(first)) {
            month = first;
            if (second && second.toLowerCase() !== 'all') team = second;
        } else {
            if (first && first.toLowerCase() !== 'all') team = first;
            if (isMonthToken(second)) month = second;
        }
    }

    const rawDesc = url.searchParams.get('desc');
    const desc = rawDesc == null
        ? DEFAULT_SORT_DESC
        : ['1', 'true', 'yes'].includes(rawDesc.toLowerCase());

    return sanitizeStateFromUrl({
        team,
        month,
        scope: url.searchParams.get('scope') || '',
        search: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || DEFAULT_STATUS_FILTER,
        manager: url.searchParams.get('manager') || '',
        sort: url.searchParams.get('sort') || DEFAULT_SORT_COLUMN,
        desc
    });
}

function applyStateToGlobals(state) {
    currentTeamFilter = state.team;
    currentMonthFilter = state.month;
    currentScopeFilter = state.scope;
    currentSearchQuery = state.search;
    currentStatusFilter = state.status || DEFAULT_STATUS_FILTER;
    currentManagerFilter = state.manager;
    currentSortColumn = state.sort;
    currentSortDesc = state.desc;
}

function syncControlsFromState() {
    const searchEl = document.getElementById('user-search');
    if (searchEl) searchEl.value = currentSearchQuery;

    const statusEl = document.getElementById('status-filter');
    if (statusEl) statusEl.value = currentStatusFilter;

    const managerEl = document.getElementById('manager-filter');
    if (managerEl) managerEl.value = currentManagerFilter;
}

function normalizeDynamicFilterSelections() {
    let normalized = false;

    const teamEl = document.getElementById('team-filter');
    if (teamEl) {
        if (currentTeamFilter && hasOption(teamEl, currentTeamFilter)) {
            teamEl.value = currentTeamFilter;
        } else if (currentTeamFilter) {
            currentTeamFilter = '';
            teamEl.value = '';
            normalized = true;
        }
    }

    const monthEl = document.getElementById('month-filter');
    if (monthEl) {
        if (currentMonthFilter && hasOption(monthEl, currentMonthFilter)) {
            monthEl.value = currentMonthFilter;
        } else if (currentMonthFilter) {
            currentMonthFilter = '';
            monthEl.value = '';
            normalized = true;
        }
    }

    const scopeEl = document.getElementById('scope-filter');
    if (scopeEl) {
        if (currentScopeFilter && hasOption(scopeEl, currentScopeFilter)) {
            scopeEl.value = currentScopeFilter;
        } else if (currentScopeFilter) {
            currentScopeFilter = '';
            scopeEl.value = '';
            normalized = true;
        }
    }

    return normalized;
}

function updateUrlFromCurrentState() {
    const pathSegments = [];
    if (currentTeamFilter) pathSegments.push(encodeURIComponent(currentTeamFilter));
    else if (currentMonthFilter) pathSegments.push('all');
    if (currentMonthFilter) pathSegments.push(encodeURIComponent(currentMonthFilter));

    const params = new URLSearchParams();
    if (currentScopeFilter) params.set('scope', currentScopeFilter);
    if (currentSearchQuery) params.set('q', currentSearchQuery);
    if (currentStatusFilter !== DEFAULT_STATUS_FILTER) params.set('status', currentStatusFilter);
    if (currentManagerFilter !== '') params.set('manager', currentManagerFilter);
    if (currentSortColumn !== DEFAULT_SORT_COLUMN) params.set('sort', currentSortColumn);
    if (currentSortDesc !== DEFAULT_SORT_DESC) params.set('desc', currentSortDesc ? '1' : '0');

    const nextPath = pathSegments.length ? `/${pathSegments.join('/')}` : '/';
    const query = params.toString();
    const nextUrl = query ? `${nextPath}?${query}` : nextPath;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
        history.replaceState(null, '', nextUrl);
    }
}

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

// Format large token counts: round to nearest 10K, display as e.g. 120K, 1.25M, 2B
function formatTokens(n) {
    if (!n) return null;
    const rounded = Math.round(n / 10000) * 10000;
    if (rounded >= 1e9) return (Math.round(rounded / 1e8) / 10).toFixed(rounded % 1e9 === 0 ? 0 : 1) + 'B';
    if (rounded >= 1e6) {
        const m = rounded / 1e6;
        return (Number.isInteger(m) ? m : m.toFixed(2).replace(/\.?0+$/, '')) + 'M';
    }
    return Math.round(rounded / 1000) + 'K';
}

// sign: +1 for added (show +N), -1 for deleted (show -N); zero is always unsigned
function formatLocPair(label, value) {
    return `${label} ${formatNumber(value || 0)}`;
}

let currentMonthFilter = '';

document.addEventListener('DOMContentLoaded', () => {
    applyStateToGlobals(parseStateFromUrl());
    syncControlsFromState();

    fetchDashboardData(currentMonthFilter);
    setupTableSorting();

    document.getElementById('month-filter').addEventListener('change', (e) => {
        currentMonthFilter = e.target.value;
        updateUrlFromCurrentState();
        fetchDashboardData(currentMonthFilter);
    });

    document.getElementById('team-filter').addEventListener('change', (e) => {
        currentTeamFilter = e.target.value;
        updateUrlFromCurrentState();
        renderUsersTable();
        renderDAUChart();
    });

    document.getElementById('scope-filter').addEventListener('change', (e) => {
        currentScopeFilter = e.target.value;
        updateUrlFromCurrentState();
        renderUsersTable();
    });

    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentStatusFilter = e.target.value;
        updateUrlFromCurrentState();
        renderUsersTable();
    });

    document.getElementById('manager-filter').addEventListener('change', (e) => {
        currentManagerFilter = e.target.value;
        updateUrlFromCurrentState();
        renderUsersTable();
    });

    document.getElementById('user-search').addEventListener('input', (e) => {
        currentSearchQuery = e.target.value.trim();
        updateUrlFromCurrentState();
        renderUsersTable();
    });

    window.addEventListener('popstate', () => {
        const nextState = parseStateFromUrl();
        const monthChanged = nextState.month !== currentMonthFilter;
        applyStateToGlobals(nextState);
        syncControlsFromState();

        if (monthChanged) {
            fetchDashboardData(currentMonthFilter);
            return;
        }

        renderUsersTable();
        renderDAUChart();
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
            // Group teams by unit using optgroups
            const byUnit = {};
            data.availableTeams.forEach(t => {
                const unit = t.unit || '';
                if (!byUnit[unit]) byUnit[unit] = [];
                byUnit[unit].push(t);
            });
            Object.keys(byUnit).sort().forEach(unit => {
                const grp = unit ? document.createElement('optgroup') : null;
                if (grp) {
                    grp.label = unit;
                    // Selectable "All [unit]" option at the top of each group
                    const allUnitOpt = document.createElement('option');
                    allUnitOpt.value = 'unit:' + unit;
                    allUnitOpt.textContent = 'All ' + unit;
                    grp.appendChild(allUnitOpt);
                }
                byUnit[unit].forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = unit ? t.title : (t.title || t.id);
                    (grp || teamFilterEl).appendChild(opt);
                });
                if (grp) teamFilterEl.appendChild(grp);
            });
        }

        // Populate manager dropdown from teams data
        const managerFilterEl = document.getElementById('manager-filter');
        if (data.availableTeams && managerFilterEl.options.length <= 1) {
            const managers = [...new Set(
                data.availableTeams
                    .map(t => t.manager)
                    .filter(m => m && m.trim() !== '')
            )].sort((a, b) => a.localeCompare(b));
            managers.forEach(manager => {
                const opt = document.createElement('option');
                opt.value = manager;
                opt.textContent = manager;
                managerFilterEl.appendChild(opt);
            });
            globalManagers = managers;
        }

        // Populate scope (enterprise → organization hierarchy) dropdown
        const scopeFilterEl = document.getElementById('scope-filter');
        if (data.availableEnterprises && scopeFilterEl.options.length <= 1) {
            data.availableEnterprises.forEach(e => {
                if (data.availableEnterprises.length > 1 || (e.organizations && e.organizations.length > 1)) {
                    // Add selectable enterprise-level option
                    const eOpt = document.createElement('option');
                    eOpt.value = 'e:' + e.id;
                    eOpt.textContent = '🏢 ' + e.label;
                    scopeFilterEl.appendChild(eOpt);
                }
                if (e.organizations && e.organizations.length > 0) {
                    const grp = document.createElement('optgroup');
                    grp.label = e.label;
                    e.organizations.forEach(o => {
                        const oOpt = document.createElement('option');
                        oOpt.value = 'o:' + o.id;
                        oOpt.textContent = o.label;
                        grp.appendChild(oOpt);
                    });
                    scopeFilterEl.appendChild(grp);
                }
            });
            // Hide dropdown entirely if nothing meaningful to filter
            const totalChoices = data.availableEnterprises.reduce(
                (n, e) => n + 1 + (e.organizations ? e.organizations.length : 0), 0);
            scopeFilterEl.style.display = totalChoices <= 1 ? 'none' : '';
        }

        syncControlsFromState();
        if (normalizeDynamicFilterSelections()) {
            updateUrlFromCurrentState();
        }

        globalUsers = data.users || [];
        updateLatestVersions(globalUsers);
        if (Array.isArray(data.availableTeams)) {
            globalTeams = {};
            data.availableTeams.forEach(t => { globalTeams[t.id] = t; });
        }
        globalLastDay = globalUsers.reduce((max, u) => (u.last_active_day > max ? u.last_active_day : max), '');
        prevMonthStats = data.prevMonthStats || null;
        prevMonthTotals = data.prevMonthTotals || null;
        if (data.watchModelUse !== undefined) {
            const normalized = normalizeWatchModelUseConfig(data.watchModelUse);
            watchModelUse = normalized.flat;
            watchModelUseGroups = normalized.groups;
        }
        if (data.watchModelUseGroups && typeof data.watchModelUseGroups === 'object') {
            watchModelUseGroups = data.watchModelUseGroups;
        }
        if (Array.isArray(data.preferredEnterpriseIds)) globalPreferredEnterpriseIds = data.preferredEnterpriseIds;

        // Render Tables
        renderUsersTable();
        renderDAUChart();

    } catch (error) {
        console.error('Error fetching stats:', error);
        document.getElementById('users-body').innerHTML = `<tr><td colspan="12" class="loading">Failed to load data. Make sure backend is running.</td></tr>`;
    }
}

// Compute the longest streak within the selected period:
// uninterrupted active WORKING days (weekends are excluded from continuity checks).
// activeDaysList: sorted array of 'YYYY-MM-DD' strings (already filtered to the selected period).
// lastActiveDay: kept for backward compatibility with existing call sites; not used.
function computeCurrentStreak(activeDaysList, lastActiveDay) {
    if (!activeDaysList || activeDaysList.length === 0) return 0;

    // Consider only unique working days that are active.
    const workingActiveDays = [...new Set(activeDaysList)]
        .map(day => new Date(day + 'T12:00:00')) // noon avoids DST boundary issues
        .filter(d => {
            const dow = d.getDay();
            return dow !== 0 && dow !== 6;
        })
        .sort((a, b) => a - b);

    if (!workingActiveDays.length) return 0;

    let best = 1;
    let current = 1;

    for (let i = 1; i < workingActiveDays.length; i++) {
        const prev = new Date(workingActiveDays[i - 1]);
        const cur = workingActiveDays[i];

        // Walk from previous calendar day to current day,
        // counting only working days that must be uninterrupted.
        prev.setDate(prev.getDate() + 1);
        let missingWorkingDayBetween = false;
        while (localISODate(prev) < localISODate(cur)) {
            const dow = prev.getDay();
            if (dow !== 0 && dow !== 6) {
                missingWorkingDayBetween = true;
                break;
            }
            prev.setDate(prev.getDate() + 1);
        }

        if (missingWorkingDayBetween) {
            current = 1;
        } else {
            current++;
            if (current > best) best = current;
        }
    }

    return best;
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
    // Use local-date constructor to avoid UTC-midnight timezone shift
    const targetDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const today = new Date();
    // Normalize to midnight to do purely day-level diffs
    targetDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today - targetDate;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); // Math.round handles DST days (23/25 hrs)

    let relativeStr = '';
    if (diffDays === 0) relativeStr = 'today';
    else if (diffDays === 1) relativeStr = 'yesterday';
    else if (diffDays > 1 && diffDays < 7) relativeStr = `${diffDays} days ago`;
    else if (diffDays >= 7 && diffDays < 14) relativeStr = '1 week ago';
    else if (diffDays >= 14 && diffDays < 30) relativeStr = `${Math.floor(diffDays / 7)} weeks ago`;
    else if (diffDays >= 30) relativeStr = '1+ month ago';
    else relativeStr = '?';

    return `${formattedDate}<br><span style="font-size:0.8em;color:var(--text-muted)">Active ${relativeStr}</span>`;
}

function setupTableSorting() {
    const headers = document.querySelectorAll('#users-table th');

    // Store original text
    headers.forEach(th => {
        th.dataset.originalText = th.innerText;
    });

    // Helper to update visual sort indicators
    function updateHeaders() {
        headers.forEach((th, index) => {
            let text = th.dataset.originalText;
            if (SORT_MAPPING[index] === currentSortColumn) {
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
            const prop = SORT_MAPPING[index];
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
            updateUrlFromCurrentState();
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
    const accountsStr = Array.isArray(user.accounts) ? user.accounts.join(' ') : user.user_login;
    const fields = [
        user.human_name, accountsStr, user.team,
        user.enterprise_label, user.organization_label,
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

    // Apply team filter (value may be a team ID or 'unit:X' for a whole unit)
    let sortedUsers = currentTeamFilter
        ? (currentTeamFilter.startsWith('unit:')
            ? globalUsers.filter(u => globalTeams[u.team]?.unit === currentTeamFilter.slice(5))
            : globalUsers.filter(u => u.team === currentTeamFilter))
        : [...globalUsers];

    // Apply enterprise/organization scope filter
    if (currentScopeFilter) {
        const colonIdx = currentScopeFilter.indexOf(':');
        const scopeType = currentScopeFilter.slice(0, colonIdx);
        const scopeId   = currentScopeFilter.slice(colonIdx + 1);
        if (scopeType === 'e') {
            sortedUsers = sortedUsers.filter(u => Array.isArray(u.enterprise_ids) && u.enterprise_ids.includes(scopeId));
        } else if (scopeType === 'o') {
            sortedUsers = sortedUsers.filter(u => Array.isArray(u.organization_ids) && u.organization_ids.includes(scopeId));
        }
    }

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

    // Apply manager filter
    if (currentManagerFilter !== '') {
        sortedUsers = sortedUsers.filter(u => u.team_manager === currentManagerFilter);
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

    // Sort logic — never-active users always sink to the bottom regardless of column
    if (currentSortColumn !== 'rank') {
        sortedUsers.sort((a, b) => {
            if (a.never_active && !b.never_active) return 1;
            if (!a.never_active && b.never_active) return -1;

            let valA = currentSortColumn === 'total_output' ? (a.total_suggested_changed + a.total_loc_changed) : a[currentSortColumn];
            let valB = currentSortColumn === 'total_output' ? (b.total_suggested_changed + b.total_loc_changed) : b[currentSortColumn];

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
    renderMaturitySection(sortedUsers);

    sortedUsers.forEach((user, idx) => {
        const lineNumber = idx + 1;
        const tr = document.createElement('tr');
        const prevRaw = prevMonthStats ? prevMonthStats[user.user_login] : null;
        // Never-active users show no diff badges; only the "new" label is allowed (handled separately below)
        const prev = user.never_active ? null : prevRaw;

        if (user.revoked) {
            tr.classList.add('revoked-user');
        }
        if (user.never_active) {
            tr.classList.add('never-active-user');
        }

        const revokedMark = user.revoked ? ' <span style="font-size: 0.9em;">❌</span>' : '';
        const newUserMark = (prevMonthStats && !prevRaw) ? ' <span class="diff-badge diff-new">new</span>' : '';

        const primaryIdeOutdated = isPrimaryIdeOutdated(user);
        const primaryIdeTooltipHTML = primaryIdeOutdated ? buildPrimaryIdeTooltipHTML(user) : '';

        // Keep user_login hidden in anonymized mode, but preserve the original rendering for easy restore.
        // <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.team ? user.team + ' | ' : ''}${user.user_login}</span>

        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.9em;">
                ${lineNumber}
            </td>
            <td>
                <div class="user-cell" style="white-space: nowrap; flex-direction: column; align-items: flex-start; gap: 0.1rem;">
                    <span style="font-weight: 600;">${user.human_name}${revokedMark}${newUserMark}</span>
                    <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.role || user.user_login}</span>
                    <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.team_title ? (user.team_unit ? user.team_unit + ' · ' + user.team_title : user.team_title) : (user.team || '')}</span>
                    ${Array.isArray(user.accounts) && user.accounts.length > 1 ? `<span style="font-size: 0.7em; color: var(--text-muted); font-weight: 400; opacity: 0.7;">🔑 ${user.accounts.length} accounts</span>` : (user.enterprise_label || user.organization_label ? `<span style="font-size: 0.75em; color: var(--text-muted); font-weight: 400; opacity: 0.8;">${[user.enterprise_label, user.organization_label].filter(Boolean).join(' · ')}</span>` : '')}
                </div>
            </td>
            <!-- Output: grand total (suggested+applied) | 💡 suggested LOC | ✏️ applied LOC | 🔤 output tokens -->
            <td style="white-space: nowrap;" title="Grand total = suggested + applied LOC&#10;💡 Suggested LOC = loc_suggested_to_add + loc_suggested_to_delete&#10;✏️ Applied LOC = loc_added + loc_deleted&#10;🔤 CLI output tokens generated by the model">
                ${formatNumber(user.total_suggested_changed + user.total_loc_changed)}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">💡 ${formatNumber(user.total_suggested_changed)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">✏️ ${formatNumber(user.total_loc_changed)}</span>
                ${formatTokens(user.cli_output_tokens_sum) ? `<br><span style="font-size:0.8em;color:var(--text-muted)">🔤 ${formatTokens(user.cli_output_tokens_sum)}</span>` : ''}
            </td>
            <!-- Turns: total interactions | 🏃 code generation activity count | 🎯 code acceptance activity count -->
            <td title="Total interaction turns (user_initiated + cli_requests)&#10;🏃 Code generation activity count&#10;🎯 Code acceptance activity count">
                <span class="metric-high" style="font-size: 1.1em;">${formatNumber(user.turns)}</span>
                ${prev ? diffBadge(user.turns, prev.turns, true) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">🏃\u202f${formatNumber(user.code_generation_activity_count)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">🎯 ${formatNumber(user.code_acceptance_activity_count)}</span>
            </td>
            <td style="white-space: nowrap;" title="Steering Output = Steering Suggested + Steering Applied&#10;Steering Suggested = Σ(loc_suggested_to_add + loc_suggested_to_delete) for documentation/prompt languages&#10;Steering Applied = Σ(loc_added + loc_deleted) for documentation/prompt languages${user.all_doc_languages_list && user.all_doc_languages_list.length ? '&#10;Doc languages: ' + user.all_doc_languages_list.join(', ') : ''}">
                ${formatNumber(user.doc_loc_changed)}
                ${prev ? diffArrowOnly(user.doc_loc_changed, prev.doc_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${formatLocPair('💡', user.doc_loc_suggested)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${formatLocPair('✏️', user.doc_loc_applied)}</span>
            </td>
            <td style="white-space: nowrap;" title="Coding Output = Coding Suggested + Coding Applied&#10;Coding Suggested = Σ(loc_suggested_to_add + loc_suggested_to_delete) for programming languages&#10;Coding Applied = Σ(loc_added + loc_deleted) for programming languages">
                ${formatNumber(user.code_loc_changed)}
                ${prev ? diffBadge(user.code_loc_changed, prev.code_loc_changed) : ''}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${formatLocPair('💡', user.code_loc_suggested)}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">${formatLocPair('✏️', user.code_loc_applied)}</span>
            </td>
            <td style="white-space: nowrap;" title="PERF = Total Output / active days&#10;Total Output = Suggested LOC + Applied LOC&#10;Suggested LOC = loc_suggested_to_add + loc_suggested_to_delete&#10;Applied LOC = loc_added + loc_deleted&#10;${formatNumber(user.perf_score)} loc/day">
                <span>${formatNumber(user.perf_score)}</span>
                ${prev ? diffBadge(user.perf_score, prev.perf_score, true) : ''}
${(() => { const pn = user.ai_adoption_phase_number ?? 0; const prevPn = prev ? (prev.ai_adoption_phase_number ?? null) : null; const changed = prevPn !== null && prevPn !== pn; return `<br><span style="font-size:0.75em;color:var(--text-muted);cursor:help" title="${PHASE_DESCRIPTIONS[pn] || ''}">${PHASE_LABELS[pn] || ('Phase ' + pn)}${changed ? ' ' + (pn > prevPn ? '<span class="diff-badge diff-up">▲</span>' : '<span class="diff-badge diff-down">▼</span>') : ''}</span>`; })()}
            </td>
            <td style="max-width: 7rem;" title="${user.all_languages_list && user.all_languages_list.length ? 'Languages: ' + user.all_languages_list.join(', ') : ''}">${user.favorite_language}</td>
            <td style="max-width: 8rem; overflow-wrap: break-word;" title="${user.all_models_list && user.all_models_list.length ? 'Models: ' + user.all_models_list.join(', ') : ''}">${user.favorite_model}</td>
            <td style="white-space: nowrap;${primaryIdeOutdated ? ' cursor:help;' : ''}" ${primaryIdeOutdated ? '' : `title="${user.all_ides_list && user.all_ides_list.length ? 'IDEs: ' + user.all_ides_list.join(', ') : ''}"`}>${(() => { const raw = user.favorite_ide_raw; const pct = user.favorite_ide_pct; if (!raw) return user.favorite_ide; const line1 = `<span style="white-space:nowrap">${raw}${primaryIdeOutdated ? '&nbsp;<span style="font-size:0.85em;pointer-events:none">⚠️</span>' : ''}</span>`; const line2 = pct && pct !== '100%' ? `<br><span style="font-size:0.8em;color:var(--text-muted)">${pct}</span>` : ''; return line1 + line2; })()}</td>
            <td style="white-space: nowrap;" title="🤖 Agent days: days where Copilot Agent mode was used&#10;💬 Chat days: days where Copilot Chat was used&#10;⌨️ CLI days: days where Copilot CLI was used&#10;🔍 Code Review days: days where Copilot reviewed code (active = user requested, passive = auto-triggered)&#10;☁️ Cloud Agent days: days where Copilot cloud agent was invoked">
                ${user.never_active
                    ? '<span style="font-size:0.85em;color:var(--text-muted);opacity:0.7">Never used</span>'
                    : `<span style="font-size:0.8em;color:var(--text-muted)">🤖&nbsp;${user.agent_days_count}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">💬&nbsp;${user.chat_days_count}</span>
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">⌨️&nbsp;${user.cli_days_count}</span>${user.code_review_days_count ? `
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">🔍&nbsp;${user.code_review_days_count}</span>` : ''}${user.cloud_agent_days_count ? `
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">☁️&nbsp;${user.cloud_agent_days_count}</span>` : ''}`}
            </td>
            <td style="color:var(--text-muted); font-size: 0.9em; white-space: nowrap;">
                ${user.never_active
                    ? '<span style="font-size:0.85em;opacity:0.5">— no activity —</span>'
                    : `${getFriendlyDate(user.last_active_day)}
                <br>
                <span style="font-size:0.8em;">${user.active_days_count} days total ${prev ? diffAbsBadge(user.active_days_count, prev.active_days_count) : ''}</span>${(() => { const s = computeCurrentStreak(user.active_days_list, user.last_active_day); return s > 0 ? `<br><span style="font-size:0.8em;">🔥&nbsp;${s}d best streak</span>` : ''; })()}`}
            </td>
        `;

        // micro-animation for table rows
        tr.style.opacity = '0';
        tr.style.transform = 'translateX(-10px)';
        // add brief delay only on initial load to avoid jank on sorting
        if (idx < TABLE_ANIM_ROW_LIMIT) {
            tr.style.transitionDelay = `${Math.min(idx * TABLE_ANIM_DELAY_STEP, TABLE_ANIM_DELAY_MAX)}s`;
        }

        tbody.appendChild(tr);

        // Row click opens user detail popup
        tr.addEventListener('click', () => openUserModal(user));

        // Attach IDE version tooltip to the IDE cell (col 9) when the primary IDE is outdated
        if (primaryIdeOutdated && primaryIdeTooltipHTML) {
            const ideCell = tr.cells[9];
            if (ideCell) {
                ideCell.addEventListener('mouseenter', e => {
                    const tt = _getIdeTooltip();
                    tt.innerHTML = `<div style="font-size:0.82rem;line-height:1.7">${primaryIdeTooltipHTML}</div>`;
                    tt.style.display = 'block';
                    _positionIdeTooltip(e);
                });
                ideCell.addEventListener('mousemove', e => _positionIdeTooltip(e));
                ideCell.addEventListener('mouseleave', () => { _getIdeTooltip().style.display = 'none'; });
            }
        }

        // Trigger reflow
        void tr.offsetWidth;
        tr.style.opacity = '1';
    });
}

function buildUserMetaSection(user, { showIdes = true } = {}) {
    const rows = [];
    const emails = Array.isArray(user.emails)
        ? [...new Map(
            user.emails
                .map(email => String(email || '').trim())
                .filter(Boolean)
                .map(email => [email.toLowerCase(), email])
        ).values()]
        : [];

    if (emails.length) {
        const emailLinks = emails
            .map(email => `<a href="mailto:${email}" style="color:inherit;text-decoration:underline;text-underline-offset:2px">${email}</a>`)
            .join(', ');
        const mailtoAll = `mailto:${emails.join(',')}`;
        const sendToAll = emails.length > 1
            ? ` <span style="margin-left:0.5rem"><a href="${mailtoAll}" style="color:var(--text-main);font-weight:600;text-decoration:underline;text-underline-offset:2px">Send to All</a></span>`
            : '';
        rows.push(`<div class="meta-row"><span class="meta-label">Emails:</span> ${emailLinks}${sendToAll}</div>`);
    }
    if (user.all_languages_list && user.all_languages_list.length) {
        rows.push(`<div class="meta-row"><span class="meta-label">Languages:</span> ${user.all_languages_list.join(', ')}</div>`);
    }
    if (user.all_models_list && user.all_models_list.length) {
        rows.push(`<div class="meta-row"><span class="meta-label">Models:</span> ${user.all_models_list.join(', ')}</div>`);
    }
    if (showIdes && ((user.all_ides_list && user.all_ides_list.length) || user.cli_version)) {
        // 'cli' is a virtual IDE; it is rendered separately below with its CLI version.
        const ideLabels = (user.all_ides_list || []).filter(ide => ide !== 'cli').map(ide => {
            const v = user.ide_versions && user.ide_versions[ide];
            if (v) {
                const detail = [];
                if (v.ide_version) {
                    const latestN = latestVersions.ides[ide] ?? -1;
                    const outdated = latestN > 0 && versionToInt(v.ide_version) < latestN;
                    detail.push(v.ide_version + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : ''));
                }
                if (v.plugin && v.plugin_version) {
                    const latestN = latestVersions.plugins[v.plugin] ?? -1;
                    const outdated = latestN > 0 && versionToInt(v.plugin_version) < latestN;
                    detail.push(`${v.plugin} ${v.plugin_version}` + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : ''));
                } else if (v.plugin) {
                    detail.push(v.plugin);
                }
                return detail.length ? `${ide} <span style="color:var(--text-muted);font-size:0.9em">(${detail.join(', ')})</span>` : ide;
            }
            return ide;
        });
        if (user.cli_version) {
            const latestN = latestVersions.cli;
            const outdated = latestN > 0 && versionToInt(user.cli_version) < latestN;
            const badge = outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : '';
            ideLabels.push(`CLI <span style="color:var(--text-muted);font-size:0.9em">(${user.cli_version}${badge})</span>`);
        }
        rows.push(`<div class="meta-row"><span class="meta-label">IDEs:</span> ${ideLabels.join(', ')}</div>`);
    }
    if (!rows.length) return '';
    return `<div class="user-meta-section">${rows.join('')}</div>`;
}

// ── User detail modal ──

function isPreferredEnterpriseAccount(login, accountEnterpriseIds, preferredEnterpriseIds) {
    const preferred = new Set((preferredEnterpriseIds || []).map(String));
    if (!preferred.size) return false;
    const ids = Array.isArray(accountEnterpriseIds?.[login]) ? accountEnterpriseIds[login].map(String) : [];
    if (ids.length > 0) {
        return ids.some(id => preferred.has(id));
    }
    // Heuristic fallback for provisioned-but-unused customer accounts.
    return String(login || '').toLowerCase().endsWith('external');
}

function isAccountUsedInCurrentPeriod(login, accountDaily) {
    const rows = accountDaily?.[login];
    return Array.isArray(rows) && rows.length > 0;
}

function getUnusedPreferredAccounts(user) {
    const accounts = Array.isArray(user.accounts) ? user.accounts : [];
    const accountDaily = user.account_daily || {};
    const accountEnterpriseIds = user.account_enterprise_ids || {};
    return accounts.filter(login =>
        isPreferredEnterpriseAccount(login, accountEnterpriseIds, globalPreferredEnterpriseIds) &&
        !isAccountUsedInCurrentPeriod(login, accountDaily)
    );
}

function openUserModal(user) {
    const overlay = document.getElementById('user-modal');
    const accounts = Array.isArray(user.accounts) ? user.accounts : [user.user_login];
    const unusedPreferredAccounts = new Set(getUnusedPreferredAccounts(user));
    let showIdesInMeta = accounts.length === 1;
    const displayName = user.human_name || user.user_login;
    const role = user.role || '';
    const teamInfo = user.team ? (globalTeams[user.team] || null) : null;
    const unit = user.team_unit || (teamInfo ? teamInfo.unit : '') || '';
    const teamTitle = user.team_title || (teamInfo ? teamInfo.title : '') || user.team || '';
    const manager = user.team_manager || (teamInfo ? teamInfo.manager : '') || '';

    let titleText = displayName;
    if (role) titleText += ` · ${role}`;

    const teamScopeParts = [];
    if (unit) teamScopeParts.push(unit);
    if (teamTitle) {
        const teamText = manager ? `${teamTitle} (👔 ${manager})` : teamTitle;
        teamScopeParts.push(`-> ${teamText}`);
    }
    if (teamScopeParts.length) {
        titleText += ` | ${teamScopeParts.join(' ')}`;
    }

    document.getElementById('modal-title').textContent = titleText;

    // Build chart section: if user has multiple accounts, show aggregate + per-account charts
    let chartHTML = '';
    const accountDaily = user.account_daily || {};
    const accountIdes = user.account_ides || {};
    const accountCli = user.account_cli || {};
    const accountEnterpriseLabels = user.account_enterprise_labels || {};

    function buildAccountIdeCliHTML(login) {
        const acct = accountIdes[login];
        const cliVer = accountCli[login];
        const parts = [];
        if (acct && acct.ides && acct.ides.length) {
            const ideLabels = acct.ides.map(ide => {
                const v = acct.ide_versions && acct.ide_versions[ide];
                if (v) {
                    const detail = [];
                    if (v.ide_version) {
                        const latestN = latestVersions.ides[ide] ?? -1;
                        const outdated = latestN > 0 && versionToInt(v.ide_version) < latestN;
                        detail.push(v.ide_version + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : ''));
                    }
                    if (v.plugin && v.plugin_version) {
                        const latestN = latestVersions.plugins[v.plugin] ?? -1;
                        const outdated = latestN > 0 && versionToInt(v.plugin_version) < latestN;
                        detail.push(`${v.plugin} ${v.plugin_version}` + (outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : ''));
                    } else if (v.plugin) {
                        detail.push(v.plugin);
                    }
                    return detail.length ? `${ide} <span style="color:var(--text-muted);font-size:0.85em">(${detail.join(', ')})</span>` : ide;
                }
                return ide;
            });
            parts.push(`<span style="font-size:0.8em;color:var(--text-muted)"><b>IDE:</b> ${ideLabels.join(', ')}</span>`);
        }
        if (cliVer) {
            const latestN = latestVersions.cli;
            const outdated = latestN > 0 && versionToInt(cliVer) < latestN;
            const badge = outdated ? ' <span title="Not on the latest version seen in this period">⚠️ Outdated</span>' : '';
            parts.push(`<span style="font-size:0.8em;color:var(--text-muted)"><b>CLI:</b> ${cliVer}${badge}</span>`);
        }
        return parts.length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:0.5rem">${parts.join('')}</div>` : '';
    }

    if (accounts.length > 1) {
        // Aggregate chart first
        chartHTML += `<div class="user-meta-section" style="margin-top:0;padding-top:0;border-top:none"><div style="font-size:0.8em;color:var(--text-muted);margin-bottom:4px;font-weight:600">📊 Combined (all accounts)</div>${buildCombinedChart(user.daily || [], currentMonthFilter)}</div>`;
        // Per-account charts below
        for (const login of accounts) {
            const acctData = accountDaily[login] || [];
            const ideCliHTML = buildAccountIdeCliHTML(login);
            const enterpriseLabel = accountEnterpriseLabels[login] || '';
            const enterpriseSuffix = enterpriseLabel ? ` (${enterpriseLabel})` : '';
            const warning = unusedPreferredAccounts.has(login)
                ? '<span style="margin-left:0.35rem" title="Preferred enterprise license account has no usage in selected period">🔴</span>'
                : '';
            chartHTML += `<div class="user-meta-section"><div style="font-size:0.8em;color:var(--text-muted);margin-bottom:4px;font-weight:600">🔑 ${login}${enterpriseSuffix}${warning}</div>${ideCliHTML}${buildCombinedChart(acctData, currentMonthFilter, { noDataEmoji: unusedPreferredAccounts.has(login) ? '🔴' : '' })}</div>`;
        }
    } else {
        const onlyLogin = accounts[0] || user.user_login;
        const isPreferredUnused = unusedPreferredAccounts.has(onlyLogin);
        const enterpriseLabel = accountEnterpriseLabels[onlyLogin] || user.enterprise_label || '';
        const enterpriseSuffix = enterpriseLabel ? ` (${enterpriseLabel})` : '';
        const ideCliHTML = buildAccountIdeCliHTML(onlyLogin);
        if (ideCliHTML) showIdesInMeta = false;
        const warning = isPreferredUnused
            ? '<span style="margin-left:0.35rem" title="Preferred enterprise license account has no usage in selected period">🔴</span>'
            : '';
        chartHTML = `<div class="user-meta-section" style="margin-top:0;padding-top:0;border-top:none"><div style="font-size:0.8em;color:var(--text-muted);margin-bottom:4px;font-weight:600">🔑 ${onlyLogin}${enterpriseSuffix}${warning}</div>${ideCliHTML}${buildCombinedChart(user.daily || [], currentMonthFilter, { noDataEmoji: isPreferredUnused ? '🔴' : '' })}</div>`;
    }

    document.getElementById('modal-body').innerHTML = chartHTML + buildUserMetaSection(user, { showIdes: showIdesInMeta });
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

// ── Section collapse helper ─────────────────────────────────────────────
function initSectionToggle(toggleId, collapsibleId, chevronId) {
    const toggle  = document.getElementById(toggleId);
    const body    = document.getElementById(collapsibleId);
    const chevron = document.getElementById(chevronId);
    if (!toggle || !body || !chevron) return;
    toggle.addEventListener('click', () => {
        const isCollapsed = body.classList.contains('collapsed');
        if (isCollapsed) {
            // Expand: set target height, remove collapsed, then clear inline style after transition
            body.style.maxHeight = body.scrollHeight + 'px';
            body.classList.remove('collapsed');
            chevron.classList.remove('collapsed');
            toggle.style.marginBottom = '';
            body.addEventListener('transitionend', function clear() {
                body.style.maxHeight = '';
                body.removeEventListener('transitionend', clear);
            });
        } else {
            // Collapse: pin current height, then animate to 0
            body.style.maxHeight = body.scrollHeight + 'px';
            requestAnimationFrame(() => {
                body.classList.add('collapsed');
                chevron.classList.add('collapsed');
                toggle.style.marginBottom = '0';
            });
        }
    });
}

// ── DAU collapse toggle ─────────────────────────────────────────────────
(function initDAUToggle() {
    const toggle   = document.getElementById('dau-toggle');
    const chart    = document.getElementById('dau-collapsible');
    const chevron  = document.getElementById('dau-chevron');
    if (!toggle || !chart || !chevron) return;
    toggle.addEventListener('click', () => {
        const collapsed = chart.classList.toggle('collapsed');
        chevron.classList.toggle('collapsed', collapsed);
        toggle.style.marginBottom = collapsed ? '0' : '';
    });
})();

// ── Users table + Output Breakdown collapse toggles ─────────────────────
initSectionToggle('users-toggle',          'users-table-collapsible',    'users-chevron');
    initSectionToggle('maturity-toggle',       'maturity-collapsible',       'maturity-chevron');
    initSectionToggle('breakdown-toggle',      'breakdown-collapsible',      'breakdown-chevron');
    initSectionToggle('watched-models-toggle', 'watched-models-collapsible', 'watched-models-chevron');

// ── Shared aggregate computation ───────────────────────────────────────────
// Used by both renderDAUChart (header stats) and renderMaturitySection (ctx).
function computeTeamAggregates(users, month) {
    const nonRevoked = users.filter(u => !u.revoked);
    const total = nonRevoked.length;

    let avgDauPct = null, avgDAU = 0, activeBizDays = [];
    const dauData = computeDAU(nonRevoked, 30, month || '');
    activeBizDays = dauData.filter(d => !d.isWeekend && d.count > 0);
    if (activeBizDays.length && total > 0) {
        const dauSum = activeBizDays.reduce((s, d) => s + d.count, 0);
        avgDAU = dauSum / activeBizDays.length;
        avgDauPct = Math.round(avgDAU / total * 100);
    }

    const totalTurns = nonRevoked.reduce((s, u) => s + (u.turns || 0), 0);
    const avgTurns = total > 0 ? Math.round(totalTurns / total) : 0;

    const activeUsers = nonRevoked.filter(u => (u.active_days_count || 0) > 0);
    const avgPerf = activeUsers.length > 0
        ? Math.round(activeUsers.reduce((s, u) => s + (u.perf_score || 0), 0) / activeUsers.length)
        : 0;

    return { avgDauPct, avgDAU, avgTurns, avgPerf, total, activeBizDays };
}

function getMaturityStatusColor(status) {
    if (status === 'green') return '#4ade80';
    if (status === 'amber') return '#fbbf24';
    if (status === 'red') return '#f87171';
    return 'var(--text-muted)';
}

function getDauMetricStatuses(avgDauPct, avgTurns, avgPerf, totalUsers, activeUsersCount) {
    // Single source of truth: thresholds from maturity-rules.js MATURITY_THRESHOLDS
    const dauStatus = avgDauPct == null ? 'gray' : (avgDauPct >= MATURITY_THRESHOLDS.dau.green ? 'green' : (avgDauPct >= MATURITY_THRESHOLDS.dau.amber ? 'amber' : 'red'));
    const turnsStatus = totalUsers > 0 ? (avgTurns >= MATURITY_THRESHOLDS.avg_turns.green ? 'green' : (avgTurns >= MATURITY_THRESHOLDS.avg_turns.amber ? 'amber' : 'red')) : 'gray';
    const perfStatus = activeUsersCount > 0 ? (avgPerf >= MATURITY_THRESHOLDS.avg_perf.green ? 'green' : (avgPerf >= MATURITY_THRESHOLDS.avg_perf.amber ? 'amber' : 'red')) : 'gray';
    return { dauStatus, turnsStatus, perfStatus };
}

function renderDAUChart() {
    const container = document.getElementById('dau-chart-container');
    if (!container) return;
    if (!globalUsers.length) { container.innerHTML = ''; return; }
    const filteredUsers = globalUsers.filter(u => !u.revoked && (!currentTeamFilter ||
        (currentTeamFilter.startsWith('unit:')
            ? globalTeams[u.team]?.unit === currentTeamFilter.slice(5)
            : u.team === currentTeamFilter)));
    container.innerHTML = buildDAUChart(filteredUsers, filteredUsers.length, currentMonthFilter);
    const avgStat = document.getElementById('dau-avg-stat');
    if (avgStat) {
        const { avgDauPct: pct, avgDAU, avgTurns, avgPerf, activeBizDays } = computeTeamAggregates(filteredUsers, currentMonthFilter);
        const activeUsersCount = filteredUsers.filter(u => (u.active_days_count || 0) > 0).length;
        const { dauStatus, turnsStatus, perfStatus } = getDauMetricStatuses(pct, avgTurns, avgPerf, filteredUsers.length, activeUsersCount);
        const dauColor = getMaturityStatusColor(dauStatus);
        const turnsColor = getMaturityStatusColor(turnsStatus);
        const perfColor = getMaturityStatusColor(perfStatus);
        const avgDAUDisplay = Number(avgDAU).toFixed(1);
        if (activeBizDays.length) {
            // prev-month equivalents (only available when a month is selected)
            let prevAvgTurns = null, prevAvgPerf = null, prevPct = null;
            if (prevMonthStats) {
                // avg DAU % for prev month — computed server-side and shipped in prevMonthTotals
                // (client-side recompute is not possible because user.daily is scoped to current month)
                if (prevMonthTotals && prevMonthTotals.avgDauPct != null) {
                    prevPct = prevMonthTotals.avgDauPct;
                }

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
                        <div style="font-size:1rem;color:${dauColor};font-weight:600;line-height:1;white-space:nowrap">${avgDAUDisplay}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px;white-space:nowrap">${pct}% ${diffBadge(pct, prevPct, true)}</div>
                    </div>
                    <div style="width:1px;background:rgba(255,255,255,0.1);align-self:stretch"></div>
                    <div style="text-align:right">
                        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:2px">Avg Turns</div>
                        <div style="font-size:1rem;color:${turnsColor};font-weight:600;line-height:1;white-space:nowrap">${formatNumber(avgTurns)} ${diffBadge(avgTurns, prevAvgTurns, true)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">per user</div>
                    </div>
                    <div style="width:1px;background:rgba(255,255,255,0.1);align-self:stretch"></div>
                    <div style="text-align:right">
                        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:2px">Avg Perf</div>
                        <div style="font-size:1rem;color:${perfColor};font-weight:600;line-height:1;white-space:nowrap">${formatNumber(avgPerf)} ${diffBadge(avgPerf, prevAvgPerf, true)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">LOC / user / day</div>
                    </div>
                </div>`;
        } else {
            avgStat.innerHTML = '';
        }
    }
}

function buildCombinedChart(daily, month, opts = {}) {
    if (!daily.length && !month) {
        const marker = opts.noDataEmoji ? `${opts.noDataEmoji} ` : '';
        return `<p style="color:var(--text-muted)">${marker}No daily data available.</p>`;
    }

    const allDays = fillDailyGaps(daily, month);

    const maxLoc = Math.max(...allDays.map(d => (d.code_loc||0) + (d.doc_loc||0)), 1);
    const maxTurns = Math.max(...allDays.map(d => (d.user_initiated||0) + (d.code_generation||0) + (d.cli_turns||0)), 1);
    const chartH = USER_CHART_HEIGHT;

    let bars = '';
    for (const d of allDays) {
        const codeLoc = d.code_loc || 0;
        const docLoc = d.doc_loc || 0;
        const totalLoc = codeLoc + docLoc;
        const locBottom = Math.round((totalLoc / maxLoc) * chartH);

        const cliTurns = d.cli_turns || 0;
        const turnsTotal = (d.user_initiated||0) + (d.code_generation||0) + cliTurns;
        const hUser = Math.round(((d.user_initiated||0) / maxTurns) * chartH);
        const hGen  = Math.round(((d.code_generation||0) / maxTurns) * chartH);
        const hCli  = Math.round((cliTurns / maxTurns) * chartH);

        const parts = d.day.split('-');
        const label = parts[2] + '.' + parts[1];
        const dowStyle = d.isWeekend ? 'color:rgba(239,68,68,0.5)' : '';

        const locTitle = `Output LOC: ${formatNumber(totalLoc)} (Coding: ${formatNumber(codeLoc)}, Steering: ${formatNumber(docLoc)})`;
        const turnsTitle = `Turns: ${turnsTotal} (Chat asks: ${d.user_initiated||0}, Agent/CodeGen: ${d.code_generation||0}, CLI: ${cliTurns})`;
        const totalLabel = turnsTotal > 0 ? `<span class="bar-turns-total">${turnsTotal}</span>` : '';

        bars += `
            <div class="bar-col-combined" title="${turnsTitle}">
                <div class="bar-area" style="height:${chartH}px">
                    ${totalLabel}
                    <div class="bar-stack" style="height:${hUser + hGen + hCli}px">
                        <div class="bar-seg-user" style="height:${hUser}px"></div>
                        <div class="bar-seg-codegen" style="height:${hGen}px"></div>
                        <div class="bar-seg-cli" style="height:${hCli}px"></div>
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
            <span><span class="legend-dot" style="background:#38bdf8"></span>Agent/CodeGen</span>
            <span><span class="legend-dot" style="background:#34d399"></span>CLI</span>
            <span style="margin-left:0.5rem;padding-left:0.75rem;border-left:1px solid rgba(255,255,255,0.1)"><span class="legend-line"></span>Total Output LOC</span>
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
            const entry = dayMap[iso] || { day: iso, user_initiated: 0, code_generation: 0, cli_turns: 0, code_loc: 0, doc_loc: 0 };
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
            const entry = dayMap[iso] || { day: iso, user_initiated: 0, code_generation: 0, cli_turns: 0, code_loc: 0, doc_loc: 0 };
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
        if (u.loc_by_model_chat_strict) {
            for (const [m, loc] of Object.entries(u.loc_by_model_chat_strict)) {
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

    const expensiveModels = new Set((watchModelUseGroups.expensive || []).map(m => String(m || '').trim().toLowerCase()));
    const weakModels = new Set((watchModelUseGroups.weak || []).map(m => String(m || '').trim().toLowerCase()));
    const locByModelClass = {};
    for (const [model, loc] of Object.entries(locByModel)) {
        const normalizedModel = String(model || '').trim().toLowerCase();
        if (expensiveModels.has(normalizedModel)) {
            locByModelClass['expensive models'] = (locByModelClass['expensive models'] || 0) + loc;
        } else if (weakModels.has(normalizedModel)) {
            locByModelClass['weak models'] = (locByModelClass['weak models'] || 0) + loc;
        } else {
            locByModelClass['regular models'] = (locByModelClass['regular models'] || 0) + loc;
        }
    }

    // Consolidate doc-language labels before building the Steering by Syntax donut
    const DOC_LANG_ALIASES = { instructions: 'skills', prompt: 'skills', skill: 'skills', text: 'markdown', plaintext: 'markdown', mermaid: 'markdown' };
    const locByDocLanguageNorm = {};
    for (const [lang, val] of Object.entries(locByDocLanguage)) {
        const key = DOC_LANG_ALIASES[lang.toLowerCase()] || lang;
        locByDocLanguageNorm[key] = (locByDocLanguageNorm[key] || 0) + val;
    }

    // ── Version-status donut: Newest vs Outdated (per-account check) ──
    // latestVersions is already set from globalUsers in fetchDashboardData.
    // userHasAnyOutdated is a module-level function that reads latestVersions.
    let newestCount = 0, outdatedCount = 0;
    for (const u of filteredUsers) {
        const hasIdes = (u.account_ides && Object.keys(u.account_ides).length > 0) ||
                        (u.ide_versions && Object.keys(u.ide_versions).length > 0);
        const hasCli  = (u.account_cli  && Object.values(u.account_cli).some(Boolean)) || !!u.cli_version;
        if (!hasIdes && !hasCli) continue;
        if (userHasAnyOutdated(u)) outdatedCount++;
        else newestCount++;
    }
    const versionStatusMap = {};
    if (newestCount)  versionStatusMap['Newest']   = newestCount;
    if (outdatedCount) versionStatusMap['Outdated'] = outdatedCount;
    document.getElementById('donut-version').innerHTML = buildDonutChart(versionStatusMap, 'by Version Status');

    document.getElementById('donut-model').innerHTML    = buildDonutChart(locByModel,            'by Model', splitModelLabel);
    document.getElementById('donut-model-class').innerHTML = buildDonutChart(locByModelClass,    'By Model class');
    document.getElementById('donut-language').innerHTML = buildDonutChart(locByFeature,          'by Feature');
    document.getElementById('donut-ide').innerHTML      = buildDonutChart(locByIde,              'by IDE');
    document.getElementById('donut-activity').innerHTML = buildDonutChart(locByActivity,         'by Activity');
    document.getElementById('donut-feature').innerHTML  = buildDonutChart(locByCodeLanguage,     'Coding by Language');
    document.getElementById('donut-syntax').innerHTML   = buildDonutChart(locByDocLanguageNorm,  'Steering by Syntax');

    // Phase distribution — null users count as phase 0 (No cohort)
    const usersByPhase = {};
    for (const u of filteredUsers) {
        const pn = u.ai_adoption_phase_number ?? 0;
        const label = PHASE_LABELS[pn] || ('Phase ' + pn);
        usersByPhase[label] = (usersByPhase[label] || 0) + 1;
    }
    document.getElementById('donut-phase').innerHTML = buildDonutChart(usersByPhase, 'by AI Adoption Phase');

    // Per-model feature donuts — one donut per model listed in config.watch_model_use
    const watchModelsContainer = document.getElementById('model-donuts-grid');
    if (watchModelsContainer && watchModelUse.length > 0) {
        // Aggregate loc_by_model_feature across all filtered users
        const locByModelFeature = {}; // { [model]: { [feature]: value } }
        for (const u of filteredUsers) {
            if (!u.loc_by_model_feature) continue;
            for (const [model, features] of Object.entries(u.loc_by_model_feature)) {
                if (!locByModelFeature[model]) locByModelFeature[model] = {};
                for (const [feature, value] of Object.entries(features)) {
                    locByModelFeature[model][feature] = (locByModelFeature[model][feature] || 0) + value;
                }
            }
        }
        watchModelsContainer.innerHTML = watchModelUse.map(model =>
            `<div id="donut-model-feat-${CSS.escape(model)}"></div>`
        ).join('');
        for (const model of watchModelUse) {
            const el = document.getElementById('donut-model-feat-' + CSS.escape(model));
            if (el) el.innerHTML = buildDonutChart(locByModelFeature[model] || {}, model);
        }
    } else if (watchModelsContainer) {
        watchModelsContainer.innerHTML = '';
    }
}

// ── AI Maturity Section ──────────────────────────────────────────────────────

let _maturityTooltipEl = null;

function _getMaturityTooltip() {
    if (!_maturityTooltipEl) {
        _maturityTooltipEl = document.createElement('div');
        _maturityTooltipEl.className = 'maturity-tooltip';
        _maturityTooltipEl.style.display = 'none';
        document.body.appendChild(_maturityTooltipEl);
    }
    return _maturityTooltipEl;
}

function _positionMaturityTooltip(e) {
    const tt = _getMaturityTooltip();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = tt.offsetWidth || 380;
    const th = tt.offsetHeight || 100;
    let x = e.clientX + 18;
    let y = e.clientY + 14;
    if (x + tw > vw - 8) x = e.clientX - tw - 8;
    if (y + th > vh - 8) y = e.clientY - th - 8;
    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
}

let _ideTooltipEl = null;

function _getIdeTooltip() {
    if (!_ideTooltipEl) {
        _ideTooltipEl = document.createElement('div');
        _ideTooltipEl.className = 'maturity-tooltip';
        _ideTooltipEl.style.display = 'none';
        document.body.appendChild(_ideTooltipEl);
    }
    return _ideTooltipEl;
}

function _positionIdeTooltip(e) {
    const tt = _getIdeTooltip();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = tt.offsetWidth || 300;
    const th = tt.offsetHeight || 80;
    let x = e.clientX + 18;
    let y = e.clientY + 14;
    if (x + tw > vw - 8) x = e.clientX - tw - 8;
    if (y + th > vh - 8) y = e.clientY - th - 8;
    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
}

function renderMaturitySection(users) {
    const content = document.getElementById('maturity-content');
    if (!content) return;

    const { avgDauPct, avgTurns, avgPerf } = computeTeamAggregates(users, currentMonthFilter);
    const ctx = { watchModelUse, avgDauPct, avgTurns, avgPerf, computeStreak: computeCurrentStreak, prevMonthStats, preferredEnterpriseIds: globalPreferredEnterpriseIds, latestVersions, isUserOutdated: userHasAnyOutdated };

    const STATUS_EMOJI = { green: '🟢', amber: '🟡', red: '🔴', gray: '⚪' };
    const STATUS_VALUE_CLASS = { green: 'maturity-val-green', amber: 'maturity-val-amber', red: 'maturity-val-red', gray: '' };

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    const rows = MATURITY_RULES.map(rule => {
        const { status, value, explanation } = rule.evaluate(users, ctx);
        const rec = (status !== 'green' && status !== 'gray')
            ? (MATURITY_RECOMMENDATIONS[rule.id] || '')
            : 'No action required, keep going!';
        return { rule, status, value, explanation, rec };
    });

    content.innerHTML = `<div class="maturity-grid">${
        rows.map(({ rule, status, value, explanation, rec }) => `
            <div class="maturity-row" data-explain="${esc(explanation)}">
                <span class="maturity-icon">${STATUS_EMOJI[status]}</span>
                <span class="maturity-label">
                    <span class="maturity-name">${esc(rule.name)}</span>
                    <span class="maturity-value ${STATUS_VALUE_CLASS[status]}">( ${esc(value)} )</span>
                </span>
                <span class="maturity-rec maturity-rec-${status}">${rec}</span>
                <span class="maturity-info-icon" aria-hidden="true">ⓘ</span>
            </div>`).join('')
    }</div>`;

    // Tooltip shows only calculation logic
    const tt = _getMaturityTooltip();
    content.querySelectorAll('.maturity-row').forEach(row => {
        row.addEventListener('mouseenter', e => {
            tt.innerHTML = `<div class="maturity-tt-explain">${esc(row.dataset.explain || '')}</div>`;
            tt.style.display = 'block';
            _positionMaturityTooltip(e);
        });
        row.addEventListener('mousemove', _positionMaturityTooltip);
        row.addEventListener('mouseleave', () => { tt.style.display = 'none'; });
    });
}
