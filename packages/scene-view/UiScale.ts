/**
 * The text size of the DOM panels, adjustable while running and remembered.
 *
 * There is no size that suits every screen. A density that reads well on a large
 * monitor is cramped on a laptop, and one picked for a laptop wastes a monitor, so
 * the size is a setting rather than a constant. Everything in the stylesheet is
 * sized in em from this one value, which is why a single number scales the rows,
 * carets, chips, switches and buttons together and not just the letters.
 */

const STORAGE_KEY = 'scene-view-font-size';

export const FONT_DEFAULT = 13;
export const FONT_MIN = 10;
export const FONT_MAX = 22;

let size = FONT_DEFAULT;
let loaded = false;

function clamp (px: number): number {
    return Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(px)));
}

function load () {
    loaded = true;
    try {
        const stored = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
        if (isFinite(stored) && stored > 0) size = clamp(stored);
    } catch {
        // Storage can be blocked (private windows, embedded webviews); the default stands.
    }
}

export function fontSize (): number {
    if (!loaded) load();
    return size;
}

/** Publish the size to the stylesheet. Cheap and idempotent. */
export function applyFontSize () {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--sv-fs', `${fontSize()}px`);
}

export function setFontSize (px: number) {
    size = clamp(px);
    loaded = true;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, String(size));
    } catch {
        // Not persisted; still applies for this session.
    }
    applyFontSize();
}

export function bumpFontSize (delta: number) {
    setFontSize(fontSize() + delta);
}
