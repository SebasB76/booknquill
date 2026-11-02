#!/usr/bin/env bash
# Builds BookNQuill and installs it for the current user: binary, icon and desktop entry.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo="${CARGO:-$HOME/.cargo/bin/cargo}"
bin="$HOME/.local/bin/booknquill"

pnpm install --frozen-lockfile
"$cargo" tauri build --no-bundle

install -Dm755 src-tauri/target/release/booknquill "$bin"
install -Dm644 branding/icon.png "$HOME/.local/share/icons/hicolor/1024x1024/apps/booknquill.png"
# Desktop entries need an absolute path when ~/.local/bin is not on the session PATH.
sed "s|^Exec=booknquill|Exec=$bin|" packaging/booknquill.desktop > "$HOME/.local/share/applications/booknquill.desktop"
echo "Installed $bin"
