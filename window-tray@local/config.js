import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const CONFIG_DIRECTORY = 'window-tray';

export const DEFAULT_CONFIG = {
    trayApps: [],
    lastFocusedApp: null,
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function getConfigFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_config_dir(), CONFIG_DIRECTORY, 'config.json',
    ]));
}

function normalize(raw) {
    const config = clone(DEFAULT_CONFIG);
    if (!raw || typeof raw !== 'object')
        return config;

    if (Array.isArray(raw.trayApps)) {
        config.trayApps = raw.trayApps
            .filter(app => app && typeof app === 'object')
            .map(app => ({
                name: String(app.name ?? 'Unnamed application'),
                desktopIdPrefixes: Array.isArray(app.desktopIdPrefixes)
                    ? app.desktopIdPrefixes.map(String).map(value => value.trim()).filter(Boolean)
                    : [],
            }))
            .filter(app => app.desktopIdPrefixes.length > 0);
    }

    if (raw.lastFocusedApp && typeof raw.lastFocusedApp === 'object') {
        config.lastFocusedApp = {
            appId: String(raw.lastFocusedApp.appId ?? ''),
            title: String(raw.lastFocusedApp.title ?? ''),
        };
    }
    return config;
}

export function loadConfig() {
    try {
        const [ok, bytes] = getConfigFile().load_contents(null);
        if (!ok)
            return clone(DEFAULT_CONFIG);
        return normalize(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`[Window Tray] unable to read configuration: ${error.message}`);
        return clone(DEFAULT_CONFIG);
    }
}

export function saveConfig(config) {
    const file = getConfigFile();
    const directory = file.get_parent();
    if (!directory.query_exists(null))
        directory.make_directory_with_parents(null);
    file.replace_contents(
        JSON.stringify(normalize(config), null, 2), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
