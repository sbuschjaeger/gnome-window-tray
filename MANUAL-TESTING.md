# Manual testing

Automated tests (`./scripts/test.sh`) cover only the pure modules. Everything that
touches a real session must be checked by hand. This file is the checklist.

## 1. Debug mode

Logging is **off by default** — a normal install produces no journal noise.

```bash
# enable everything
touch ~/.config/window-tray/debug

# or only specific categories (comma- or space-separated)
echo 'tray,activation' > ~/.config/window-tray/debug

# watch it
journalctl -f -o cat /usr/bin/gnome-shell | grep window-tray

# disable
rm ~/.config/window-tray/debug
```

No Shell restart needed: the flag file is re-read at most once per second, so it
takes effect on the next relevant event.

There is also an **Enable debug logging** switch in the preferences window, which
writes/deletes the same file — useful when you do not want to open a terminal.

Categories:

| Category       | What it shows                                                        |
| -------------- | -------------------------------------------------------------------- |
| `lifecycle`    | enable/disable, how many tray apps were loaded                       |
| `tray`         | windows tracked, minimized-to-tray, close requests                   |
| `match`        | which config a window matched and **how** (WM_CLASS vs. app id), plus the rebuilt WM_CLASS index |
| `activation`   | every `Shell.App.activate*` call, whether it matched, and each move-to-current-workspace |
| `notification` | notification sources considered, deferrals, and PWA resolution        |
| `config`       | config loads/writes, last-focused-app capture, reloads               |
| `patch`        | each method wrapped/restored, and every refusal to stack              |

`[window-tray]` (no category) = warning or error, always logged.

## 2. Build and install

```bash
./scripts/test.sh      # unit tests + syntax
./scripts/pack.sh      # dist/*.zip, verifies all imported modules are inside
./scripts/pack.sh --install
```

Wayland: log out and in. X11: `Alt+F2`, `r`, Enter.

## 3. Core behaviour

- [ ] Minimize a configured app → row appears in the panel tray with a count.
- [ ] Minimized window is **absent** from the overview, Alt+Tab, and the Dash.
- [ ] Click the tray row → window moves to the current workspace, unminimizes, gains focus.
- [ ] Switch to another workspace, click a tray row → window follows you to this workspace.
- [ ] With dynamic workspaces enabled, minimize the last visible window on a
  non-active workspace → that workspace disappears instead of being kept alive by
  the hidden tray window; restoring the row brings it to the current workspace.
- [ ] Click the × in a tray row → window closes normally (app quits if it was the last window).
- [ ] Unconfigured app: minimize → behaves entirely normally, no tray row.
- [ ] Window close button, `File → Quit`, `Alt+F4` → normal quit, tray row disappears, nothing left behind.
- [ ] Quit the app with `pkill` → tray row disappears cleanly.

## 4. The risky parts (where bugs will actually be)

These are the three wrapped methods plus notification routing. Watch the
`patch` and `activation` categories while doing them.

**Wrapped entry points** — at enable you should see exactly three `patched` lines:
`patched activate()`, `patched activate_full()`, `patched activate_window()`.
If you instead see `already wrapped; refusing to stack`, a previous disable leaked —
report it with the surrounding log lines.

- [ ] Click app icon in the Dash while its window is minimized on another workspace.
- [ ] Same, from the application grid.
- [ ] Super+letter favorite shortcut while minimized.
- [ ] Launch the app again from a terminal (`gtk-launch mattermost`) while minimized.
- [ ] Alt+Tab to a window on another workspace (a *different* app) → must **not** be pulled over.
- [ ] `Super+Shift+Page_Up/Down` (move window to workspace) → window must move to that workspace, **not** to the current one. This is the case the old `Meta.Workspace.activate_with_focus` patch existed for; it is now removed, so this is the single most important thing to verify.
- [ ] Drag a window between workspaces in the overview → normal behaviour.
- [ ] Middle-click a Dash icon (open new window) → new window opens normally.

**Re-enable / reload cycles** (no logout between):

```bash
gnome-extensions disable window-tray@buschjaeger.github.io
gnome-extensions enable  window-tray@buschjaeger.github.io
# repeat 5x, then re-test section 3
```

- [ ] After 5 cycles, still exactly 3 `patched` lines per enable, no `refusing to stack` warnings, and tray behaviour unchanged.
- [ ] Minimize two configured windows, suspend and resume (or lock and unlock):
  both tray rows return, and restoring then minimizing either window adds its
  row again.

**Notifications**

- [ ] Notification from a configured app → click it → its window comes to the current workspace.
- [ ] Chromium/Edge/Brave **PWA** notification (arrives from the generic browser source) → click → the PWA window appears on the current workspace.
- [ ] Browser notification for a PWA that is *not* configured → nothing happens.
- [ ] Notification while the app's window is already focused → no spurious workspace change.

**Coexistence** — enable these alongside and re-test section 3:

- [ ] Dash to Dock
- [ ] Ubuntu Tiling Assistant
- [ ] AppIndicator / KStatusNotifierItem

## 5. Multi-monitor

- [ ] Minimize an app on the secondary monitor, restore from the tray → window appears, focus correct. Which monitor does it land on, and is that acceptable?
- [ ] With the panel on the secondary monitor only: is the tray visible?

## 6. Prefs window

- [ ] Add application manually; empty prefixes are rejected with an inline message.
- [ ] Edit and remove work; the extension reacts within ~1 s without restart.
- [ ] **Use last focused application** finds the app you focused before opening settings.
- [ ] Debug switch creates/deletes `~/.config/window-tray/debug` and logging follows it.
- [ ] Close the prefs window; reopen → settings persisted.
- [ ] `~/.config/window-tray/config.json` is valid, readable JSON:

```bash
python3 -m json.tool ~/.config/window-tray/config.json
```

## 7. Long-running sanity

- [ ] Use the session normally for ~30 min with a configured app. Watch for `[window-tray]` errors in the journal and for memory growth:

```bash
pid=$(pgrep -x gnome-shell); grep VmRSS /proc/$pid/status
```

## Reporting a problem

Send: the log lines around the misbehaviour (with all categories on), what you did,
what happened, what you expected, `gnome-shell --version`, and whether it is Wayland
or X11. `./scripts/watch-notifications.sh` adds notification-source detail if the
problem involves notifications.
