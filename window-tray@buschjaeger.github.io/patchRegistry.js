// Stack-proof, reversible method wrapping.
//
// Window Tray must intercept two things for which GNOME Shell offers no signal:
//   * application activation — Shell.App.activate / activate_full / activate_window
//   * notification activation — St.Notification.activate
// Wrapping those methods is the only mechanism available, so this module makes it
// as safe as possible:
//
//   * Never stacks. If the function currently installed is one this module
//     installed, installation is refused. A patch leaked by a crash inside
//     enable() degrades to a warning instead of running a handler twice per
//     activation.
//   * Restores by identity. Unwrapping only replaces the function if it is still
//     the one we installed. If another extension wrapped ours in the meantime, the
//     chain is left intact rather than silently cutting that extension out.
//   * Unwinds in reverse installation order, so nested wrappers separate in the
//     correct sequence.
//   * Never throws into Shell; failures are reported through logging.
//
// Only Shell/St JavaScript prototypes and instances are wrapped. No Meta (mutter)
// type is touched anywhere in this extension.

import {debug, warn} from './logging.js';

const PATCHED = Symbol.for('window-tray.patched');

// Installation order, so unpatchAll() can unwind in reverse.
const installed = [];

/**
 * Installs `wrapper` over `target[method]`.
 *
 * `wrapper` is called as `wrapper.call(thisObject, original, ...args)`, where
 * `original` is the implementation that was installed before this call. That
 * keeps the delegation target correct even if another extension has already
 * wrapped the method.
 *
 * Returns the registry entry, or null if nothing was installed.
 */
function wrap(target, method, wrapper, label) {
    const original = target?.[method];
    if (typeof original !== 'function') {
        warn(`cannot patch ${label}${method}(): not a function`);
        return null;
    }
    // Refuse to stack. Two distinct reasons, both worth a loud log:
    //   * a patch leaked by a crash inside a previous enable() (our own marker)
    //   * an anonymous wrapper installed by someone else, or by us after a
    //     reload that skipped disable()
    // Running a handler twice per activation is worse than not running it, and
    // silently stacking would corrupt the other patcher's behaviour too.
    if (original[PATCHED] === true || original.name === '') {
        warn(`${label}${method}() is already wrapped; refusing to stack, so this `
            + 'entry point is inactive until the next clean enable()');
        return null;
    }

    const replacement = function (...args) {
        return wrapper.call(this, original, ...args);
    };

    try {
        replacement[PATCHED] = true;
        target[method] = replacement;
    } catch (e) {
        warn(`cannot patch ${label}${method}(): ${e.message}`);
        return null;
    }

    const entry = {target, method, original, replacement, done: false};
    installed.push(entry);
    debug('patch', `patched ${label}${method}()`);
    return entry;
}

/**
 * Wraps a prototype method. Returns true if the patch was installed.
 *
 *   patch(Shell.App.prototype, 'activate', function (original, ...args) {
 *       return original.apply(this, args);
 *   });
 */
export function patch(prototype, method, wrapper) {
    return wrap(prototype, method, wrapper, '') !== null;
}

/**
 * Wraps a method on a single object instance (e.g. one notification).
 * Returns `{original, restore}` or null; the caller owns the handle.
 */
export function patchObject(object, method, wrapper) {
    const entry = wrap(object, method, wrapper, 'instance ');
    if (!entry)
        return null;
    entry.restore = () => restore(entry);
    return entry;
}

/**
 * Removes one wrapper, but only if it is still the active function on the target.
 * Returns true if the original was restored.
 */
export function restore(entry) {
    if (!entry || entry.done)
        return false;
    entry.done = true;

    if (entry.target[entry.method] !== entry.replacement) {
        debug('patch', `${entry.method}() replaced by someone else; leaving alone`);
        return false;
    }
    try {
        entry.target[entry.method] = entry.original;
        delete entry.replacement[PATCHED];
        debug('patch', `restored ${entry.method}()`);
        return true;
    } catch (e) {
        warn(`cannot restore ${entry.method}(): ${e.message}`);
        return false;
    }
}

/**
 * Removes every wrapper this module installed, in reverse installation order.
 * Safe to call repeatedly, and safe if other extensions patched in between.
 */
export function unpatchAll() {
    for (const entry of installed.reverse())
        restore(entry);
    installed.length = 0;
}

/** Number of wrappers currently recorded (for tests and diagnostics). */
export function patchCount() {
    return installed.length;
}
