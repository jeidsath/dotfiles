#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="${DOTFILES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
HOME="${HOME:-$(eval echo "~$(id -un)")}"
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [-n|--dry-run]

Symlinks files from $DOTFILES_DIR into $HOME.
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

log()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; }

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '           \033[2m$ %s\033[0m\n' "$*"
  else
    "$@"
  fi
}

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
    run mv "$dst" "${dst}.bak"
  fi
  run mkdir -p "$(dirname "$dst")"
  run ln -s "$src" "$dst"
  if [ "$DRY_RUN" = 1 ]; then
    log "dry-run   would link $dst -> $src"
  else
    log "linked    $dst -> $src"
  fi
}

log "source: $DOTFILES_DIR"
log "target: $HOME"
[ "$DRY_RUN" = 1 ] && log "mode:    DRY RUN (no changes will be made)"

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
