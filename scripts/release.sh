#!/bin/bash
set -euo pipefail

# Usage: ./scripts/release.sh [version|major|minor|patch]
# Default: bumps patch version
# Examples:
#   ./scripts/release.sh          # 0.4.1 → 0.4.2
#   ./scripts/release.sh 0.5.0    # explicit version
#   ./scripts/release.sh minor    # 0.4.2 → 0.5.0
#   ./scripts/release.sh major    # 0.5.0 → 1.0.0

cd "$(git rev-parse --show-toplevel)"

# Ensure we're on develop with a clean tree
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "develop" ]; then
  echo "Error: must be on 'develop' branch (currently on '$BRANCH')"
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
  echo "Usage: $0 [version|major|minor|patch]"
  exit 1
fi

echo "Bumping to: v$NEXT"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Update versions in both package.json files
node -e "
const fs = require('fs');
for (const f of ['package.json', 'desktop/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(f, 'utf-8'));
  pkg.version = '$NEXT';
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Updated ' + f);
}
"

# Commit version bump on develop
git add package.json desktop/package.json
git commit -m "Bump to v$NEXT"

# Merge develop → main
echo ""
echo "Merging develop → main..."
git checkout main
git merge develop --no-edit

# Tag
git tag "v$NEXT"
echo "Tagged v$NEXT"

# Push main + tags
echo "Pushing main + tags..."
git push origin main --tags

# Build desktop app and publish to GitHub Releases
echo ""
echo "Building desktop app..."
cd desktop
npm run build:mac -- --publish always
cd ..

# Switch back to develop, merge main back
echo ""
echo "Syncing develop with main..."
git checkout develop
git merge main --no-edit
git push origin develop

echo ""
echo "Release v$NEXT complete!"
echo "  - main pushed with tag v$NEXT"
echo "  - GitHub Release created with desktop artifacts"
echo "  - develop synced"
