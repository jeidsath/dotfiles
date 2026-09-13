#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
HOME="${HOME:-$(eval echo "~$(id -un)")}"

log()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; }

# link <src> <dst>: idempotent. skips if already a matching symlink,
# otherwise backs up an existing file/dir at <dst> and replaces it.
link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    log "ok        $dst (already linked)"
    return
  fi
  if [ -e "$dst" ]; then
    warn "backup    $dst -> ${dst}.bak"
    mv "$dst" "${dst}.bak"
  fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  log "linked    $dst -> $src"
}

log "source: $DOTFILES_DIR"
log "target: $HOME"

# config/<app>/ -> ~/.config/<app>/
if [ -d "$DOTFILES_DIR/config" ]; then
  for app in "$DOTFILES_DIR"/config/*; do
    [ -d "$app" ] || continue
    link "$app" "$HOME/.config/$(basename "$app")"
  done
fi

# top-level dotfiles (e.g. .zshrc, .gitconfig) -> ~/<name>
shopt -s dotglob nullglob
for entry in "$DOTFILES_DIR"/*; do
  name="$(basename "$entry")"
  case "$name" in
    .git|.gitignore|config|install.sh|README.md|uninstall.sh) continue ;;
  esac
  if [ -d "$entry" ] || [ -f "$entry" ]; then
    link "$entry" "$HOME/$name"
  fi
done
shopt -u dotglob nullglob

log "done. review any [install] warnings above."
