set -o vi
PS1='\h:\w\$ '

# Eternal bash history.
# ---------------------
# Undocumented feature which sets the size to "unlimited".
# http://stackoverflow.com/questions/9457233/unlimited-bash-history
export HISTFILESIZE=
export HISTSIZE=
export HISTTIMEFORMAT="[%F %T] "
# Change the file location because certain bash sessions truncate .bash_history file upon close.
# http://superuser.com/questions/575479/bash-history-truncated-to-500-lines-on-each-login
export HISTFILE=~/.bash_eternal_history
# Force prompt to write history after every command.
# http://superuser.com/questions/20900/bash-history-loss
PROMPT_COMMAND="history -a; $PROMPT_COMMAND"
export PATH="$HOME/.local/bin:$PATH"

# Homebrew shellenv — must run before any lines that invoke `brew`, `fzf`, or `zoxide`.
# Guarded so it works on Apple Silicon (/opt/homebrew) and Intel (/usr/local), and stays
# idempotent if ~/.bash_profile already ran shellenv.
if ! command -v brew >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
export HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"
export OPENROUTER_KEY=$(security find-generic-password -a "$USER" -s openrouter-key -w)
export OPENROUTER_WORKSPACE_KEY=$(security find-generic-password -a "$USER" -s openrouter-workspace-key -w)

export AWS_PROFILE=bedrock-coding
export AWS_REGION=us-east-1

export FIREWORKS_API_KEY=$(security find-generic-password -a "$USER" -s fireworks-api-key -w)

# fzf
[ -f "$HOMEBREW_PREFIX/opt/fzf/shell/key-bindings.bash" ] && source "$HOMEBREW_PREFIX/opt/fzf/shell/key-bindings.bash"
[ -f "$HOMEBREW_PREFIX/opt/fzf/shell/completion.bash" ] && source "$HOMEBREW_PREFIX/opt/fzf/shell/completion.bash"

# zoxide (smarter cd; Ctrl-G opens a fuzzy picker over previously-visited dirs)
if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init bash)"
  bind '"\C-g": "zi\n"'
fi
