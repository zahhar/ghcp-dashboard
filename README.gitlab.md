# ghcp-stats — data operations

This repo is the **production deployment target**: real data and secrets live here only.

Product development happens in the  [public GitHub repo](https://github.com/zahhar/ghcp-dashboard). 

## Update data manually

### Option A — Trigger full pipeline by uploading JSON files

1. GHCP telemetry for EPAM-provisioned licenses is extracted 3x per week (Tue, Thu, Sat) and lands in [this EPAM GHCopilot Telemetry Sharepoint folder](https://epam.sharepoint.com/:f:/r/sites/EPAMGHCopilotTelemetry/Shared%20Documents/scor?d=w3a5a6e5ea645431d943cb80a0eef61e9&csf=1&web=1&e=IAeSVQ).
2. Download manually fresh JSON files with telemetry to your local hard drive. Ignore CSV.
3. Go to [Code → Repository → data/raw/inbox/](https://git.epam.com/zahhar_kirillov/scor-ghcp-dashboard/-/tree/main/data/raw/inbox), click "+" → Upload file, and drop all  new JSON telemetry files you have downloaded. Commit changes directly to `main` branch.
4. Pipeline fires automatically: ingests uploaded files → pulls GitHub API to retreieve SCOR telemetry using saved secret → builds image → deploys to K8s pod.

### Option B — Trigger full pipeline manually

Go to [Build → Pipelines** → New pipeline](https://git.epam.com/zahhar_kirillov/scor-ghcp-dashboard/-/pipelines/new), ensure branch = `main`, and simply click **New pipeline** button.

Pipeline will run and update the Dashboard.

## Option C – Daily automatic update

A schedule runs every day at 8:20am Zurich time, pulling fresh data from the GitHub API and deploying automatically. EPAM data is not ingested this way, only SCOR telemetry updated.

## Settings

Edit `data/config.json`, `data/users.json`, or `data/teams.json` directly in the GitLab file browser, commit to `main`, then trigger a manual pipeline run (Option B above) to redeploy.

When pipeline runs, watch for `refresh` step logs: it prints a list of "POTENTIAL NEW USERS DETECTED" – filtering for new usernames in SCOR telemetry whos account name is like "%-external" or "u%d". Check if those usernames belong to EPAM employees – and ad them to `data/users.json`. To silence false-positives, add them as: 

```json
"revoked": true,
"team": "scor",
```
