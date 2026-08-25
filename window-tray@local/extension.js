// GNOME Shell 50.x / GJS ES module extension entry point.
//
// Window Tray has one deliberately narrow rule: when a normal window from a
// configured application becomes minimized, it appears in the panel menu.
// The application's own close paths are never reinterpreted.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {getConfigFile, loadConfig, saveConfig} from './config.js';

const WINDOW_RECHECK_DELAY_MS = 500;
const PANEL_ICON = new Gio.FileIcon({
    file: Gio.File.new_for_uri(import.meta.url).get_parent()
        .resolve_relative_path('window-tray-symbolic.svg'),
});
const GENERIC_BROWSER_IDS = new Set([
    'brave-browser', 'google-chrome', 'chromium', 'chromium-browser',
]);
const MOVE_TO_WORKSPACE_ACTIONS = new Set([
    ...Array.from({length: 12}, (_, index) =>
        Meta.KeyBindingAction[`MOVE_TO_WORKSPACE_${index + 1}`]),
    Meta.KeyBindingAction.MOVE_TO_WORKSPACE_LAST,
    Meta.KeyBindingAction.MOVE_TO_WORKSPACE_LEFT,
    Meta.KeyBindingAction.MOVE_TO_WORKSPACE_RIGHT,
    Meta.KeyBindingAction.MOVE_TO_WORKSPACE_UP,
    Meta.KeyBindingAction.MOVE_TO_WORKSPACE_DOWN,
].filter(value => value !== undefined));

function normalizedAppId(app) {
    return (app?.get_id?.() ?? '').replace(/\.desktop$/i, '').toLowerCase();
}

function matchApp(app, trayApps) {
    const appId = normalizedAppId(app);
    return trayApps.find(config => config.desktopIdPrefixes.some(prefix =>
        appId.startsWith(prefix.replace(/\.desktop$/i, '').toLowerCase()))) ?? null;
}

function matchSource(source, trayApps) {
    return matchApp(source.app, trayApps);
}

const WindowTrayIndicator = GObject.registerClass(
class WindowTrayIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Window Tray');
        this._extension = extension;
        this._rows = new Map();

        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        box.add_child(new St.Icon({
            gicon: PANEL_ICON,
            icon_size: 16,
            style_class: 'system-status-icon',
        }));
        this._count = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'window-tray-count',
        });
        box.add_child(this._count);
        this.add_child(box);

        this._emptyItem = new PopupMenu.PopupMenuItem('No minimized tray windows', {
            reactive: false,
            can_focus: false,
        });
        this._emptyItem.label.add_style_class_name('window-tray-empty-label');
        this.menu.addMenuItem(this._emptyItem);
        this._syncCount();
    }

    addWindow(window, app) {
        if (this._rows.has(window)) {
            this.updateWindow(window);
            return;
        }

        const row = new PopupMenu.PopupBaseMenuItem();
        let icon;
        try {
            icon = app?.create_icon_texture?.(20);
        } catch (_) {
            icon = null;
        }
        icon ??= new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            icon_size: 20,
        });
        icon.add_style_class_name('window-tray-row-icon');
        row.add_child(icon);

        const label = new St.Label({
            text: this._windowTitle(window, app),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        row.add_child(label);
        row.label_actor = label;

        const closeButton = new St.Button({
            style_class: 'window-tray-close-button',
            can_focus: true,
            track_hover: true,
            accessible_name: `Close ${label.text}`,
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 16}),
        });
        closeButton.connect('clicked', () => this._extension.closeWindow(window));
        row.add_child(closeButton);
        row.connect('activate', () => this._extension.restoreWindow(window, 'tray menu'));

        this._rows.set(window, {row, label, closeButton, app});
        this.menu.addMenuItem(row);
        this._syncCount();
    }

    updateWindow(window) {
        const entry = this._rows.get(window);
        if (!entry)
            return;
        const title = this._windowTitle(window, entry.app);
        entry.label.text = title;
        entry.closeButton.accessible_name = `Close ${title}`;
    }

    removeWindow(window) {
        const entry = this._rows.get(window);
        if (!entry)
            return;
        this._rows.delete(window);
        entry.row.destroy();
        this._syncCount();
    }

    _windowTitle(window, app) {
        return window.get_title?.() || app?.get_name?.() || 'Untitled window';
    }

    _syncCount() {
        const count = this._rows.size;
        this._count.text = count > 0 ? String(count) : '';
        this._emptyItem.visible = count === 0;
    }
});

export default class WindowTrayExtension {
    enable() {
        this._enabled = true;
        this._config = loadConfig();
        this._configFingerprint = this._trayAppsFingerprint(this._config);
        this._managedAppsByWmClass = new Map();
        this._windowRecords = new Map();
        this._windowRecheckTimers = new Set();
        this._appHooks = [];
        this._workspaceActivationHook = null;
        this._notificationHooks = new Map();
        this._notificationSourceSignals = new Map();
        this._pendingBrowserNotification = null;
        this._pendingBrowserNotificationTimer = 0;
        this._configReloadTimer = 0;

        this._indicator = new WindowTrayIndicator(this);
        Main.panel.addToStatusArea('window-tray', this._indicator);

        this._rebuildManagedWindowClasses();
        saveConfig(this._config);
        this._monitorConfig();

        this._displayWindowCreatedSignal = global.display.connect(
            'window-created', (_display, window) => this._scheduleWindowChecks(window));
        this._focusWindowSignal = global.display.connect(
            'notify::focus-window', () => this._onFocusWindowChanged());

        this._scanWindows();
        this._rememberFocusedApp();
        this._installAppActivationHooks();
        this._installWorkspaceActivationHook();
        this._messageTraySourceAddedSignal = Main.messageTray.connect(
            'source-added', (_tray, source) => this._watchNotificationSource(source));
        this._scanNotificationSources();
        console.log('[Window Tray] enabled');
    }

    disable() {
        this._enabled = false;
        if (this._messageTraySourceAddedSignal)
            Main.messageTray.disconnect(this._messageTraySourceAddedSignal);
        this._messageTraySourceAddedSignal = 0;

        for (const [notification, hook] of this._notificationHooks) {
            if (notification.activate === hook.replacement)
                notification.activate = hook.original;
            try {
                notification.disconnect(hook.destroySignal);
            } catch (_) {
                // The notification may already be destroyed.
            }
        }
        this._notificationHooks.clear();
        for (const [source, signalIds] of this._notificationSourceSignals) {
            for (const signalId of signalIds) {
                try {
                    source.disconnect(signalId);
                } catch (_) {
                    // The source may already be destroyed.
                }
            }
        }
        this._notificationSourceSignals.clear();

        for (const [prototype, method, original, replacement] of this._appHooks) {
            if (prototype[method] === replacement)
                prototype[method] = original;
        }
        this._appHooks = [];
        if (this._workspaceActivationHook) {
            const [prototype, original, replacement] = this._workspaceActivationHook;
            if (prototype.activate_with_focus === replacement)
                prototype.activate_with_focus = original;
        }
        this._workspaceActivationHook = null;

        if (this._displayWindowCreatedSignal)
            global.display.disconnect(this._displayWindowCreatedSignal);
        this._displayWindowCreatedSignal = 0;
        if (this._focusWindowSignal)
            global.display.disconnect(this._focusWindowSignal);
        this._focusWindowSignal = 0;

        for (const window of [...this._windowRecords.keys()])
            this._untrackWindow(window, true);
        for (const sourceId of this._windowRecheckTimers)
            GLib.Source.remove(sourceId);
        this._windowRecheckTimers.clear();

        if (this._pendingBrowserNotificationTimer)
            GLib.Source.remove(this._pendingBrowserNotificationTimer);
        this._pendingBrowserNotificationTimer = 0;
        this._pendingBrowserNotification = null;

        this._configMonitor?.cancel();
        this._configMonitor = null;
        if (this._configReloadTimer)
            GLib.Source.remove(this._configReloadTimer);
        this._configReloadTimer = 0;

        this._indicator?.destroy();
        this._indicator = null;
        console.log('[Window Tray] disabled');
    }

    restoreWindow(window, reason) {
        const record = this._windowRecords.get(window);
        if (!record || !window.minimized)
            return false;

        return this._bringTrackedWindowHere(window, reason);
    }

    _bringTrackedWindowHere(window, reason) {
        const record = this._windowRecords.get(window);
        if (!record)
            return false;

        const target = global.workspace_manager.get_active_workspace();
        try {
            this._showWindowInLists(window, record);
            this._indicator.removeWindow(window);
            if (window.get_workspace() !== target)
                window.change_workspace(target);
            window.unminimize();
            window.activate_with_workspace(global.get_current_time(), target);
            Main.overview.hide();
            this._indicator.menu.close();
            console.log(`[Window Tray] brought ${window.get_title() ?? '(untitled)'} to the current workspace for ${reason}`);
            return true;
        } catch (error) {
            console.error(`[Window Tray] could not restore window: ${error.message}`);
            return false;
        }
    }

    closeWindow(window) {
        if (!this._windowRecords.has(window))
            return;
        try {
            window.delete(global.get_current_time());
            this._indicator.menu.close();
            console.log(`[Window Tray] requested close for ${window.get_title() ?? '(untitled)'}`);
        } catch (error) {
            console.error(`[Window Tray] could not close window: ${error.message}`);
        }
    }

    _monitorConfig() {
        this._configMonitor = getConfigFile().monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._configMonitor.connect('changed', () => {
            if (this._configReloadTimer)
                GLib.Source.remove(this._configReloadTimer);
            this._configReloadTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._configReloadTimer = 0;
                const config = loadConfig();
                const fingerprint = this._trayAppsFingerprint(config);
                if (fingerprint !== this._configFingerprint) {
                    this._config = config;
                    this._configFingerprint = fingerprint;
                    this._reconcileConfiguredWindows();
                    console.log('[Window Tray] tray application configuration reloaded');
                } else {
                    // Keep the existing tray-app object identities because
                    // tracked windows refer to them. Focus capture writes the
                    // same file and should not rebuild all window tracking.
                    this._config.lastFocusedApp = config.lastFocusedApp;
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _trayAppsFingerprint(config) {
        return JSON.stringify(config.trayApps);
    }

    _reconcileConfiguredWindows() {
        this._rebuildManagedWindowClasses();
        for (const window of [...this._windowRecords.keys()])
            this._untrackWindow(window);
        this._scanWindows();
        this._scanNotificationSources();
    }

    _scanWindows() {
        for (const window of global.display.list_all_windows())
            this._considerWindow(window);
    }

    _scheduleWindowChecks(window) {
        this._considerWindow(window);
        let idleId = 0;
        idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._windowRecheckTimers.delete(idleId);
            this._considerWindow(window);
            return GLib.SOURCE_REMOVE;
        });
        this._windowRecheckTimers.add(idleId);

        let timeoutId = 0;
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_RECHECK_DELAY_MS, () => {
            this._windowRecheckTimers.delete(timeoutId);
            this._considerWindow(window);
            return GLib.SOURCE_REMOVE;
        });
        this._windowRecheckTimers.add(timeoutId);
    }

    _considerWindow(window) {
        if (this._windowRecords.has(window) || !this._isSupportedWindow(window))
            return;
        const config = this._matchConfiguredWindow(window);
        if (!config)
            return;
        this._trackWindow(window, config);
    }

    _isSupportedWindow(window) {
        try {
            return window.get_window_type() === Meta.WindowType.NORMAL && !window.skip_taskbar;
        } catch (_) {
            return false;
        }
    }

    _trackWindow(window, config) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const record = {
            config,
            app,
            hiddenFromWindowList: false,
            signals: [],
        };
        record.signals.push(window.connect('notify::minimized', () =>
            this._syncWindowTrayState(window)));
        record.signals.push(window.connect('notify::title', () =>
            this._indicator.updateWindow(window)));
        record.signals.push(window.connect('unmanaged', () =>
            this._untrackWindow(window)));
        this._windowRecords.set(window, record);
        this._syncWindowTrayState(window);
        console.log(`[Window Tray] tracking ${config.name}: ${window.get_title() ?? '(untitled)'}`);
    }

    _untrackWindow(window, deferWindowListRestore = false) {
        const record = this._windowRecords.get(window);
        if (!record)
            return;
        this._windowRecords.delete(window);
        this._indicator?.removeWindow(window);
        if (deferWindowListRestore)
            this._showWindowInListsWhenIdle(window, record);
        else
            this._showWindowInLists(window, record);
        for (const signalId of record.signals) {
            try {
                window.disconnect(signalId);
            } catch (_) {
                // An unmanaged window may already have discarded its signals.
            }
        }
    }

    _syncWindowTrayState(window) {
        const record = this._windowRecords.get(window);
        if (!record)
            return;
        if (window.minimized) {
            this._hideWindowFromLists(window, record);
            this._indicator.addWindow(window, record.app);
            console.log(`[Window Tray] minimized ${record.config.name}: ${window.get_title() ?? '(untitled)'}`);
        } else if (record.hiddenFromWindowList) {
            // An external launcher cannot call our Shell.App hooks, but a
            // single-instance application will normally respond to a second
            // launch request by presenting (and therefore unminimizing) its
            // existing window. Complete that restore on the current workspace.
            this._bringTrackedWindowHere(window, 'application presentation');
        } else {
            this._indicator.removeWindow(window);
            this._showWindowInLists(window, record);
        }
    }

    _hideWindowFromLists(window, record) {
        if (record.hiddenFromWindowList)
            return;
        try {
            window.hide_from_window_list();
            record.hiddenFromWindowList = true;
        } catch (error) {
            console.error(`[Window Tray] could not hide window from Shell lists: ${error.message}`);
        }
    }

    _showWindowInLists(window, record) {
        if (!record.hiddenFromWindowList)
            return;
        try {
            window.show_in_window_list();
            record.hiddenFromWindowList = false;
        } catch (error) {
            console.error(`[Window Tray] could not restore window-list visibility: ${error.message}`);
        }
    }

    _showWindowInListsWhenIdle(window, record) {
        if (!record.hiddenFromWindowList)
            return;
        record.hiddenFromWindowList = false;
        // Showing a minimized window updates the overview synchronously. During
        // extension disable, Shell rebuilds that UI across multiple main-loop
        // turns, so let that short transaction finish before final cleanup.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            try {
                window.show_in_window_list();
            } catch (error) {
                console.error(`[Window Tray] deferred window-list cleanup failed: ${error.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildManagedWindowClasses() {
        this._managedAppsByWmClass.clear();
        const appSystem = Shell.AppSystem.get_default();
        for (const config of this._config.trayApps) {
            for (const configuredId of config.desktopIdPrefixes) {
                const id = configuredId.replace(/\.desktop$/i, '');
                const app = appSystem.lookup_app(`${id}.desktop`) ?? appSystem.lookup_app(id);
                const startupWmClass = this._getStartupWmClass(app);
                if (startupWmClass)
                    this._managedAppsByWmClass.set(startupWmClass, config);

                const chromiumId = id.match(/(?:^|-)([a-p]{32})(?:-|$)/i)?.[1];
                if (chromiumId)
                    this._managedAppsByWmClass.set(`crx_${chromiumId.toLowerCase()}`, config);
            }
        }
    }

    _matchConfiguredWindow(window) {
        const keys = [window?.get_wm_class?.(), window?.get_wm_class_instance?.()]
            .filter(Boolean).map(value => value.toLowerCase());
        for (const key of keys) {
            const config = this._managedAppsByWmClass.get(key);
            if (config)
                return config;
        }
        const app = window
            ? Shell.WindowTracker.get_default().get_window_app(window)
            : null;
        return matchApp(app, this._config.trayApps);
    }

    _getStartupWmClass(app) {
        return app?.get_app_info?.()?.get_string?.('StartupWMClass')?.toLowerCase() ?? '';
    }

    _rememberFocusedApp() {
        const window = global.display.get_focus_window();
        const app = window ? Shell.WindowTracker.get_default().get_window_app(window) : null;
        const appId = app?.get_id?.() ?? '';
        if (!app || appId.startsWith('org.gnome.Extensions'))
            return;
        const captured = {appId, title: app.get_name() ?? window.get_title() ?? ''};
        if (this._config.lastFocusedApp?.appId === captured.appId &&
            this._config.lastFocusedApp?.title === captured.title)
            return;
        this._config.lastFocusedApp = captured;
        // Preferences runs in a separate process. Merge focus capture into the
        // latest file so it can never overwrite a tray-app edit that arrived
        // just before the file monitor callback.
        const latest = loadConfig();
        latest.lastFocusedApp = captured;
        saveConfig(latest);
    }

    _onFocusWindowChanged() {
        this._completePendingBrowserNotification();
        this._rememberFocusedApp();
    }

    _bringPreferredHere(config, reason, preferredWindow) {
        if (!preferredWindow)
            return false;
        const record = this._windowRecords.get(preferredWindow);
        return record?.config === config && this._windowNeedsActivationHere(preferredWindow)
            ? this._bringTrackedWindowHere(preferredWindow, reason)
            : false;
    }

    _bringAppWindowHere(app, config, reason) {
        const appWindows = app?.get_windows?.() ?? [];
        let window = appWindows.find(candidate =>
            this._windowRecords.get(candidate)?.config === config);
        if (!window) {
            [window] = [...this._windowRecords.entries()]
                .filter(([, record]) => record.config === config)
                .map(([candidate]) => candidate)
                .sort((left, right) => right.get_user_time() - left.get_user_time());
        }
        if (!window || !this._windowNeedsActivationHere(window))
            return false;
        return this._bringTrackedWindowHere(window, reason);
    }

    _windowNeedsActivationHere(window) {
        return window.minimized ||
            window.get_workspace() !== global.workspace_manager.get_active_workspace();
    }

    _installAppActivationHooks() {
        this._overrideAppMethod('activate', (app, config) =>
            this._bringAppWindowHere(app, config, 'app activation'));
        this._overrideAppMethod('activate_full', (app, config) =>
            this._bringAppWindowHere(app, config, 'full app activation'));
        this._overrideAppMethod('activate_window', (app, config, args) =>
            this._bringPreferredHere(config, 'app window activation', args[0]));
    }

    _overrideAppMethod(method, before) {
        const prototype = Shell.App.prototype;
        const original = prototype[method];
        if (typeof original !== 'function')
            return;
        const extension = this;
        const replacement = function (...args) {
            if (!extension._enabled)
                return original.apply(this, args);
            const config = matchApp(this, extension._config.trayApps);
            if (config) {
                try {
                    if (before(this, config, args))
                        return undefined;
                } catch (error) {
                    console.error(`[Window Tray] Shell.App.${method} handler failed: ${error.message}`);
                }
            }
            return original.apply(this, args);
        };
        try {
            prototype[method] = replacement;
            this._appHooks.push([prototype, method, original, replacement]);
        } catch (error) {
            console.warn(`[Window Tray] cannot hook Shell.App.${method}(): ${error.message}`);
        }
    }

    _installWorkspaceActivationHook() {
        const prototype = Meta.Workspace.prototype;
        const original = prototype.activate_with_focus;
        if (typeof original !== 'function')
            return;
        const extension = this;
        const replacement = function (window, timestamp) {
            if (extension._enabled && window &&
                extension._windowRecords.has(window) &&
                extension._windowNeedsActivationHere(window) &&
                !extension._isMoveToWorkspaceKeybinding() &&
                extension._bringTrackedWindowHere(window, 'window activation'))
                return undefined;
            return original.call(this, window, timestamp);
        };
        try {
            prototype.activate_with_focus = replacement;
            this._workspaceActivationHook = [prototype, original, replacement];
        } catch (error) {
            console.warn(`[Window Tray] cannot hook window activation: ${error.message}`);
        }
    }

    _isMoveToWorkspaceKeybinding() {
        const event = Clutter.get_current_event();
        if (!event || event.type() !== Clutter.EventType.KEY_PRESS)
            return false;
        const action = global.display.get_keybinding_action(
            event.get_key_code(), event.get_state());
        return MOVE_TO_WORKSPACE_ACTIONS.has(action);
    }

    _scanNotificationSources() {
        for (const source of Main.messageTray.getSources())
            this._watchNotificationSource(source);
    }

    _watchNotificationSource(source) {
        if (!this._notificationSourceSignals.has(source)) {
            const notificationAdded = source.connect(
                'notification-added', (_source, notification) =>
                    this._considerNotification(source, notification));
            const destroyed = source.connect('destroy', () =>
                this._notificationSourceSignals.delete(source));
            this._notificationSourceSignals.set(source, [notificationAdded, destroyed]);
        }
        for (const notification of source.notifications)
            this._considerNotification(source, notification);
    }

    _considerNotification(source, notification) {
        if (this._notificationHooks.has(notification))
            return;
        if (!matchSource(source, this._config.trayApps) && !this._isGenericBrowserSource(source))
            return;

        const original = notification.activate;
        const extension = this;
        const replacement = function () {
            if (!extension._enabled)
                return original.call(this);
            const config = matchSource(source, extension._config.trayApps);
            if (config)
                extension._bringAppWindowHere(source.app, config, 'notification');
            else if (extension._isGenericBrowserSource(source))
                extension._queueBrowserNotification(source);
            return original.call(this);
        };
        notification.activate = replacement;
        const destroySignal = notification.connect('destroy', () =>
            this._notificationHooks.delete(notification));
        this._notificationHooks.set(notification, {original, replacement, destroySignal});
    }

    _isGenericBrowserSource(source) {
        const sourceId = normalizedAppId(source.app);
        if (!GENERIC_BROWSER_IDS.has(sourceId))
            return false;
        return this._config.trayApps.some(config => this._isChromiumPwaConfig(config));
    }

    _isChromiumPwaConfig(config) {
        return config.desktopIdPrefixes.some(prefix =>
            /(?:^|-)[a-p]{32}(?:-|$)/i.test(prefix));
    }

    _queueBrowserNotification(source) {
        if (this._pendingBrowserNotificationTimer)
            GLib.Source.remove(this._pendingBrowserNotificationTimer);
        this._pendingBrowserNotification = {
            workspace: global.workspace_manager.get_active_workspace(),
            sourceId: source.app?.get_id?.() ?? 'browser',
        };
        this._pendingBrowserNotificationTimer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 3000, () => {
                this._pendingBrowserNotification = null;
                this._pendingBrowserNotificationTimer = 0;
                return GLib.SOURCE_REMOVE;
            });
    }

    _completePendingBrowserNotification() {
        const pending = this._pendingBrowserNotification;
        const window = global.display.get_focus_window();
        const record = window ? this._windowRecords.get(window) : null;
        if (!pending || !record || !this._isChromiumPwaConfig(record.config))
            return;

        this._pendingBrowserNotification = null;
        if (this._pendingBrowserNotificationTimer)
            GLib.Source.remove(this._pendingBrowserNotificationTimer);
        this._pendingBrowserNotificationTimer = 0;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._enabled)
                return GLib.SOURCE_REMOVE;
            try {
                const target = this._workspaceStillExists(pending.workspace)
                    ? pending.workspace
                    : global.workspace_manager.get_active_workspace();
                if (window.get_workspace() !== target)
                    window.change_workspace(target);
                if (window.minimized)
                    window.unminimize();
                window.activate_with_workspace(global.get_current_time(), target);
                console.log(`[Window Tray] generic ${pending.sourceId} notification resolved to ${record.config.name}`);
            } catch (error) {
                console.error(`[Window Tray] browser notification restore failed: ${error.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _workspaceStillExists(workspace) {
        const manager = global.workspace_manager;
        return workspace && Array.from({length: manager.n_workspaces}, (_, index) =>
            manager.get_workspace_by_index(index)).includes(workspace);
    }
}
