#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
HOME="${HOME:-$(eval echo "~$(id -un)")}"

log() { printf '\033[1;34m[uninstall]\033[0m %s\n' "$*"; }

unlink() {
  local dst="$1"
  if [ -L "$dst" ]; then
    rm "$dst"
    log "removed   $dst"
  fi
}

if [ -d "$DOTFILES_DIR/config" ]; then
  for app in "$DOTFILES_DIR"/config/*; do
    [ -d "$app" ] || continue
    unlink "$HOME/.config/$(basename "$app")"
  done
fi

shopt -s dotglob nullglob
for entry in "$DOTFILES_DIR"/*; do
  name="$(basename "$entry")"
  case "$name" in
    .git|.gitignore|config|install.sh|README.md|uninstall.sh) continue ;;
  esac
  unlink "$HOME/$name"
done
shopt -u dotglob nullglob
