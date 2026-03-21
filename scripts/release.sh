#!/bin/bash
set -euo pipefail

# Release desktop shell: bump minor version, build Electron, merge develop → main,
# tag, push, publish to GitHub Releases.
#
# Usage: ./scripts/release.sh --desktop
#   0.5.3 → 0.6.0, 0.6.x → 0.7.0, ...

if [ "${1:-}" != "--desktop" ]; then
  echo "This builds and publishes a new desktop shell release."
  echo "Usage: npm run release -- --desktop"
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "develop" ]; then
  echo "Error: must be on 'develop' branch (currently on '$BRANCH')"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean"
  exit 1
fi

CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEXT="$MAJOR.$((MINOR + 1)).0"

echo "Release v$NEXT (desktop shell + web content)"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── 1. Bump version on develop ───────────────────────────
echo ""
echo "Bumping version to v$NEXT..."
node -e "
const fs = require('fs');
for (const f of ['package.json', 'desktop/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(f, 'utf-8'));
  pkg.version = '$NEXT';
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  Updated ' + f);
}
"
git add package.json desktop/package.json
git commit -m "Bump to v$NEXT"

echo ""
echo "Pushing develop..."
git push origin develop

# ── 2. Build on develop ──────────────────────────────────
echo ""
echo "Building desktop app..."
cd desktop
npm run build:mac
cd ..

# Verify code signing succeeded
APP_PATH="desktop/dist/mac-arm64/proq.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Error: build artifact not found at $APP_PATH"
  exit 1
fi
if ! codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
  echo "Error: code signing verification failed for $APP_PATH"
  echo "The app is not properly signed. Aborting before merge."
  exit 1
fi
echo "Build succeeded. Code signing verified."

# ── 3. Merge develop → main ─────────────────────────────
echo ""
echo "Merging develop → main..."
git checkout main
git pull origin main
git merge develop --no-edit

# ── 4. Tag and push ─────────────────────────────────────
echo ""
echo "Tagging v$NEXT..."
git tag "v$NEXT"

echo "Pushing main + tags..."
git push origin main --tags

# ── 5. Publish to GitHub Releases ────────────────────────
echo ""
echo "Publishing to GitHub Releases..."
cd desktop
npm run build:mac -- --publish always
cd ..

echo ""
echo "Publishing release..."
gh release edit "v$NEXT" --draft=false

# ── 6. Return to develop ────────────────────────────────
echo ""
echo "Returning to develop..."
git checkout develop
git merge main --no-edit
git push origin develop

echo ""
echo "Released v$NEXT"
