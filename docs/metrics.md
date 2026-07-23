# Dashboard Metrics Reference

A guide to every number, chart, and column in the GitHub Copilot Dashboard.

---

## Table of Contents

1. [Key concepts](#1-key-concepts)
2. [Top summary widgets](#2-top-summary-widgets)
3. [Daily and Weekly Active Users chart](#3-daily-and-weekly-active-users-chart)
4. [Lines changed by AI chart](#4-lines-changed-by-ai-chart)
5. [Individual User Metrics table](#5-individual-user-metrics-table)
   - [Output](#output)
   - [Steering](#steering)
   - [Coding](#coding)
   - [Turns](#turns)
   - [Perf](#perf)
   - [AI Credits](#ai-credits)
   - [Environment](#environment)
   - [Activity](#activity)
6. [Output breakdown donuts](#6-output-breakdown-donuts)
   - [by Model](#by-model)
   - [By Model class](#by-model-class)
   - [by Feature](#by-feature)
   - [by IDE](#by-ide)
   - [by Activity](#by-activity)
   - [Coding by Language](#coding-by-language)
   - [Steering by Syntax](#steering-by-syntax)
   - [by Best Streak](#by-best-streak)
7. [Maturity metrics](#7-maturity-metrics)
   - [Status colors](#status-colors)
   - [Rules and thresholds](#rules-and-thresholds)
8. [Coding Efficiency chart](#8-coding-efficiency-chart)

---

## 1. Key concepts

**Github Copilot** is further shortened as GHCP for brevity.

**LOC (Lines of Code)** is used throughout as the primary volume metric. It counts all lines that GHCP was involved in — added and deleted — not just net insertions. 

> ⚠️ **Disclaimer:** when developer changes only one character in a line, GHCP telemetry captures this as 1 LOC added and 1 LOC deleted – similarly to how diff works. This makes calculation of new lines produced by the AI-assistant not possible.

**Suggested vs Applied LOC:**  
- **Suggested** — lines GHCP offered in a completion or chat response. The user may or may not accept them.
- **Applied** — lines that actually landed in a file (`loc_added + loc_deleted` from the API). This is the committed output.

> ⚠️ **Disclaimer:** seems that GHCP telemetry does not always reliable capture suggedted and applied LOC, most likely due to descrepancy in IDE and plugin versions or the they way developers interact with GHCP (via CLI vs plugin).

**Coding vs Steering:**  
- **Coding** — changes in programming language files (JavaScript, Python, Java, etc.).  
- **Steering** — changes in documentation or prompt files. Full list: `'markdown', 'text', 'prompt', 'instructions', 'mermaid', 'plaintext', 'bibtex', 'snippets', 'latex', 'restructuredtext', 'search-result', 'skill', 'tex', 'chatagent'`; These files are used to guide GHCP's behaviour rather than produce code directly.

**Turns** — sum of user chat interactions and CLI requests. Formula: `user_initiated_interaction_count + totals_by_cli.request_count`. Tracks engagement intensity and frequency of AI tool usage.

**AI credits** — consumption reported by GitHub as `ai_credits_used` in each per-user daily report. It is a consumption-analysis metric, not an invoicing total, and is not broken down by feature, model, or surface. Credits are attributed per license (account + organization, or enterprise when organization is unavailable), so licenses belonging to the same person are not merged.

---

## 2. Top summary widgets

![Top summary widgets](/docs/widgets.jpg)

| Widget | What it shows |
|---|---|
| **Total Users** | Number of users with at least one activity record in the selected period. |
| **Total Turns** | Sum of all Chat asks and Agent runs across all users. A rough measure of overall AI engagement volume. |
| **Total Output** | Sum of suggested LOC + applied LOC across all users. The broadest signal of how much GHCP was used. |
| **AI Credits** | Total AI credits consumed by the filtered licenses in the selected period. |

When a specific month is selected, each widget also shows a delta badge (▲/▼ %) compared to the previous month.

---

## 3. Daily and Weekly Active Users chart

![Daily Active Users chart](/docs/dau.jpg)

With a **month selected**, each bar represents one calendar day. The bar height and numbers above it (absolute users first, then percentage of total users) show how many distinct users were active that day (i.e., had at least one recorded interaction).

Saturdays and Sundays are highlighted with a red day label and excluded from average calculations together with days where no data available. 

National or Bank holidays are not observed. 

**Average metrics** (top-right of the chart) summarise the selected period.

| Metric | Formula | Unit | 🔑 Key insight |
|---|---|---|---|
| **Avg DAU** | `sum(DAU on active business days) / count(active business days)`, the % shown is `avg_dau / total_users × 100`. | users/day, % | Baseline for daily reach — how many users actually use tool during typical workday. Target for at least 2/3 of total users. |
| **Avg Turns** | `total_turns / total_users` | turns/user | Tracks per-user engagement intensity. A rising trend signals the team is using Copilot more frequently: longer sessions. High values may signal people are not using agentic long-running sessions but more enagged with chat conversations to GHCP.  |
| **Avg Credits** | `total_ai_credits / non_revoked_users` | credits/user | Average consumption per user for the selected period. License consumption is summed only for this team-level average; per-license values remain separate in the table. |
| **Avg Perf** | `sum(perf_score per active user) / count(active users)` | LOC / user / day | Tracks team-wide coding throughput over time. Compare months to see whether velocity is improving. |

**All-times view** changes the chart to **Weekly Active Users (WAU)** and shows a rolling 52-week window ending with the Monday–Sunday week containing the most recent activity record.

- One bar represents one complete calendar week, from Monday through Sunday; the label under each bar is its ISO week number.
- A user is counted once per week, even when active on multiple days.
- The blue bar height and prominent label show `WAU / currently filtered population × 100`; the smaller number below is the absolute active-user count.
- Hovering a bar shows its `DD.MM.YYYY-DD.MM.YYYY` date range plus both the WAU percentage and active-user count.
- The top summary changes to **Avg WAU**: the average weekly active-user count across the displayed 52 weeks, with its percentage of the currently filtered population.

**Month view** shows every calendar day of the selected month, including future days with zero bars.

**Delta badges** (▲/▼ %) are displayed when a specific month is selected,  comparing current values to the previous month.

---

## 4. Lines changed by AI chart

Shows **applied coding LOC only**, split into paired bars: green for `LOC added` and red for `LOC deleted`. Steering/document and prompt-file LOC, suggested LOC, and grand totals are excluded.

- **Month view:** one pair of bars per calendar day, labelled with day of month and weekday.
- **All-time view:** one pair per Monday–Sunday week, using the same rolling 52-week window as the WAU chart.
- **Y-axis:** horizontal grid lines at `0`, `2,500`, `5,000`, `7,500`, and `10,000` LOC; the scale extends in further `2,500`-LOC steps when needed.

Hover a bar pair for the exact period and added/deleted LOC values. The chart reflects the currently filtered users.

---

## 5. Individual User Metrics table

![Individual User Metrics table](/docs/table.jpg)


### Output

The broadest measure of a user's GHCP volume for the period.

| Line | Value | Meaning |
|---|---|---|
| **Main** | Suggested + Applied LOC | Everything GHCP touched for this user. |
| 💡 2nd line | Suggested LOC | `loc_suggested_to_add + loc_suggested_to_delete` — what GHCP offered. |
| ✏️ 3rd line | Applied LOC | `loc_added + loc_deleted` — what was actually written to files. |

🔑 A large gap between Suggested and Applied means the user frequently edits or rejects completions before accepting, or telemetry is not working properly.

---

### Steering

Total **Steering Output** for this user in **document and prompt files** (Markdown, plain text, `.prompt`, `.instructions`, Mermaid, LaTeX, and similar).

**Formula:** `steering_output = steering_suggested + steering_applied`

- `steering_suggested = Σ(loc_suggested_to_add + loc_suggested_to_delete)` for documentation/prompt languages
- `steering_applied = Σ(loc_added + loc_deleted)` for documentation/prompt languages

| Line | Value |
|---|---|
| **Main** | Total steering output LOC |
| 2nd line | 💡 suggested steering LOC |
| 3rd line | ✏️ applied steering LOC |

Hover over the cell to see which document types were involved.

🔑 A user with high Steering relative to Coding often works on prompt engineering, documentation, or GHCP customisation files.

---

### Coding

Total **Coding Output** for this user in **programming language files**.

**Formula:** `coding_output = coding_suggested + coding_applied`

- `coding_suggested = Σ(loc_suggested_to_add + loc_suggested_to_delete)` for programming languages
- `coding_applied = Σ(loc_added + loc_deleted)` for programming languages

| Line | Value |
|---|---|
| **Main** | Total coding output LOC |
| 2nd line | 💡 suggested coding LOC |
| 3rd line | ✏️ applied coding LOC |

The month-over-month percentage badge shows whether the user's code output is growing or shrinking.

---

### Turns

| Line | Value | Meaning |
|---|---|---|
| **Main** | Total turns | `user_initiated_interaction_count + cli_request_count` — sum of user-initiated chat interactions and CLI requests. |
| 🏃 2nd line | Code generation activity | `code_generation_activity_count` — count of automatic code generation events. |
| 🎯 3rd line | Code acceptance activity | `code_acceptance_activity_count` — count of code completions the user accepted. |

A month-over-month delta badge on the main number shows trend direction.

---

### Perf

A daily throughput score that normalises output for users who were only active part of the period.

**Formula:** `PERF = total_output / active_days`

Where:

- `total_output = suggested_loc + applied_loc`
- `suggested_loc = loc_suggested_to_add + loc_suggested_to_delete`
- `applied_loc = loc_added + loc_deleted`

Hover the cell for the raw value.

🔑 Sort by this column to find the most consistently productive users regardless of how many days they were active.

---

### AI Credits

Each visible license is shown separately; a user with licenses from multiple organizations may therefore have multiple entries. Exact-zero entries are hidden.

- **Current month:** `consumed/monthly budget (utilization %)`, a progress bar, and an end-of-month forecast. The forecast extrapolates consumption from the organization/enterprise reporting cutoff through the number of calendar days in the month. Red means the projected consumption exceeds the configured `monthly_ai_credits_per_user`; green means the budget is expected to be sufficient.
- **Any past month:** shows consumption, budget, utilization, and progress, but no forecast.
- **All times:** shows only total credits consumed by the license; budget, utilization, progress, and forecast are hidden because a single monthly budget is not meaningful across multiple months.

The user popup adds daily AI-credit consumption to the corresponding license chart. Credits are not added to the combined multi-license chart.

---

### Environment

Three compact lines show the user's favorite **language**, **model**, and **IDE**, each with its share of activity. The Copilot CLI is treated as a virtual IDE. Hover for complete lists and IDE/plugin version details; ⚠️ marks an outdated primary IDE or plugin.

---

### Activity

Shows the most recent activity date, best uninterrupted working-day streak, and a horizontal row of usage-day counts: 🤖 Agent, 💬 Chat, ⌨️ CLI, and—when present—🔍 Code Review and ☁️ Cloud Agent. Hover for the relative last-active time and total active-day count. Activity is sorted by the last active date.

---

## 6. Output breakdown charts

All donuts reflect the **currently filtered user set** (team, scope, status, search, and manager filters apply). Unless stated otherwise, each segment shows the share of total LOC for that dimension. Segments below 3% are excluded from labels; segments below 5% do not show a percentage on the ring. Hover any segment for the exact name and percentage.

![Output breakdown charts](/docs/screenshot3.jpg)

---

### by Model

Share of **all output LOC** generated by each AI model (`gpt-4o`, `claude-3.5-sonnet`, etc.), including both suggested and applied output.

---

### By Model class

Uses the same model-output source as **by Model**, but groups models into three buckets:

- **expensive models** — combined output from all models listed under `config.watch_model_use.expensive`
- **weak models** — combined output from all models listed under `config.watch_model_use.weak`
- **regular models** — combined output from every other model not listed in `config.watch_model_use`

The watched-model configuration may be grouped in `config.json`, but the dashboard still flattens all configured models into one consolidated watch list anywhere the legacy list behavior is expected.

---

### by Feature

Share of **all LOC** (code + steering) broken down by GHCP feature: `inline`, `chat`, `agent`, etc.

---

### by IDE

Share of **all LOC** handled by each IDE (VS Code, JetBrains, Neovim, etc.). The Copilot **CLI** appears as its own `cli` slice, counting only LOC that is not already attributed to an IDE, so there is no double counting.

---

### by Activity

A binary split of total LOC into **Coding** vs **Steering**. Gives an at-a-glance view of how much GHCP effort is going into producing code versus writing prompts, documentation, and AI instructions.

---

### Coding by Language

Share of **coding output LOC** (suggested + applied) broken down by programming language. Document/prompt languages are excluded.

---

### Steering by Syntax

Share of **steering output LOC** (suggested + applied) broken down by document type (Markdown, plain text, `.prompt`, `.instructions`, LaTeX, etc.).

---

### by Best Streak

Share of filtered **users** (not LOC) grouped by their best activity streak in the selected period. The value is the same longest uninterrupted run of active **working days** shown in the table's Activity column; weekends do not break a streak.

| Bucket | Best streak |
|---|---|
| No activity | no data or 0 days |
| 1 day | 1 day |
| 2–4 days | 2 to 4 days, inclusive |
| 5–7 days | 5 to 7 days, inclusive |
| 8–10 days | 8 to 10 days, inclusive |
| 11+ days | 11 or more days |

---

## 7. Maturity metrics

The **AI Maturity** block evaluates the currently filtered team (same filters as table/charts) using rule-based statuses from `public/maturity-rules.js`.

### Status colors

- 🟢 **Green** — target state
- 🟡 **Amber** — acceptable but needs improvement
- 🔴 **Red** — immediate concern
- ⚪ **Gray** — not enough data for evaluation

### Rules and thresholds

| Metric | How calculated (from code) | Green | Amber | Red | Gray |
|---|---|---|---|---|---|
| **DAU** | Uses `avgDauPct` from business days with data. | `>= 70%` | `40–69%` | `< 40%` | no DAU data |
| **Use Consistency** | For active users (`!revoked && !never_active`), compute each user's best uninterrupted **working-day** streak; count users with streak `>= 5`. | all active users have streak `>= 5` | at least one has streak `>= 5` | none has streak `>= 5` | no active users |
| **Agentic Coding** | Team-wide check for feature signals: `CLI`, `Custom mode`, `Agent mode`, `Agent edit`, `Agent mode panel`, `Steering`, `Skills`. | all signals used | some signals used | no signals used | — |
| **Agentic AI Champion** | Uses `ai_adoption_phase_number` on non-revoked users. | at least one user in phase 2 or 3 | no users in phase 2/3 **and** no users in phase 0 | at least one user in phase 0 | no users |
| **Avg Turns** | `avgTurns = total turns / non-revoked users`. | `>= 100` turns/user/month | `50–99` | `< 50` | no users |
| **Avg Perf** | `avgPerf = average(perf_score)` over active non-revoked users. | `>= 100` LOC/user/day | `50–99` | `< 50` | no active users |
| **Perf Consistency** | Compare current vs previous month for comparable users (non-revoked, active, with previous `perf_score > 0`): `dropPct = (prev-curr)/prev`. | no drop `> 50%` | max drop `> 50%` and `< 100%` | any drop `>= 100%` (to zero) | no comparable previous-period data |
| **Optimal Model Use** | Active users are compliant when normalized `favorite_model` is **not** in the flattened watch list derived from `config.watch_model_use` (all configured groups combined). | all compliant | some compliant | none compliant | no watch list configured |
| **Licence Use** | Uses account-level attribution and preferred enterprise IDs (`preferred_license: true`). | all users active, single-account, and each account belongs to preferred enterprise | license setup non-ideal (mixed enterprises and/or multi-account) | immediate red if any preferred-enterprise account exists but has no usage in selected period; also red if any `never_active` user | no users |

> Notes:
>
> - Licence rule evaluates account-level usage from `account_daily` + account enterprise attribution.
> - In user popup, preferred-enterprise accounts with no activity are marked with 🔴 near account title and in no-data message.

---

## 8. Coding Efficiency chart

Shows the **top 20 most efficient** and **top 20 least efficient** users in the currently filtered set. Efficiency is calculated as:

`coding LOC / AI credits spent × 1,000`

Coding LOC is suggested + applied LOC in programming-language files; steering/document and prompt-file output is excluded. Users appear only after reaching both **1,000 coding LOC** and **1,000 AI credits spent**.

Hover a bar for the source coding-LOC and credit figures. Select a user name to jump to that user's row in the table. **Red bars** indicate that at least one visible license is forecast to exceed its monthly AI-credit budget.
