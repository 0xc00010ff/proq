#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
info() { echo -e "  ${DIM}$1${RESET}"; }

echo ""
echo -e "${BOLD}proq setup${RESET}"
echo ""

# ── Node.js ──────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js $NODE_VERSION"
  else
    fail "Node.js $NODE_VERSION found — v18+ required"
    exit 1
  fi
else
  fail "Node.js not found — install v18+ from https://nodejs.org"
  exit 1
fi

# ── Claude Code CLI ──────────────────────────────────────────────────
CLAUDE_BIN=""
if command -v claude &>/dev/null; then
  CLAUDE_BIN=$(command -v claude)
elif [ -x /opt/homebrew/bin/claude ]; then
  CLAUDE_BIN=/opt/homebrew/bin/claude
elif [ -x /usr/local/bin/claude ]; then
  CLAUDE_BIN=/usr/local/bin/claude
elif [ -x "$HOME/.npm-global/bin/claude" ]; then
  CLAUDE_BIN="$HOME/.npm-global/bin/claude"
elif [ -n "$NVM_DIR" ] && [ -d "$NVM_DIR/versions/node" ]; then
  for dir in $(ls -rd "$NVM_DIR/versions/node"/*/bin/claude 2>/dev/null); do
    if [ -x "$dir" ]; then
      CLAUDE_BIN="$dir"
      break
    fi
  done
fi

if [ -n "$CLAUDE_BIN" ]; then
  ok "Claude Code CLI ($CLAUDE_BIN)"
else
  fail "Claude Code CLI not found — install with: npm install -g @anthropic-ai/claude-code"
  info "If already installed and loaded in your shell, proq will auto-detect it at runtime."
fi

# ── Persist Claude binary path to settings ──────────────────────────
SETTINGS_FILE="$(cd "$(dirname "$0")/.." && pwd)/data/settings.json"
if [ -n "$CLAUDE_BIN" ]; then
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  if [ -f "$SETTINGS_FILE" ]; then
    # Update existing settings — use node for reliable JSON manipulation
    node -e "
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));
      s.claudeBin = '$CLAUDE_BIN';
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(s, null, 2) + '\n');
    "
  else
    echo "{\"claudeBin\":\"$CLAUDE_BIN\"}" > "$SETTINGS_FILE"
  fi
  info "Saved Claude path to settings"
fi

# ── Native build tools (macOS) ───────────────────────────────────────
if [[ "$OSTYPE" == darwin* ]]; then
  if xcode-select -p &>/dev/null; then
    ok "Xcode Command Line Tools"
  else
    echo ""
    info "Xcode Command Line Tools not found — installing..."
    xcode-select --install
    echo ""
    info "Follow the prompt to finish installing, then re-run this script."
    exit 0
  fi
fi

# ── npm install ──────────────────────────────────────────────────────
echo ""
info "Installing dependencies..."
echo ""
npm install
echo ""

# ── Done ─────────────────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}Ready to go!${RESET} Start the dev server with:"
echo ""
echo -e "  ${BOLD}npm run dev${RESET}"
echo ""
