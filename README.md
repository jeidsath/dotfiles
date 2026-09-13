# dotfiles

Personal configuration files, synced across machines.

## Layout

The repo mirrors `~/.config/`:

```
dotfiles/
  config/
    opencode/        -> ~/.config/opencode/
    <other-app>/     -> ~/.config/<other-app>/
  .zshrc             -> ~/.zshrc   (top-level dotfiles work too)
  install.sh
  uninstall.sh
```

Anything under `config/<app>/` is symlinked into `~/.config/<app>/`. Any dotfile or top-level directory in the repo is symlinked into `$HOME/<name>`. Edit files in the repo — your running config picks up the changes immediately.

## Install on a new machine

```sh
git clone https://github.com/jeidsath/dotfiles.git ~/dotfiles
~/dotfiles/install.sh
```

The script is idempotent. Re-running reports each path as `ok` if already linked, `backup` and `linked` if it had to replace an existing file/dir. Anything replaced is moved aside with a `.bak` suffix — restore it manually if needed.

Some configs ship a `package.json` (e.g. `opencode`). On a fresh machine you'll need to `cd ~/.config/<app> && npm install` to populate `node_modules/`.

## Uninstall

```sh
~/dotfiles/uninstall.sh
```

Removes only the symlinks the install script created. Your `.bak` files and anything outside the repo are left alone.
