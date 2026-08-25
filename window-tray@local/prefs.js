import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {loadConfig, saveConfig} from './config.js';

function addButtonRow(group, title, subtitle, callback) {
    const row = new Adw.ActionRow({title, subtitle});
    const button = new Gtk.Button({label: 'Add', valign: Gtk.Align.CENTER});
    button.connect('clicked', callback);
    row.add_suffix(button);
    group.add(row);
}

export default class WindowTrayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._config = loadConfig();
        this._window = window;
        window.set_default_size(720, 560);

        const page = new Adw.PreferencesPage({
            title: 'Window Tray',
            icon_name: 'window-minimize-symbolic',
        });
        window.add(page);

        const behavior = new Adw.PreferencesGroup({
            title: 'Behavior',
            description: 'Minimizing a configured app puts its window in the panel tray '
                + 'and hides it from the overview and window switchers. '
                + 'Activating it moves its existing window to the current workspace. '
                + 'The window close button, File → Quit, and Alt+F4 keep their normal behavior.',
        });
        behavior.add(new Adw.ActionRow({
            title: 'Restore a window',
            subtitle: 'Click its tray row to move it to the current workspace and focus it.',
        }));
        behavior.add(new Adw.ActionRow({
            title: 'Close a window',
            subtitle: 'Click the small × in its tray row to send a normal close request.',
        }));
        page.add(behavior);

        this._addApplicationsGroup(page);
    }

    _save() {
        // The enabled extension updates lastFocusedApp independently. Preserve
        // the newest capture when preferences writes the tray-app list.
        this._config.lastFocusedApp = loadConfig().lastFocusedApp;
        saveConfig(this._config);
    }

    _addApplicationsGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: 'Tray applications',
            description: 'Only applications listed here are affected. Applications are matched by desktop-ID prefix.',
        });
        page.add(group);
        this._appsGroup = group;

        addButtonRow(group, 'Add application manually',
            'Enter a display name and one or more desktop-ID prefixes.',
            () => this._showApplicationDialog());

        addButtonRow(group, 'Use last focused application',
            'Adds the app that was focused before opening Extensions.',
            () => {
                const focused = loadConfig().lastFocusedApp;
                if (!focused?.appId) {
                    this._showNoFocusedAppDialog();
                    return;
                }
                this._showApplicationDialog({
                    name: focused.title || focused.appId.replace(/\.desktop$/, ''),
                    desktopIdPrefixes: [focused.appId.replace(/\.desktop$/, '')],
                });
            });
        this._renderApps();
    }

    _renderApps() {
        for (const row of this._appRows ?? [])
            this._appsGroup.remove(row);
        this._appRows = [];

        for (const app of this._config.trayApps) {
            const detail = `desktop-ID prefix: ${app.desktopIdPrefixes.join(', ')}`;
            const row = new Adw.ActionRow({
                title: app.name || 'Unnamed application',
                subtitle: detail,
            });
            const edit = new Gtk.Button({label: 'Edit', valign: Gtk.Align.CENTER});
            edit.connect('clicked', () => this._showApplicationDialog(app, updated => {
                Object.assign(app, updated);
                this._save();
                this._renderApps();
            }));
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: 'Remove from tray applications',
                valign: Gtk.Align.CENTER,
            });
            remove.connect('clicked', () => {
                this._config.trayApps.splice(this._config.trayApps.indexOf(app), 1);
                this._save();
                this._renderApps();
            });
            row.add_suffix(edit);
            row.add_suffix(remove);
            this._appsGroup.add(row);
            this._appRows.push(row);
        }
    }

    _showApplicationDialog(initial = {}, onSave = null) {
        const dialog = new Adw.Dialog({title: 'Tray application'});
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });
        const name = new Gtk.Entry({
            placeholder_text: 'Name (for example, Mattermost)',
            text: initial.name ?? '',
        });
        const prefixes = new Gtk.Entry({
            placeholder_text: 'Desktop-ID prefixes, comma-separated',
            text: (initial.desktopIdPrefixes ?? []).join(', '),
        });
        for (const [label, entry] of [
            ['Display name', name],
            ['Desktop-ID prefixes', prefixes],
        ]) {
            box.append(new Gtk.Label({label, xalign: 0}));
            box.append(entry);
        }

        const buttons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.END,
            spacing: 6,
        });
        const cancel = new Gtk.Button({label: 'Cancel'});
        const save = new Gtk.Button({label: onSave ? 'Save' : 'Add'});
        save.add_css_class('suggested-action');
        cancel.connect('clicked', () => dialog.close());
        save.connect('clicked', () => {
            const desktopIdPrefixes = prefixes.text.split(',')
                .map(item => item.trim()).filter(Boolean);
            if (desktopIdPrefixes.length === 0)
                return;
            const updated = {
                name: name.text.trim() || 'Unnamed application',
                desktopIdPrefixes,
            };
            if (onSave)
                onSave(updated);
            else {
                this._config.trayApps.push(updated);
                this._save();
                this._renderApps();
            }
            dialog.close();
        });
        buttons.append(cancel);
        buttons.append(save);
        box.append(buttons);
        dialog.child = box;
        dialog.present(this._window);
    }

    _showNoFocusedAppDialog() {
        const dialog = new Adw.AlertDialog({
            heading: 'No application recorded',
            body: 'Focus the application you want to add, then reopen Window Tray settings.',
        });
        dialog.add_response('ok', 'OK');
        dialog.set_default_response('ok');
        dialog.present(this._window);
    }
}
