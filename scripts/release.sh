#!/bin/bash
set -euo pipefail

# Usage: ./scripts/release.sh [patch|minor|major|x.y.z]
#
# Run this on main after merging from develop.
#
#   patch (default)  0.5.0 → 0.5.1   Web content release. Tags only.
#   minor            0.5.x → 0.6.0   Desktop shell release. Tags + builds + GitHub Release.
#   major            0.x.y → 1.0.0   Desktop shell release. Tags + builds + GitHub Release.
#
# Patch releases are delivered to users via git pull on next app launch.
# Minor/major releases also publish an Electron update via electron-updater.

cd "$(git rev-parse --show-toplevel)"

# Ensure we're on main with a clean tree
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: must be on 'main' branch (currently on '$BRANCH')"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean"
  exit 1
fi

# Read current version
CURRENT=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT"

# Calculate next version
BUMP="${1:-patch}"
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEXT="$BUMP"
elif [ "$BUMP" = "patch" ]; then
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  NEXT="$MAJOR.$MINOR.$((PATCH + 1))"
elif [ "$BUMP" = "minor" ]; then
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  NEXT="$MAJOR.$((MINOR + 1)).0"
elif [ "$BUMP" = "major" ]; then
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  NEXT="$((MAJOR + 1)).0.0"
else
  echo "Error: invalid version argument '$BUMP'"
  echo "Usage: $0 [patch|minor|major|x.y.z]"
  exit 1
fi

# Determine if this is a shell release (minor or major bump)
SHELL_RELEASE=false
if [ "$BUMP" = "minor" ] || [ "$BUMP" = "major" ]; then
  SHELL_RELEASE=true
fi
# Explicit version: shell release if minor or major changed
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IFS='.' read -r CUR_MAJ CUR_MIN _ <<< "$CURRENT"
  IFS='.' read -r NEW_MAJ NEW_MIN _ <<< "$NEXT"
  if [ "$NEW_MAJ" != "$CUR_MAJ" ] || [ "$NEW_MIN" != "$CUR_MIN" ]; then
    SHELL_RELEASE=true
  fi
fi

if [ "$SHELL_RELEASE" = true ]; then
  echo "Shell release: v$NEXT (will build Electron + create GitHub Release)"
else
  echo "Web release: v$NEXT (tag only, delivered via git pull)"
fi

echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── 1. Bump version ──────────────────────────────────────
node -e "
const fs = require('fs');
for (const f of ['package.json', 'desktop/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(f, 'utf-8'));
  pkg.version = '$NEXT';
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Updated ' + f);
}
"
git add package.json desktop/package.json
git commit -m "Bump to v$NEXT"

# ── 2. Tag ────────────────────────────────────────────────
git tag "v$NEXT"
echo "Tagged v$NEXT"

# ── 3. Build + publish (shell releases only) ─────────────
if [ "$SHELL_RELEASE" = true ]; then
  echo ""
  echo "Building desktop app..."
  cd desktop
  npm run build:mac -- --publish always
  cd ..
  echo "Published to GitHub Releases."
fi

# ── 4. Push ───────────────────────────────────────────────
echo ""
echo "Pushing main + tags..."
git push origin main --tags

echo ""
if [ "$SHELL_RELEASE" = true ]; then
  echo "Release v$NEXT complete! (web + shell)"
else
  echo "Release v$NEXT complete! (web only)"
fi
