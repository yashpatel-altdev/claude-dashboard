#!/usr/bin/env bash
# Claude Dashboard installer
# Copies dashboard.js to ~/.claude/ so you can run it from anywhere

set -e

CLAUDE_DIR="$HOME/.claude"
DEST="$CLAUDE_DIR/dashboard.js"

if [ ! -d "$CLAUDE_DIR" ]; then
  echo "❌ Claude Code not found — ~/.claude/ does not exist."
  echo "   Install Claude Code first: https://claude.ai/code"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/dashboard.js" "$DEST"
chmod +x "$DEST"

echo "✅ Installed to $DEST"
echo ""
echo "Usage:"
echo "  node ~/.claude/dashboard.js          # Open snapshot in browser"
echo "  node ~/.claude/dashboard.js --serve  # Live server at localhost:7432"
