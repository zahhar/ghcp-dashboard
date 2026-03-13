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

## Mocked data included

This repository is provided with **mocked data** stored under `mock\*.json`for demonstration and development.

## Tech stack

- **Runtime:** Node.js (CommonJS)
- **Backend:** built-in `http`, `fs`, `https` modules (no framework)
- **Frontend:** vanilla HTML/CSS/JavaScript
- **Data source:** GitHub REST API
- **Storage:** local JSON/NDJSON files (`data/*.json`)

Project was intentionally built simple and file-based, so you can run it locally without infrastructure or implement your own data persistancy layer. 

## Repository structure

- `server.js` — starts the web server and serves API + static UI
- `update-data.js` — fetches new Copilot metrics, stores the, under `data/raw/*.json` and appends them to `data/data.json`
- `debug.js` — downloads hisotrical data to `data/debug/*.json`and compares it with local `data/data.json`
- `data/config.json` — stores Github Organization name and Last synchronized day
- `data/users.json` — UserId mapping to Display name, Team, Revoked status (optional)
- `data/data.json` — all your data used to build a dashboard
- `public/` — dashboard UI assets
- `docs/` – documentation and screnshots

## Quick start

### 1) Prerequisites

- Node.js 18+

### 2) Install dependencies

```bash
npm install
```

### 3) Prepare environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3) Start the dashboard

```bash
npm run dev
```

Open `http://localhost:3000` - you should see mocked data loaded.

## Using with real data

### 1) Prerequisites

- All Github Copilot users you want to monitor belong to the same Enterprise and same Organization within this Enterprise
- You creted a [GitHub personal access token (classic)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) with `read:org`, `manage_billing:copilot` or `read:enterprise` scopes.
- [Copilot usage metrics](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/manage-enterprise-policies#defining-policies-for-your-enterprise) policy must be enabled for the organization. 

### 3) Configure environment and project

1. Add `GITHUB_TOKEN` to `.env` (use `.env.example` as a template).
2. Copy `mock\config.json` to `data\config.json`
3. Edit `data\config.json`:
	 - `org`: GitHub organization name
	 - `last_report_day`: set inital day for incremental updates; note that Github Copilot Metrics API provides data only for last 28 days, so setting ot to earlier date won't bring you any data.
4. (optionally) Edit `data\users.json` to map Github usernames to human readable names, indicate revoked licenses and group users into teams. 


### 4) Pull/update metrics data

```bash
npm run update
```

This runs `update-data.js`, which:

- fetches daily reports from `last_report_day + 1` to yesterday,
- saves raw files to `data/raw/`,
- appends lines to `data/data.json`,
- updates `data/config.json` with the latest successful day.

### 3) Start the dashboard

```bash
npm start
```

Opens `http://localhost:3000` - you should see real data loaded.


## NPM tasks

- `npm start` — run the dashboard server (`node server.js`)
- `npm run dev` — same as start (no watcher currently)
- `npm run update` — fetch and append new Copilot metrics

## Troubleshooting

If you need to cherry-pick or renew one of previous day data or check that data were read fully without gaps, `debug.js` is a verification utility to validate your local dataset against fresh API downloads.

Examples:

- `node debug.js YYYY-MM-DD` — compare one day
- `node debug.js latest` — compare latest 28-day report

It downloads comparison files into `data/debug/` and prints differences for key top-level fields.


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