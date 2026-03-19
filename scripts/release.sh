#!/bin/bash
set -euo pipefail

# Release desktop shell: bump minor version, build Electron, merge develop → main,
# tag, push, publish to GitHub Releases.
#
# Usage: ./scripts/release.sh
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

# Bump version on develop
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
git push origin develop

# Build on develop — prove the artifact before touching main
echo ""
echo "Building desktop app..."
cd desktop
npm run build:mac
cd ..
echo "Build succeeded."

# Merge develop → main, tag, push
echo ""
echo "Merging develop → main..."
git checkout main
git pull origin main
git merge develop --no-edit
git tag "v$NEXT"
git push origin main --tags

# Publish to GitHub Releases
echo ""
echo "Publishing to GitHub Releases..."
cd desktop
npm run build:mac -- --publish always
cd ..

# Return to develop
echo ""
git checkout develop
git merge main --no-edit
git push origin develop

echo ""
echo "Released v$NEXT"
