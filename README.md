# Yet Another Github Copilot Metrics Dashboard

Lightweight GitHub Copilot usage dashboard for teams. It reads raw metrics exposed via new [Github REST API endpoints for Copilot usage metrics](https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-usage-metrics?apiVersion=2022-11-28), aggregates them per user, and serves a browser-based leaderboard-style dashboard with filters and trend hints.

![Screenshot](/docs/screenshot.jpg)

> ⚠️ **Disclaimer:** this is a fully **vibe-coded** project that did **not** go through comprehensive code review or testing. Results may be inaccurate, and bugs are possible.

## Why this project exists

- [Github Copilot built-in dashboards are still in Public Preview](https://github.blog/changelog/2026-02-20-organization-level-copilot-usage-metrics-dashboard-available-in-public-preview/), they are yet rudimentary and require special access rights difficult to obtain in large enterprises.
- Existing external dashboards ([by Github](https://github.com/github-copilot-resources/copilot-metrics-viewer), [by Microsoft](https://github.com/microsoft/copilot-metrics-dashboard)) were not promptly updated for new REST API compartibility and likely stop working on April 2, 2026 when [Github sunsets its legacy Github Metrics API](https://docs.github.com/en/rest/copilot/copilot-metrics?apiVersion=2026-03-10). 

## Target audience
Dashbord aims at AI/Agile Coaches, Teams leaders, Engineering managers, Project- and Delivery managers, Procurement associates and helps themto quickly answer questions like:

- Who is actively using Copilot and who is not?
- Which models/IDEs/languages are most used?
- How usage differs across teams and time?

## Tech stack

- **Runtime:** Node.js (CommonJS)
- **Backend:** built-in `http`, `fs`, `https` modules (no framework)
- **Frontend:** vanilla HTML/CSS/JavaScript
- **Data source:** GitHub REST API
- **Storage:** local JSON/NDJSON files (`data.json`, `data/*.json`)

Project was intentionally built simple and file-based, so you can run it locally without infrastructure or implement your own data persistancy layer. 

## Repository structure

- `server.js` — starts the web server and serves API + static UI
- `update-data.js` — fetches new Copilot metrics and appends them to `data.json`
- `debug.js` — tool to re-download old data and compare it with local `data.json`
- `config.json` — stores Github Organization name and Last synchronized day
- `users.json` — UserId mapping to Display name, Team, Revoked status (optional)
- `data/` — raw daily downloads (not in git)
- `debug/` — debug downloads/comparison artifacts (not in git)
- `public/` — dashboard UI assets

## Quick start

### 1) Prerequisites

- Node.js 18+
- A GitHub personal access token (classic) with `read:org`, `manage_billing:copilot` or `read:enterprise` scopes.
- Copilot Metrics API access policy must be enabled for the organization. 


### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment and project

1. Add `GITHUB_TOKEN` to `.env` (use `.env.example` as a template).
2. Set your org in `config.json`:
	 - `org`: GitHub organization name
	 - `last_report_day`: bootstrap day for incremental updates


### 4) Pull/update metrics data

```bash
npm run update
```

This runs `update-data.js`, which:

- fetches daily reports from `last_report_day + 1` to yesterday,
- saves raw files to `data/`,
- appends lines to `data.json`,
- updates `config.json` with the latest successful day.

### 5) Start the dashboard

```bash
npm start
```

Open `http://localhost:3000`.

## NPM tasks

- `npm start` — run the dashboard server (`node server.js`)
- `npm run dev` — same as start (no watcher currently)
- `npm run update` — fetch and append new Copilot metrics

## Troubleshooting

If you need to cherry-pick or renew one of previous day data or check that data were read fully without gaps, `debug.js` is a verification utility to validate your local dataset against fresh API downloads.

Examples:

- `node debug.js YYYY-MM-DD` — compare one day
- `node debug.js latest` — compare latest 28-day report

It downloads comparison files into `debug/` and prints differences for key top-level fields.

## Mocked data included

This repository is provided with **mocked data** for demonstration and development.

Before using in a real environment, replace demo data with your own:

- clear `data.json`
- delete all files un `data/` and `debug/` (if any)
- update `.env`, `config.json` and `users.json` for your configuration

## Known issues and limitations

- No database (file-based storage only)
- No auth/access control (deploy locally or in secure environment)
- Update process is **not automatic**:
	- You must run `npm run update` manually, or
	- schedule it externally (cron, CI job, task scheduler)
- Limited validation and error handling
- No tests
- Metrics interpretation is generic and may not match your KPIs

## Contributing

Contributions are welcomed to address the issues and bring more features.

## License

Licensed under the **MIT License**.