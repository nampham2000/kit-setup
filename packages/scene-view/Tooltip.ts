import { ensureStyles } from './DebugOverlay';

/** Everything this tool puts on the page. A tooltip is only ever shown for something inside one of these. */
const ROOTS = '.sv-root, .sv-help, .sv-help-btn, .sv-console, .sv-log-btn, .sv-menu, .sv-tools, .sv-divider';

/** How long the pointer rests on something before its tooltip appears, in milliseconds. */
const DELAY = 380;

/** Space kept between a tooltip and the window edge, and between it and what it describes. */
const EDGE = 6;
const GAP = 8;

/**
 * Hover explanations for every control, in the tool's own style.
 *
 * Any element can carry its text in a data-tip attribute. A line break splits it into
 * a bold heading and a body, like "Move" then "Drag an arrow to move the node". An element
 * that only has a title also works, and better than before: its title is taken over (and
 * removed, so the browser's own slow, unstyled tooltip does not appear on top), which means
 * every title already set anywhere in the tool is upgraded without being touched.
 *
 * It appears after a short rest, but at once when the pointer moves from one explained
 * thing to the next, so scanning a panel does not mean waiting at every row. It goes
 * away on any press, scroll or key, and when the pointer leaves.
 *
 * Things drawn by the engine rather than the DOM (the tool strip, the divider) have no
 * element to hover. For those the owner calls showAt with the text and a position.
 */
export class Tooltip {
    private _el: HTMLElement = null;
    private _current: Element = null;
    private _timer = 0;
    private _visible = false;
    private _installed = false;
    /** Text last shown by showAt, so repeated calls while the pointer moves do not rebuild it. */
    private _engineText = '';

    public get isVisible (): boolean { return this._visible; }

    public install () {
        if (this._installed || typeof document === 'undefined') return;
        this._installed = true;
        ensureStyles();
        document.addEventListener('mouseover', this._over, true);
        // Moving inside one element can take the pointer on or off its text without any mouseover.
        document.addEventListener('mousemove', this._over, true);
        document.addEventListener('mouseout', this._out, true);
        document.addEventListener('mousedown', this._hide, true);
        document.addEventListener('wheel', this._hide, true);
        document.addEventListener('keydown', this._hide, true);
        window.addEventListener('blur', this._hide);
    }

    public uninstall () {
        if (!this._installed) return;
        this._installed = false;
        document.removeEventListener('mouseover', this._over, true);
        document.removeEventListener('mousemove', this._over, true);
        document.removeEventListener('mouseout', this._out, true);
        document.removeEventListener('mousedown', this._hide, true);
        document.removeEventListener('wheel', this._hide, true);
        document.removeEventListener('keydown', this._hide, true);
        window.removeEventListener('blur', this._hide);
        this.hide();
        this._el?.remove();
        this._el = null;
    }

    public hide () {
        window.clearTimeout(this._timer);
        this._timer = 0;
        this._current = null;
        this._conceal();
    }

    /** Take the tooltip off the screen and forget what it said, so the same text can be shown again. */
    private _conceal () {
        this._visible = false;
        this._engineText = '';
        if (this._el) this._el.style.display = 'none';
    }

    /**
     * Show text near a point, for something with no element of its own. Pass null (or
     * an empty string) to take it down. The point is in CSS pixels, from the window's top-left.
     */
    public showAt (x: number, y: number, text: string | null) {
        if (!this._installed) return;
        if (!text) {
            if (this._engineText) this.hide();
            return;
        }
        // Same text, so only the position follows the pointer.
        if (text !== this._engineText) this._fill(text);
        this._engineText = text;
        this._place(x + 14, y + 18, null);
    }

    private _over = (e: MouseEvent) => {
        const target = e.target as Element;
        const inside = !!target && typeof target.closest === 'function' && !!target.closest(ROOTS);
        if (!inside) {
            // Over the canvas or the rest of the page. An element's tooltip goes; one drawn for the
            // engine is the owner's to take down, and must not be fought over on every mouse move.
            if (this._current) {
                this._current = null;
                window.clearTimeout(this._timer);
                this._timer = 0;
                this._conceal();
            }
            return;
        }

        let element = this._find(target);
        // Only the text itself counts. A row is wide and mostly empty, and a tooltip that appears
        // wherever the pointer happens to cross it is a nuisance; it should take a deliberate move onto the words.
        if (element && !overText(element, e.clientX, e.clientY)) element = null;

        // Same element as before: nothing to do, unless an engine-drawn tooltip is up, which
        // entering any element of the page must take down.
        if (element === this._current && !this._engineText) return;

        this._current = element;
        window.clearTimeout(this._timer);
        this._timer = 0;
        this._engineText = '';

        if (!element) {
            this._conceal();
            return;
        }
        // Already showing one: the next appears at once. Otherwise wait for the pointer to rest.
        if (this._visible) this._show(element);
        else this._timer = window.setTimeout(() => this._show(element), DELAY);
    };

    private _out = (e: MouseEvent) => {
        // Moving between two children of the same explained element fires out and over; over decides.
        const to = e.relatedTarget as Element | null;
        if (to && typeof to.closest === 'function' && this._find(to)) return;
        this._current = null;
        window.clearTimeout(this._timer);
        this._timer = 0;
        this._conceal();
    };

    private _hide = () => { this.hide(); };

    /** The nearest element, from the target up to its panel, that has something to say. */
    private _find (target: Element): Element | null {
        const root = target.closest(ROOTS);
        if (!root) return null;
        for (let node: Element | null = target; node; node = node.parentElement) {
            const title = node.getAttribute('title');
            if (title) {
                // Take the text over and silence the browser's own tooltip.
                node.setAttribute('data-tip', title);
                node.removeAttribute('title');
            }
            if (node.getAttribute('data-tip')) return node;
            if (node === root) break;
        }
        return null;
    }

    private _show (element: Element) {
        this._timer = 0;
        if (!element.isConnected) return;
        const text = element.getAttribute('data-tip');
        if (!text) return;
        this._fill(text);
        this._place(0, 0, element.getBoundingClientRect());
    }

    private _fill (text: string) {
        if (!this._el) {
            this._el = document.createElement('div');
            this._el.className = 'sv-tip';
            document.body.appendChild(this._el);
        }
        this._el.textContent = '';
        const lines = text.split('\n');
        const heading = document.createElement('div');
        heading.className = lines.length > 1 ? 'sv-tip-title' : 'sv-tip-body';
        heading.textContent = lines[0];
        this._el.appendChild(heading);
        if (lines.length > 1) {
            const body = document.createElement('div');
            body.className = 'sv-tip-body';
            body.textContent = lines.slice(1).join(' ');
            this._el.appendChild(body);
        }
        this._el.style.display = 'block';
    }

    /**
     * Put the tooltip below the anchor (or above, if there is no room below), or at (x, y)
     * when there is no anchor, and keep it inside the window either way.
     */
    private _place (x: number, y: number, anchor: DOMRect | null) {
        const el = this._el;
        const size = el.getBoundingClientRect();
        let left = anchor ? anchor.left : x;
        let top = anchor ? anchor.bottom + GAP : y;

        if (left + size.width > window.innerWidth - EDGE) left = window.innerWidth - EDGE - size.width;
        if (top + size.height > window.innerHeight - EDGE) {
            top = anchor ? anchor.top - size.height - GAP : window.innerHeight - EDGE - size.height;
        }
        el.style.left = `${Math.max(EDGE, left)}px`;
        el.style.top = `${Math.max(EDGE, top)}px`;
        this._visible = true;
    }
}

/** How far outside a word's box the pointer may be and still count as on it, in pixels. */
const SLACK = 3;

/**
 * Whether a point is over the element's own text, as opposed to its padding, its empty
 * space or a control inside it. Each piece of text is measured separately, so a row with
 * a label, a switch and a key cap answers yes over the label and the key cap and no over
 * the rest. An element with no text at all (a coloured square, an icon) is judged by its
 * whole box instead. Where the browser cannot measure text, everything counts.
 */
export function overText (element: Element, x: number, y: number): boolean {
    if (typeof document.createTreeWalker !== 'function' || typeof document.createRange !== 'function') return true;
    if (typeof x !== 'number' || typeof y !== 'number') return true;

    // 4 is NodeFilter.SHOW_TEXT.
    const walker = document.createTreeWalker(element, 4);
    let anyText = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue;
        if (!value || !value.trim()) continue;
        anyText = true;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (x >= r.left - SLACK && x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK) return true;
        }
    }
    return !anyText;
}

export const tooltip = new Tooltip();

/** Give an element a tooltip. A line break splits the heading from the body. */
export function tip (element: Element | null, text: string): void {
    if (element) element.setAttribute('data-tip', text);
}
