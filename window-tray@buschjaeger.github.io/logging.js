// Debug logging for Window Tray.
//
// Off by default. Enable without touching code by creating the file
// ~/.config/window-tray/debug (or writing "1", "verbose", or a comma-separated
// list of categories into it):
//
//   touch ~/.config/window-tray/debug          # enable all categories
//   echo tray,prefs >~/.config/window-tray/debug
//
// Categories: tray, match, activation, notification, config, patch, lifecycle.
// Warnings and errors are always emitted; only debug() is gated.
//
// The flag file is re-read at most once per second, so toggling it takes effect
// on the next relevant event without a Shell restart.

import GLib from 'gi://GLib';

const FLAG_FILE = GLib.build_filenamev([
    GLib.get_user_config_dir(), 'window-tray', 'debug',
]);
const FLAG_REREAD_INTERVAL_US = GLib.TIME_SPAN_SECOND;

export const LOG_CATEGORIES = Object.freeze([
    'lifecycle', 'tray', 'match', 'activation', 'notification', 'config', 'patch',
]);

const state = {
    enabled: false,
    categories: new Set(),
    lastRead: 0,
    readFile: true,
};

function applySpec(spec) {
    state.categories.clear();
    const trimmed = (spec ?? '').trim();
    if (!trimmed || ['1', 'true', 'yes', 'all', 'on'].includes(trimmed.toLowerCase())) {
        state.categories = new Set(LOG_CATEGORIES);
        return;
    }
    for (const token of trimmed.split(/[,\s]+/)) {
        if (LOG_CATEGORIES.includes(token))
            state.categories.add(token);
    }
}

function readFlagFile() {
    state.lastRead = GLib.get_monotonic_time();
    let enabled = false;
    let spec = '';
    try {
        const [ok, bytes] = GLib.file_get_contents(FLAG_FILE);
        if (ok) {
            enabled = true;
            spec = new TextDecoder().decode(bytes).trim();
        }
    } catch (e) {
        // An absent flag file is the normal case and must stay silent.
        if (e.code !== GLib.FileError.NOENT)
            console.warn(`[window-tray] could not read debug flag: ${e.message}`);
    }
    state.enabled = enabled;
    if (enabled)
        applySpec(spec);
    else
        state.categories.clear();
}

function refreshIfStale() {
    if (!state.readFile)
        return;
    if (state.lastRead === 0 ||
        GLib.get_monotonic_time() - state.lastRead >= FLAG_REREAD_INTERVAL_US)
        readFlagFile();
}

/**
 * Enables debug logging in-process (used by tests and by `window-tray-debug(1)`
 * style debugging). `categories` omitted or empty means all.
 */
export function setDebugEnabled(enabled, categories = []) {
    state.readFile = false;
    state.enabled = enabled;
    if (enabled) {
        state.categories = categories.length
            ? new Set(categories.filter(category => LOG_CATEGORIES.includes(category)))
            : new Set(LOG_CATEGORIES);
    } else {
        state.categories.clear();
    }
}

/** True if `category` is currently being logged. */
export function isDebugEnabled(category) {
    refreshIfStale();
    return state.enabled &&
        (state.categories.size === 0 || state.categories.has(category));
}

/** Debug-level log, suppressed unless the category is active. */
export function debug(category, message) {
    if (!isDebugEnabled(category))
        return;
    console.log(`[window-tray:${category}] ${message}`);
}

/** Always logged. Use for degraded-but-recovered situations. */
export function warn(message) {
    console.warn(`[window-tray] ${message}`);
}

/** Always logged. Use for failed user-visible operations. */
export function error(message) {
    console.error(`[window-tray] ${message}`);
}

/** Path to the flag file, exposed for docs, tests, and the pack script. */
export function debugFlagPath() {
    return FLAG_FILE;
}
