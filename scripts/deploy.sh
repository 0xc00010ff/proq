#!/bin/bash
set -euo pipefail

# Deploy proq: build, bump version, merge develop → main, tag, push,
# and create a GitHub release.
#
# Usage:
#   npm run deploy              Web-only release (patch bump)
#   npm run deploy -- --desktop Desktop + web release (minor bump, signs & uploads .dmg)

DESKTOP=false
if [ "${1:-}" = "--desktop" ]; then
  DESKTOP=true
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

if $DESKTOP; then
  NEXT="$MAJOR.$((MINOR + 1)).0"
else
  NEXT="$MAJOR.$MINOR.$((PATCH + 1))"
fi

REPO="0xc00010ff/proq"

echo ""
if $DESKTOP; then
  echo "Deploy v$NEXT (desktop + web)"
else
  echo "Deploy v$NEXT (web only)"
fi
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── 1. Build web ─────────────────────────────────────────
echo ""
echo "Building web..."
if ! npm run build; then
  echo ""
  echo "Build failed. Fix errors before deploying."
  exit 1
fi

# ── 2. Build desktop (if --desktop) ─────────────────────
if $DESKTOP; then
  echo ""
  echo "Building desktop app..."
  cd desktop
  npm run build:mac
  cd ..

  APP_PATH="desktop/dist/mac-arm64/proq.app"
  if [ ! -d "$APP_PATH" ]; then
    echo "Error: build artifact not found at $APP_PATH"
    exit 1
  fi
  if ! codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    echo "Error: code signing verification failed"
    exit 1
  fi
  echo "Desktop build succeeded. Code signing verified."
fi

# ── 3. Bump version ─────────────────────────────────────
echo ""
echo "Bumping to v$NEXT..."
node -e "
const fs = require('fs');
for (const f of ['package.json', 'desktop/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(f, 'utf-8'));
  pkg.version = '$NEXT';
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
}
"
npm install --package-lock-only --ignore-scripts 2>/dev/null || true
git add package.json desktop/package.json package-lock.json
git commit -m "Bump to v$NEXT"

echo "Pushing develop..."
git push origin develop

# ── 4. Merge develop → main ─────────────────────────────
echo ""
echo "Merging develop → main..."
git checkout main
git pull origin main
git merge develop --no-edit

# ── 5. Tag and push ─────────────────────────────────────
echo ""
echo "Tagging v$NEXT..."
git tag "v$NEXT"
git push origin main --tags

# ── 6. Publish desktop assets (if --desktop) ────────────
if $DESKTOP; then
  echo ""
  echo "Publishing desktop build..."
  cd desktop
  npm run build:mac -- --publish always
  cd ..
fi

# ── 7. Create GitHub release ────────────────────────────
echo ""
echo "Creating GitHub release..."

FENCE='```'
DMG_URL="https://github.com/$REPO/releases/download/v$NEXT/proq.dmg"

RELEASE_BODY="## [Download proq.dmg]($DMG_URL)

Or run from source:
${FENCE}bash
git clone https://github.com/$REPO.git && cd proq
npm run setup
npm run dev
${FENCE}

See [commits since last release](https://github.com/$REPO/compare/v$CURRENT...v$NEXT)."

if $DESKTOP; then
  # Desktop: edit the draft release created by electron-builder
  gh release edit "v$NEXT" --draft=false --title "v$NEXT" --notes "$RELEASE_BODY"
else
  gh release create "v$NEXT" --title "v$NEXT" --notes "$RELEASE_BODY"
fi

# ── 8. Return to develop ────────────────────────────────
echo ""
echo "Returning to develop..."
git checkout develop
git merge main --no-edit
git push origin develop

echo ""
echo "Deployed v$NEXT"
echo "https://github.com/$REPO/releases/tag/v$NEXT"
