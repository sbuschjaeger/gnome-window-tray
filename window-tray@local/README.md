# Window Tray

Window Tray is a GNOME Shell 50 extension that gives configured applications a
predictable minimize-to-tray workflow.

## Behavior

- Only applications configured in Window Tray preferences are affected.
- Minimizing a configured normal window adds it to the panel menu.
- While in the tray, the window is hidden from the overview, Alt+Tab, taskbars,
  and pagers.
- Clicking the menu row restores that exact window on the current workspace.
- Activating a configured app moves its existing window to the current
  workspace rather than switching to the workspace where it was left.
- Normal Dash to Dock clicks restore the existing tray window. If an external
  launcher such as Vicinae asks a single-instance application to present its
  existing window, that presentation is also restored on the current workspace.
- Explicit launcher actions such as **New Window**, middle-click, or Ctrl-click
  retain their normal meaning and may create another window.
- Clicking the small close button in the menu sends a normal close request.
- The window's own close button, File → Quit, and Alt+F4 remain unchanged.
- Every minimized window has its own menu row.

Window Tray combines genuine Mutter minimized state with temporary window-list
suppression. It does not move windows to a parking workspace. When the extension
is disabled or an application is removed from its configuration, window-list
visibility is restored while the window remains normally minimized.

## Install from the working tree

```sh
install -d ~/.local/share/gnome-shell/extensions
cp -a window-tray@local ~/.local/share/gnome-shell/extensions/
```

Log out and back in so GNOME Shell discovers the extension, then run:

```sh
gnome-extensions enable window-tray@local
gnome-extensions prefs window-tray@local
```

## Package

`gnome-extensions pack` includes only standard extension files automatically,
so `config.js` must be named as an extra source:

```sh
gnome-extensions pack --force --extra-source=config.js \
  --extra-source=window-tray-symbolic.svg window-tray@local
```

## Configuration

Preferences are stored in:

```text
~/.config/window-tray/config.json
```

Use **Use last focused application** for the easiest setup: focus the desired
application, open Window Tray preferences, and add the captured desktop ID.
Applications can also be added manually by desktop-ID prefix.

## Logging

```sh
journalctl --user -f _COMM=gnome-shell | grep --line-buffered "Window Tray"
```

## Notification limitation

Notification restoration requires GNOME Shell to associate the notification
with the configured desktop ID. Chromium PWAs sometimes publish notifications
under the generic browser ID; Window Tray uses the same conservative focused-PWA
fallback as Workspace Tray and does not guess based on arbitrary window titles.
