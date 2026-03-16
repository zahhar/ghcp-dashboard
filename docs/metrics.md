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
   - [by Feature](#by-feature)
   - [by IDE](#by-ide)
   - [by Activity](#by-activity)
   - [Coding by Language](#coding-by-language)
   - [Steering by Syntax](#steering-by-syntax)

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

**Turns** — one interaction event. Includes a chat message typed by the user ("Chat ask") or user response (confirmation) given to an Agent. A single coding session typically generates multiple turns.

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
| **Main** | Total turns | `user_initiated + code_generation` — total interactions with GHCP. |
| 🏃 2nd line | LOC per turn | `(Suggested + Applied LOC) / Turns` — average output volume per interaction. Higher = larger changes applied. |
| 🎯 3rd line | Acceptance rate | `code_acceptance_activity / code_generation_activity` — share of generated completions that the user accepted. SIgnore it: seems telemetry does not capture it well, or we have a bug in the calculation. |

A month-over-month delta badge on the main number shows trend direction.

---

### Steering

Total LOC changed by this user in **document and prompt files** (Markdown, plain text, `.prompt`, `.instructions`, Mermaid, LaTeX, and similar).

| Line | Value |
|---|---|
| **Main** | Total steering LOC (added + deleted) |
| 2ns line | `+` added lines |
| 3rd line | `−` deleted lines |

Hover over the cell to see which document types were involved.

🔑 A user with high Steering relative to Coding often works on prompt engineering, documentation, or GHCP customisation files.

---

### Coding

Total LOC changed by this user in **programming language files**. This is the "pure code output" measure.

| Line | Value |
|---|---|
| **Main** | Total code LOC (added + deleted) |
| 2nd line | `+` added lines |
| 3rd line | `−` deleted lines |

The month-over-month percentage badge shows whether the user's code output is growing or shrinking.

---

### Perf

A daily throughput score that normalises output for users who were only active part of the period.

**Formula:** `max(code_loc_added, code_loc_deleted) / active_days`

Using `max` rather than sum means a refactoring session (high deletes) counts equally to a feature sprint (high adds). Hover the cell for the raw value.

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

Share of **code LOC** generated by each AI model (`gpt-4o`, `claude-3.5-sonnet`, etc.). Document/steering LOC is excluded so the chart reflects pure coding model usage.

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

Share of **code LOC** broken down by programming language. Document/prompt languages are excluded.

---

### Steering by Syntax

Share of **steering LOC** broken down by document type (Markdown, plain text, `.prompt`, `.instructions`, LaTeX, etc.).
