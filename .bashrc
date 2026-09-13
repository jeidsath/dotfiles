set -o vi

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
export OPENROUTER_KEY=$(security find-generic-password -a "$USER" -s openrouter-key -w)
export OPENROUTER_WORKSPACE_KEY=$(security find-generic-password -a "$USER" -s openrouter-workspace-key -w)

export AWS_PROFILE=bedrock-coding
export AWS_REGION=us-east-1

export FIREWORKS_API_KEY=$(security find-generic-password -a "$USER" -s fireworks-api-key -w)
