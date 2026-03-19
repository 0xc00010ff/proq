#!/bin/bash
set -euo pipefail

# Deploy web content: bump patch version, merge develop → main, tag, push.
# Users receive the update via git pull on next app launch.
#
# Usage: ./scripts/deploy.sh
#   0.5.0 → 0.5.1 → 0.5.2 → ...

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
NEXT="$MAJOR.$MINOR.$((PATCH + 1))"

echo "Deploy v$NEXT"
echo "App content only."
echo "Users will see small notice to update in settings."
echo "Will not make a new desktop app release."
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

# ── 2. Merge develop → main ─────────────────────────────
echo ""
echo "Merging develop → main..."
git checkout main
git pull origin main
git merge develop --no-edit

# ── 3. Tag and push ─────────────────────────────────────
echo ""
echo "Tagging v$NEXT..."
git tag "v$NEXT"

echo "Pushing main + tags..."
git push origin main --tags

# ── 4. Return to develop ────────────────────────────────
echo ""
echo "Returning to develop..."
git checkout develop
git merge main --no-edit
git push origin develop

echo ""
echo "Deployed v$NEXT"
