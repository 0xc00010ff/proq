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

# ── tmux ─────────────────────────────────────────────────────────────
if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V | awk '{print $2}')"
else
  echo ""
  info "tmux not found — installing..."
  if [[ "$OSTYPE" == darwin* ]]; then
    if command -v brew &>/dev/null; then
      brew install tmux
      ok "tmux installed"
    else
      fail "Homebrew not found — install tmux manually: brew install tmux"
      exit 1
    fi
  elif command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq tmux
    ok "tmux installed"
  else
    fail "Could not auto-install tmux — install it with your package manager"
    exit 1
  fi
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
