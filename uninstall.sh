#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
HOME="${HOME:-$(eval echo "~$(id -un)")}"
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [-n|--dry-run]

Removes symlinks created by install.sh.
  -n, --dry-run   print what would happen, make no changes
  -h, --help      show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) printf 'unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
    *) break ;;
  esac
done

log() { printf '\033[1;34m[uninstall]\033[0m %s\n' "$*"; }

unlink() {
  local dst="$1"
  if [ -L "$dst" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      log "dry-run   would remove $dst"
    else
      rm "$dst"
      log "removed   $dst"
    fi
  fi
}

log "source: $DOTFILES_DIR"
log "target: $HOME"
[ "$DRY_RUN" = 1 ] && log "mode:    DRY RUN (no changes will be made)"

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
