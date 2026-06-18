// ── AI Maturity Rules ────────────────────────────────────────────────────────
// Declarative config for rule-based AI maturity assessment.
//
// To add a rule:
//   1. Push a new entry to MATURITY_RULES (below).
//   2. Add its recommendation text to MATURITY_RECOMMENDATIONS (keyed by id).
//
// Each rule object:
//   id         – unique string key
//   name       – display label shown in the maturity table
//   evaluate(users, ctx) → { status, value, explanation }
//     users          – current filtered user array (team/scope filter applied)
//     ctx.watchModelUse  – string[] from config.watch_model_use
//     ctx.avgDauPct      – number|null  (avg DAU % pre-computed by renderer)
//     ctx.computeStreak  – fn(activeDaysList, lastActiveDay) → number
//                          returns longest uninterrupted working-day streak in selected period
//     ctx.prevMonthStats – object|null  keyed by user_login, each value has { perf_score, turns, active_days_count, … }
//                          null when no previous month data is available (all-time mode)
//     ctx.preferredEnterpriseIds – string[]  enterprise IDs with preferred_license: true in config.json
//     status:       'green' | 'amber' | 'red' | 'gray'
//     value:        short result string rendered in the row
//     explanation:  how the metric was calculated (shown in hover tooltip)
// ─────────────────────────────────────────────────────────────────────────────

// ── Single source of truth for maturity metric thresholds ──────────────────
// Used by both maturity rules and DAU chart color coding. Keep in sync.
const MATURITY_THRESHOLDS = {
    dau: {
        green: 70,    // ≥ 70%
        amber: 40,    // 40–69%
        // Red: < 40%
    },
    avg_turns: {
        green: 100,   // ≥ 100 turns/user/month
        amber: 50,    // 50–99
        // Red: < 50
    },
    avg_perf: {
        green: 250,   // ≥ 250 LOC/user/day
        amber: 100,   // 100–249
        // Red: < 100
    },
};

const MATURITY_RECOMMENDATIONS = {
    dau:
        'Setup pair programming sessions between inactive and active users. Ensure user logged into IDE/CLI with GH account. Revoke licenses for non-coding roles.',
    consistency:
        'Check if team members have enough tasks to use GHCP. Eliminate non-coding activities, meetings or other low-value tasks.',
    agentic_coding:
        'Revisit AI-Katas and <a href="https://github.com/github/awesome-copilot" target="_blank" rel="noopener">Awesome Copilot</a>. Check team has custom agents or skills in codebase. Identify agentic use-cases or skill use patterns.',
    agentic_pioneer:
        'Find volunteer or assign team lead to take course on GHCP and Agentic Engineering: <a href="https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-300" target="_blank" rel="noopener">GH-300</a> and <a href="https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-600" target="_blank" rel="noopener">GH-600</a>',
    avg_turns:
        'Encourage "ask-before-search" behavior for routine tasks. Verify team installed allowed MCP servers (MS Learn, ADO, Playwright) and know how to use them.',
    avg_perf:
        'Review tasks team committed to delivering in the sprint and ensure they have enough coding, testing and documentation tasks for all team members.',
    perf_consistency:
        'Discuss backlog health and nature of work with the team. Add new work to reduce technical debt, improve test coverage & documentation.',
    optimal_model_use:
        'Train team on model selection by task type (speed vs reasoning), and set a simple "right model for right task" guide for daily use. Check limits – use of a cheap model may indicate user ran out of budget.',
    licence:
        'Complete transition to single account provided by customer. Revoke unused / duplicated licenses.',
    updated_tools:
        'Remind to update IDE, GHCP plugin and CLI to most recent version.',
};

const MATURITY_RULES = [
    // ── 1. DAU ────────────────────────────────────────────────────────────────
    // Green ≥ 70% | Amber 40–69% | Red < 40%
    {
        id: 'dau',
        name: 'DAU',
        evaluate(users, ctx) {
            if (ctx.avgDauPct == null) {
                return { status: 'gray', value: 'N/A', explanation: 'No DAU data available for the selected period.' };
            }
            const pct = ctx.avgDauPct;
            const status = pct >= MATURITY_THRESHOLDS.dau.green ? 'green' : pct >= MATURITY_THRESHOLDS.dau.amber ? 'amber' : 'red';
            return {
                status,
                value: pct + '%',
                explanation: `Thresholds: Green ≥ ${MATURITY_THRESHOLDS.dau.green}%, Amber ${MATURITY_THRESHOLDS.dau.amber}–${MATURITY_THRESHOLDS.dau.green - 1}%, Red < ${MATURITY_THRESHOLDS.dau.amber}%.`,
            };
        },
    },

    // ── 2. Use Consistency ────────────────────────────────────────────────────
    // Green = ALL users have ≥5-day best streak in selected period | Amber = at least one | Red = none
    {
        id: 'consistency',
        name: 'Use Consistency',
        evaluate(users, ctx) {
            const active = users.filter(u => !u.revoked && !u.never_active);
            if (!active.length) {
                return { status: 'gray', value: '0 users', explanation: 'No active users in current view.' };
            }
            const streaks = active.map(u => ctx.computeStreak(u.active_days_list, u.last_active_day));
            const with_streak = streaks.filter(s => s >= 5).length;
            const status = with_streak === active.length ? 'green' : with_streak > 0 ? 'amber' : 'red';
            return {
                status,
                value: `${with_streak}/${active.length} users`,
                explanation: `Users with a best streak of ≥ 5 consecutive working days in the selected period: ${with_streak} of ${active.length}. Streak is the longest uninterrupted run of active working days (weekends excluded from continuity). Green = all users qualify, Amber = at least one, Red = none.`,
            };
        },
    },

    // ── 3. Agentic Coding ─────────────────────────────────────────────────────
    // 6 agentic signals; Green = all used | Amber = some | Red = none
    {
        id: 'agentic_coding',
        name: 'Agentic Coding',
        evaluate(users, ctx) {
            const active = users.filter(u => !u.revoked && !u.never_active);
            const FEATURES = {
                'CLI':         u => (u.cli_days_count || 0) > 0 || (u.cli_turns || 0) > 0,
                'Custom mode': u => !!(u.loc_by_feature && (u.loc_by_feature['chat_panel_custom_mode'] || 0) > 0),
                'Agent mode':  u => (u.agent_days_count || 0) > 0,
                'Agent edit':  u => !!(u.loc_by_feature && (u.loc_by_feature['agent_edit'] || 0) > 0),
                'Agent mode panel': u => !!(u.loc_by_feature && (u.loc_by_feature['chat_panel_agent_mode'] || 0) > 0),
                'Steering':    u => (u.doc_loc_changed || 0) > 0,
                'Skills':      u => Array.isArray(u.all_doc_languages_list) && u.all_doc_languages_list.some(l => l.toLowerCase() === 'skill' || l.toLowerCase() === 'skills')
            };
            const used = [], missing = [];
            for (const [name, check] of Object.entries(FEATURES)) {
                (active.some(check) ? used : missing).push(name);
            }
            const total = Object.keys(FEATURES).length;
            const status = missing.length === 0 ? 'green' : used.length > 0 ? 'amber' : 'red';
            const value = missing.length === 0
                ? 'All features in use'
                : `Features to adopt: ${missing.join(', ')}`;
            return {
                status,
                value,
                explanation: `Agentic features used team-wide — Used: ${used.join(', ') || '—'}. Checked: ${Object.keys(FEATURES).join(', ')}. Green = all features used, Amber = some, Red = none.`,
            };
        },
    },

    // ── 4. Agentic AI Champion ─────────────────────────────────────────────────
    // Green = ≥1 user on phase 2/3 | Amber = all on ph1, none on ph0 | Red = any on ph0
    {
        id: 'agentic_pioneer',
        name: 'Agentic AI Champion',
        evaluate(users, ctx) {
            const all = users.filter(u => !u.revoked);
            if (!all.length) {
                return { status: 'gray', value: 'No users', explanation: 'No users in current view.' };
            }
            const counts = [0, 1, 2, 3].map(p => all.filter(u => (u.ai_adoption_phase_number ?? 0) === p).length);
            const status = counts[2] + counts[3] > 0 ? 'green' : counts[0] === 0 ? 'amber' : 'red';
            return {
                status,
                value: counts[2] + counts[3] > 0 ? 'Present' : 'Absent',
                explanation: `Green = at least one user on Phase 2 (Agent-first) or Phase 3 (Multi-agent). Amber = all on Phase 1 (Code first), none on Phase 0 (No cohort). Red = at least one user on Phase 0.`,
            };
        },
    },

    // ── 5. Avg Turns / User ───────────────────────────────────────────────────
    // Green ≥ 100 | Amber 50–99 | Red < 50  (per user per month)
    {
        id: 'avg_turns',
        name: 'Avg Turns',
        evaluate(users, ctx) {
            const total = users.filter(u => !u.revoked).length;
            if (!total) {
                return { status: 'gray', value: 'N/A', explanation: 'No users in current view.' };
            }
            const avg = ctx.avgTurns;
            const status = avg >= MATURITY_THRESHOLDS.avg_turns.green ? 'green' : avg >= MATURITY_THRESHOLDS.avg_turns.amber ? 'amber' : 'red';
            return {
                status,
                value: `${avg} turns/user/month`,
                explanation: `Avg turns per user = ${avg} (total turns ÷ ${total} non-revoked users). Thresholds per period: Green ≥ ${MATURITY_THRESHOLDS.avg_turns.green}, Amber ${MATURITY_THRESHOLDS.avg_turns.amber}–${MATURITY_THRESHOLDS.avg_turns.green - 1}, Red < ${MATURITY_THRESHOLDS.avg_turns.amber}.`,
            };
        },
    },

    // ── 6. Avg Perf / User ────────────────────────────────────────────────────
    // Green ≥ 250 LOC/user/day | Amber 100–249 | Red < 100
    {
        id: 'avg_perf',
        name: 'Avg Perf',
        evaluate(users, ctx) {
            const activeCount = users.filter(u => !u.revoked && (u.active_days_count || 0) > 0).length;
            if (!activeCount) {
                return { status: 'gray', value: 'N/A', explanation: 'No active users in current view.' };
            }
            const avg = ctx.avgPerf;
            const status = avg >= MATURITY_THRESHOLDS.avg_perf.green ? 'green' : avg >= MATURITY_THRESHOLDS.avg_perf.amber ? 'amber' : 'red';
            return {
                status,
                value: `${avg} LOC/user/day`,
                explanation: `Avg PERF = ${avg} LOC/user/day (sum of perf_scores ÷ ${activeCount} active users). PERF per user = Total Output ÷ active days, where Total Output = suggested LOC + applied LOC. Thresholds: Green ≥ ${MATURITY_THRESHOLDS.avg_perf.green}, Amber ${MATURITY_THRESHOLDS.avg_perf.amber}–${MATURITY_THRESHOLDS.avg_perf.green - 1}, Red < ${MATURITY_THRESHOLDS.avg_perf.amber}.`,
            };
        },
    },

    // ── 7. Performance Consistency ────────────────────────────────────────────
    // Green = no user's PERF dropped > 50% | Amber = some dropped > 50% | Red = any dropped 100% (to zero)
    // Gray = no previous period data available (all-time mode or first month)
    {
        id: 'perf_consistency',
        name: 'Perf Consistency',
        evaluate(users, ctx) {
            const active = users.filter(u => !u.revoked && !u.never_active);
            // Only compare users who have both a current perf_score and a previous month record
            const comparable = active.filter(u =>
                ctx.prevMonthStats &&
                ctx.prevMonthStats[u.user_login] &&
                (ctx.prevMonthStats[u.user_login].perf_score || 0) > 0
            );
            if (!comparable.length) {
                return { status: 'gray', value: 'N/A', explanation: 'No previous period data for comparison (all-time mode or first month in dataset). New team members without previous data are excluded.' };
            }
            let maxDropPct = 0;
            const degraded = [];
            for (const u of comparable) {
                const prev = ctx.prevMonthStats[u.user_login].perf_score;
                const curr = u.perf_score || 0;
                const dropPct = Math.round((prev - curr) / prev * 100);
                if (dropPct > maxDropPct) maxDropPct = dropPct;
                if (dropPct > 50) degraded.push(`${u.human_name} (−${dropPct}%)`);
            }
            // Red: any user's PERF fell to 0 (100% drop) | Amber: any drop > 50% | Green: all ≤ 50%
            const status = maxDropPct >= 100 ? 'red' : maxDropPct > 50 ? 'amber' : 'green';
            const degradedStr = degraded.length ? ` Degraded: ${degraded.join(', ')}.` : '';
            return {
                status,
                value: status === 'green' ? 'No severe drop' : `${degraded.length} user(s) dropped`,
                explanation: `PERF consistency vs previous month — comparing ${comparable.length} user(s) with prior data. Max drop: ${maxDropPct}%.${degradedStr} New members (no prior data) excluded. Green = no drop > 50%, Amber = some > 50%, Red = any reached 0.`,
            };
        },
    },

    // ── 8. Optimal Model Use ──────────────────────────────────────────────────
    // Uses the same per-user `favorite_model` field shown in the table.
    // Green = all users compliant (favorite model NOT in watch list) | Amber = some compliant | Red = none compliant
    {
        id: 'optimal_model_use',
        name: 'Optimal Model Use',
        evaluate(users, ctx) {
            if (!ctx.watchModelUse || !ctx.watchModelUse.length) {
                return { status: 'gray', value: 'N/A', explanation: 'No watch_model_use list configured in config.json.' };
            }

            const normalizeFavoriteModel = (raw) => {
                const s = String(raw || '').trim();
                if (!s || s === '-') return '';
                // favorite_model comes decorated for table display: "model<br><span>xx%</span>"
                const firstLine = s.split(/<br\s*\/?\s*>/i)[0];
                return String(firstLine || '').replace(/<[^>]*>/g, '').trim().toLowerCase();
            };

            const watched = new Set(
                ctx.watchModelUse
                    .map(m => String(m || '').trim().toLowerCase())
                    .filter(Boolean)
            );

            const active = users.filter(u => !u.revoked && !u.never_active);
            if (!active.length) {
                return { status: 'green', value: '0/0 users', explanation: 'No active users.' };
            }

            const monitoredUsers = active.filter(u => watched.has(normalizeFavoriteModel(u.favorite_model)));
            const compliant = active.length - monitoredUsers.length;
            const status = monitoredUsers.length === 0 ? 'green' : monitoredUsers.length < active.length ? 'amber' : 'red';
            return {
                status,
                value: `${compliant}/${active.length} compliant`,
                explanation: `Users are compliant when favorite modelfore is NOT in watch list [${ctx.watchModelUse.join(', ')}]. Green = all compliant, Amber = some compliant, Red = none compliant.`,
            };
        },
    },

    // ── 9. Licence Use ────────────────────────────────────────────────────────
    // Red = any never-active user (licensed but never used GHCP — wasted license) |
    // Amber = all active, single-account, but not all from preferred enterprise |
    // Green = all active, single-account, all from preferred enterprise
    {
        id: 'licence',
        name: 'Licence Use',
        evaluate(users, ctx) {
            const preferred = new Set((ctx.preferredEnterpriseIds || []).map(String));
            const all = users.filter(u => !u.revoked);
            if (!all.length) {
                return { status: 'gray', value: 'No users', explanation: 'No users in current view.' };
            }

            const isPreferredEnterpriseAccount = (u, login) => {
                if (!preferred.size) return false;
                const ids = Array.isArray(u.account_enterprise_ids?.[login])
                    ? u.account_enterprise_ids[login].map(String)
                    : [];
                if (ids.length > 0) {
                    return ids.some(id => preferred.has(id));
                }
                // Heuristic fallback for provisioned-but-unused customer accounts.
                return String(login || '').toLowerCase().endsWith('external');
            };

            const isAccountUsedInPeriod = (u, login) => {
                const rows = u.account_daily?.[login];
                return Array.isArray(rows) && rows.length > 0;
            };

            // Red (immediate): preferred-enterprise account exists in users list but has no usage in selected period.
            const preferredUnusedAccounts = [];
            for (const u of all) {
                const accounts = Array.isArray(u.accounts) ? u.accounts : [];
                for (const login of accounts) {
                    if (!isPreferredEnterpriseAccount(u, login)) continue;
                    if (!isAccountUsedInPeriod(u, login)) {
                        preferredUnusedAccounts.push(`${u.human_name} (${login})`);
                    }
                }
            }
            if (preferredUnusedAccounts.length > 0) {
                return {
                    status: 'red',
                    value: `${preferredUnusedAccounts.length} preferred license${preferredUnusedAccounts.length > 1 ? 's' : ''} unused`,
                    explanation: `Preferred enterprise account(s) were provisioned but not used in the selected period: ${preferredUnusedAccounts.join(', ')}. Red = immediate when any preferred-enterprise license is unused.`,
                };
            }

            // Red: never-active users = licensed but never used GHCP (wasted license)
            const neverActive = all.filter(u => u.never_active);
            if (neverActive.length > 0) {
                const names = neverActive.map(u => u.human_name).join(', ');
                const prefNote = preferred.size > 0 ? ' These licenses were provided by the preferred enterprise.' : '';
                return {
                    status: 'red',
                    value: `${neverActive.length} unused license${neverActive.length > 1 ? 's' : ''}`,
                    explanation: `${neverActive.length} user(s) have never used GHCP: ${names}.${prefNote} Red = any user with no GHCP activity. Revoke unused licenses.`,
                };
            }

            const active = all; // no never_active at this point
            const multiAccount = active.filter(u => Array.isArray(u.accounts) && u.accounts.length > 1);

            // Green: all single-account from preferred enterprise
            if (preferred.size > 0 && multiAccount.length === 0) {
                const allFromPreferred = active.every(u => {
                    const accounts = Array.isArray(u.accounts) ? u.accounts : [];
                    if (accounts.length !== 1) return false;
                    return isPreferredEnterpriseAccount(u, accounts[0]);
                });
                if (allFromPreferred) {
                    return {
                        status: 'green',
                        value: `${active.length} users, 1 account`,
                        explanation: `All ${active.length} users have a single account from the preferred enterprise. No unused licenses.`,
                    };
                }
            }

            // Amber: mixed enterprises, multi-account, or preferred not configured
            const enterpriseIds = new Set(active.flatMap(u => Array.isArray(u.enterprise_ids) ? u.enterprise_ids : []));
            const multiNote = multiAccount.length > 0 ? ` ${multiAccount.length} user(s) use 2+ accounts: ${multiAccount.map(u => u.human_name).join(', ')}.` : '';
            const prefNote = preferred.size > 0 ? ' Not all accounts are from the preferred enterprise.' : ' No preferred enterprise configured in config.json.';
            return {
                status: 'amber',
                value: multiAccount.length > 0 ? `${multiAccount.length} multi-account` : `${enterpriseIds.size} enterprise${enterpriseIds.size !== 1 ? 's' : ''}`,
                explanation: `All ${active.length} users are active but license setup is not ideal.${multiNote}${prefNote} Green = all single-account from preferred enterprise, Red = any user with no GHCP activity.`,
            };
        },
    },

    // ── 10. Updated Tools ─────────────────────────────────────────────────────
    // Green = all users on latest | Amber = some outdated | Red = all outdated
    // ctx.isUserOutdated(u) and ctx.latestVersions are injected by renderMaturitySection
    {
        id: 'updated_tools',
        name: 'Updated Tools',
        evaluate(users, ctx) {
            if (!ctx.isUserOutdated || !ctx.latestVersions) {
                return { status: 'gray', value: 'N/A', explanation: 'Version data not available.' };
            }
            const active = users.filter(u => !u.revoked && !u.never_active);
            const withVersionData = active.filter(u => {
                const hasIdes = (u.account_ides && Object.keys(u.account_ides).length > 0) ||
                                (u.ide_versions  && Object.keys(u.ide_versions).length  > 0);
                const hasCli  = (u.account_cli   && Object.values(u.account_cli).some(Boolean)) || !!u.cli_version;
                return hasIdes || hasCli;
            });
            if (!withVersionData.length) {
                return { status: 'gray', value: 'N/A', explanation: 'No version data available for the selected period.' };
            }
            const outdatedUsers = withVersionData.filter(u => ctx.isUserOutdated(u));
            const newestCount   = withVersionData.length - outdatedUsers.length;

            // Build a readable summary of what the period-max versions are
            const latestIdeParts = Object.keys(ctx.latestVersions.ides).join(', ') || '—';
            const hasCliData = ctx.latestVersions.cli > 0;
            const latestSummary = latestIdeParts + (hasCliData ? ', CLI' : '');

            if (outdatedUsers.length === 0) {
                return {
                    status: 'green',
                    value: `All ${withVersionData.length} up-to-date`,
                    explanation: `All ${withVersionData.length} user(s) with version data are on the latest IDE, plugin and CLI versions seen in this period. Tools tracked: ${latestSummary}.`,
                };
            }
            if (newestCount === 0) {
                const names = outdatedUsers.map(u => u.human_name).join(', ');
                return {
                    status: 'red',
                    value: `All ${outdatedUsers.length} outdated`,
                    explanation: `All ${outdatedUsers.length} user(s) with version data are running outdated IDE, plugin or CLI versions. Users: ${names}. Tools tracked: ${latestSummary}.`,
                };
            }
            const names = outdatedUsers.map(u => u.human_name).join(', ');
            return {
                status: 'amber',
                value: `${outdatedUsers.length}/${withVersionData.length} outdated`,
                explanation: `${outdatedUsers.length} of ${withVersionData.length} user(s) are running outdated tools. Outdated: ${names}. Tools tracked: ${latestSummary}.`,
            };
        },
    },
];
