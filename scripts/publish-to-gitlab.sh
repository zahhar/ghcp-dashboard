#!/usr/bin/env bash
set -euo pipefail

# Publishes a minimal CI/deploy bundle to a separate GitLab repo.
#
# Required env:
#   GITLAB_REPO_URL  e.g. git@git.epam.com:zahhar_kirillov/scor-ghcp-dashboard.git
#
# Optional env:
#   TARGET_BRANCH    default: main
#   SOURCE_ROOT      default: project root (parent of this script)
#   GIT_AUTHOR_NAME  default: deploy-bot
#   GIT_AUTHOR_EMAIL default: deploy-bot@local
#
# Usage
# GITLAB_REPO_URL='git@git.epam.com:zahhar_kirillov/scor-ghcp-dashboard.git' ./scripts/publish-to-gitlab.sh

: "${GITLAB_REPO_URL:?GITLAB_REPO_URL is required}"

TARGET_BRANCH="${TARGET_BRANCH:-main}"
SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-deploy-bot}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-deploy-bot@local}"

required_files=(
  "Dockerfile"
  ".dockerignore"
  "server.js"
  "data/data.json"
  "data/config.json"
  "data/users.json"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$SOURCE_ROOT/$file" ]]; then
    echo "❌ Missing required file: $SOURCE_ROOT/$file"
    exit 1
  fi
done

if [[ ! -d "$SOURCE_ROOT/public" ]]; then
  echo "❌ Missing required directory: $SOURCE_ROOT/public"
  exit 1
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/ghcp-deploy.XXXXXX")"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "📦 Preparing deploy bundle in: $workdir"

git -C "$workdir" init -q
git -C "$workdir" remote add origin "$GITLAB_REPO_URL"

if git ls-remote --exit-code --heads "$GITLAB_REPO_URL" "$TARGET_BRANCH" >/dev/null 2>&1; then
  git -C "$workdir" fetch --depth=1 origin "$TARGET_BRANCH"
  git -C "$workdir" checkout -B "$TARGET_BRANCH" FETCH_HEAD
else
  git -C "$workdir" checkout --orphan "$TARGET_BRANCH"
fi

# Clean everything except .git metadata
find "$workdir" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

# Copy whitelist only
mkdir -p "$workdir/public" "$workdir/data"
cp "$SOURCE_ROOT/Dockerfile" "$workdir/"
cp "$SOURCE_ROOT/.dockerignore" "$workdir/"
cp "$SOURCE_ROOT/server.js" "$workdir/"
cp -R "$SOURCE_ROOT/public/." "$workdir/public/"
cp "$SOURCE_ROOT/data/data.json" "$workdir/data/"
cp "$SOURCE_ROOT/data/config.json" "$workdir/data/"
cp "$SOURCE_ROOT/data/users.json" "$workdir/data/"

mkdir -p "$workdir/k8s"
cp "$SOURCE_ROOT/k8s/deployment.yaml" "$workdir/k8s/"

# Optionally include GitLab pipeline file if present.
if [[ -f "$SOURCE_ROOT/.gitlab-ci.yml" ]]; then
  cp "$SOURCE_ROOT/.gitlab-ci.yml" "$workdir/"
fi

# Defensive: ensure secrets are never present in deploy repo.
rm -f "$workdir/.env" "$workdir/.env.example"

# Commit only when there are actual content changes.
git -C "$workdir" add -A
if git -C "$workdir" diff --cached --quiet; then
  echo "✅ No changes in deploy bundle. Nothing to push."
  exit 0
fi

source_sha="no-git-sha"
if git -C "$SOURCE_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  source_sha="$(git -C "$SOURCE_ROOT" rev-parse --short HEAD)"
fi

git -C "$workdir" \
  -c user.name="$GIT_AUTHOR_NAME" \
  -c user.email="$GIT_AUTHOR_EMAIL" \
  commit -m "deploy bundle from source ${source_sha}"

# GitLab repo is CI-only, so we keep it as a materialized snapshot.
git -C "$workdir" push origin "$TARGET_BRANCH" --force

echo "🚀 Deploy bundle pushed to $GITLAB_REPO_URL ($TARGET_BRANCH)"
