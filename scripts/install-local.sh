#!/usr/bin/env bash
# Packages the extension into a .vsix and installs it into the local VS Code
# (or a compatible fork such as VS Code Insiders / Cursor / VSCodium).
#
# Usage: ./scripts/install-local.sh [editor-cli]
#   editor-cli defaults to "code", pass "code-insiders", "cursor", etc. to target another editor.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

EDITOR_CLI="${1:-code}"

if ! command -v "$EDITOR_CLI" >/dev/null 2>&1; then
  echo "error: '$EDITOR_CLI' command not found on PATH." >&2
  echo "In VS Code, run 'Shell Command: Install code command in PATH' from the Command Palette, then retry." >&2
  exit 1
fi

echo "==> Packaging extension"
npx --yes @vscode/vsce package --out keystroke-capture.vsix

echo "==> Installing into $EDITOR_CLI"
"$EDITOR_CLI" --install-extension keystroke-capture.vsix

echo "==> Done. Reload $EDITOR_CLI if it was already open."
