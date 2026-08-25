# Workspace Tray

This repository also contains the independent [Window Tray](window-tray@local/README.md)
extension. Window Tray hides minimized windows of explicitly configured
applications from Shell's window lists, lists them in a panel menu, and brings
an activated managed window to the current workspace; it does not use a parking
workspace.

**Status:** 1.0 alpha · GNOME Shell 50 · Wayland
**NOTE:** This was mostly vibe-coded with ChatGPT 5.6-sol, because I was too lazy to figure out how to write a gnome extension myself. 

Keep communication apps close without giving them permanent space in your day-to-day workspaces.

In the regular gnome workflow, the mental model is to have one workspace per task or project. While this works well most of the time, there are some apps (e.g. communication) that do not belong to any project. Workspace Tray gives these selected applications a home workspace and lets them follow you. Once you switch to one of these apps, this app will send to your workspace and upon minimize it will be sent back to its tray workspace.

## Features

- Bring managed application windows to the current workspace instead of switching to them.
- Return a managed window to the "tray" by minimizing it.
- Use a fixed workspace as the tray, or let the extension maintain one at the end of the workspace list.
- Preserve intentional keyboard and drag-and-drop workspace moves.
- Keep notification actions intact.
- Optionally close the notification center after activating a managed app.
- Configure any number of applications by desktop ID.

## Workflow

1. Add an application under **Managed Applications**.
2. Open/Leave its window on the tray workspace while working elsewhere.
3. Launch the running app or click one of its notifications. Workspace Tray moves the existing window to you and focuses it.
4. Minimize the window when finished. It moves back to the tray and becomes visible there again.


## Installation

Copy the extension into your per-user GNOME Shell extension directory:

```sh
install -d ~/.local/share/gnome-shell/extensions
cp -a workspace-tray@local ~/.local/share/gnome-shell/extensions/
```

Log out and back in so GNOME Shell discovers the extension, then enable it:

```sh
gnome-extensions enable workspace-tray@local
```


## Configuration

Open **Workspace Tray Settings** from the Extensions app, or run:

```sh
gnome-extensions prefs workspace-tray@local
```

### Tray workspace

Enable **Use dedicated tray workspace** to select a fixed, one-based workspace number. If it is unavailable, Workspace 1 is used as a safe fallback. When the option is disabled, a previously used tray workspace is reused while it still exists. Otherwise the extension uses an empty final workspace or appends one when necessary.

### Managed applications

Use **Use last focused application** for the easiest setup: focus the app, open Workspace Tray's preferences, and add the captured desktop ID. Entries can also be added and edited manually using one or more comma-separated desktop-ID prefixes.

Settings are stored in:

```text
~/.config/workspace-tray/config.json
```


## Notification limitation

When GNOME Shell associates a notification with the configured application desktop ID, Workspace Tray moves the window before delivering its action. Some Chromium PWAs—including WhatsApp in Brave—publish only the generic browser ID. For those notifications, Workspace Tray lets the browser resolve its target, then recognizes the focused managed PWA by desktop ID/WM class and returns it to the workspace where the notification was clicked. Ordinary browser windows and unmanaged PWAs remain untouched.

## Troubleshooting

Follow the extension log while reproducing an issue:

```sh
journalctl --user -f _COMM=gnome-shell | grep --line-buffered "Workspace Tray"
```

For notification metadata, run:

```sh
./scripts/watch-notifications.sh
```
