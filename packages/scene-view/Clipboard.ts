/**
 * Put text on the clipboard. Returns false only when nothing could be tried or the
 * fallback failed; the modern API answers asynchronously, so a true there means "asked",
 * and a refusal falls back to the old route by itself.
 *
 * Two routes because each fails somewhere. `navigator.clipboard` exists only in a secure
 * context (HTTPS or localhost), so a preview opened by IP address on a phone has none,
 * and it also rejects when the page is not focused. The fallback selects text in a hidden
 * field and runs the `copy` command, which works in both cases as long as a click or key
 * press caused it.
 */
export function copyText (text: string): boolean {
    if (!text || typeof document === 'undefined') return false;

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).catch(() => { legacyCopy(text); });
            return true;
        }
    } catch {
        // Fall through to the old route.
    }
    return legacyCopy(text);
}

function legacyCopy (text: string): boolean {
    try {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        // Off screen but selectable; display:none would make the selection empty.
        field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(field);

        const previous = document.activeElement as HTMLElement | null;
        field.select();
        const ok = document.execCommand('copy');
        field.remove();
        // Selecting stole the focus; give it back so the next key press goes where it was going.
        if (previous && typeof previous.focus === 'function') previous.focus();
        return ok;
    } catch {
        return false;
    }
}
