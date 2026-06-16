# Dashboard Metrics Reference

A guide to every number, chart, and column in the GitHub Copilot Dashboard.

---

## Table of Contents

1. [Key concepts](#1-key-concepts)
2. [Top summary widgets](#2-top-summary-widgets)
3. [Daily Active Users chart](#3-daily-active-users-chart)
4. [User table columns](#4-user-table-columns)
   - [Output](#output)
   - [Turns](#turns)
   - [Steering](#steering)
   - [Coding](#coding)
   - [Perf](#perf)
   - [Language](#language)
   - [Model](#model)
   - [IDE](#ide)
   - [Days](#days)
   - [Last Active](#last-active)
5. [Output breakdown donuts](#5-output-breakdown-donuts)
   - [by Model](#by-model)
   - [By Model class](#by-model-class)
   - [by Feature](#by-feature)
   - [by IDE](#by-ide)
   - [by Activity](#by-activity)
   - [Coding by Language](#coding-by-language)
   - [Steering by Syntax](#steering-by-syntax)
6. [Maturity metrics](#6-maturity-metrics)
   - [Status colors](#status-colors)
   - [Rules and thresholds](#rules-and-thresholds)

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

---

## 2. Top summary widgets

![Top summary widgets](/docs/widgets.jpg)

| Widget | What it shows |
|---|---|
| **Total Users** | Number of users with at least one activity record in the selected period. |
| **Total Turns** | Sum of all Chat asks and Agent runs across all users. A rough measure of overall AI engagement volume. |
| **Total Output** | Sum of suggested LOC + applied LOC across all users. The broadest signal of how much GHCP was used. |

When a specific month is selected, each widget also shows a delta badge (▲/▼ %) compared to the previous month.

---

## 3. Daily Active Users chart

![Daily Active Users chart](/docs/dau.jpg)

Each bar represents one calendar day. The bar height and numbers above it (absolute and percentage of total users) show how many distinct users were active that day (i.e., had at least one recorded interaction).

Saturdays and Sundays are highlighted with a red day label and excluded from average calculations together with days where no data available. 

National or Bank holidays are not observed. 

**Average metrics** (top-right of the chart) — three statistics summarising the selected period.

| Metric | Formula | Unit | 🔑 Key insight |
|---|---|---|---|
| **Avg DAU** | `sum(DAU on active business days) / count(active business days)`, the % shown is `avg_dau / total_users × 100`. | users/day, % | Baseline for daily reach — how many users actually use tool during typical workday. Target for at least 2/3 of total users. |
| **Avg Turns** | `total_turns / total_users` | turns/user | Tracks per-user engagement intensity. A rising trend signals the team is using Copilot more frequently: longer sessions. High values may signal people are not using agentic long-running sessions but more enagged with chat conversations to GHCP.  |
| **Avg Perf** | `sum(perf_score per active user) / count(active users)` | LOC / user / day | Tracks team-wide coding throughput over time. Compare months to see whether velocity is improving. |

**All-time view** shows the trailing 30 days from the most recent day with any data.  

**Month view** shows every calendar day of the selected month, including future days with zero bars.

**Delta badges** (▲/▼ %) are displayed when a specific month is selected,  comparing current values to the previous month.

---

## 4. Individual User Metrics table

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

### Turns

| Line | Value | Meaning |
|---|---|---|
| **Main** | Total turns | `user_initiated_interaction_count + cli_request_count` — sum of user-initiated chat interactions and CLI requests. |
| 🏃 2nd line | Code generation activity | `code_generation_activity_count` — count of automatic code generation events. |
| 🎯 3rd line | Code acceptance activity | `code_acceptance_activity_count` — count of code completions the user accepted. |

A month-over-month delta badge on the main number shows trend direction.

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

### Language

The programming language that accounts for the most of the user's code LOC, with the percentage shown underneath. Hover to see the full list of languages this user worked in.

🔑 Useful for mapping GHCP adoption to specific tech stacks.

---

### Model

The AI model that generated the largest share of the user's code LOC, with the percentage shown underneath. Hover to see all models used.

🔑 Frequent usage oif cheap non-reasoning models (GPT-4x) may signat that user ran out oif premium request quota. Sticking to most expensive model only (Claude Opus 4.6 at the time of writing) while using Business plan (limited to 300 premium requests at the time of writing, that translated in just 100 requests to Opus 4.6) may signal user needs more training on model selection appropriate for the task, or upgrading their plan. 

---

### IDE

The development environment that handled the most of the user's LOC, with the percentage shown underneath. Hover to see all IDEs used. Exact IDE version is available in user details pop-up.

---

### Days

| Line | Value | Meaning |
|---|---|---|
| **Main** | Active days | Number of distinct calendar days with any GHCP activity. |
| 🤖 2nd line | Agent days | Days on which the user invoked GHCP Agent mode at least once. |
| 💬 3rd line | Chat days | Days on which the user had at least one Chat interaction. |

Agent days and Chat days typically overlap.

🔑 Look for missing or very low Agent days compared to Chat days. Normally they shoudl be on-par. 

---

### Last Active

Date of the user's most recent GHCP activity record (format `DD.MM.YYYY`), with a human-friendly relative label underneath ("yesterday", "3 days ago", etc.). 

🔑 A quick signal for identifying users who have stopped engaging (unless sick / leave).

---

## 5. Output breakdown charts

All six donuts reflect the **currently filtered user set** (team filter and month filter apply). Each segment shows the share of total LOC for that dimension. Segments below 3% are excluded from labels; segments below 5% do not show a percentage on the ring. Hover any segment for the exact name and percentage.

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

Share of **all LOC** handled by each IDE (VS Code, JetBrains, Neovim, etc.).

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

## 6. Maturity metrics

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
