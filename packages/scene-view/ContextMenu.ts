import { ensureStyles } from './DebugOverlay';

export interface MenuItem {
    label?: string;
    /** Shown on the right, as a reminder. The menu itself does nothing with it. */
    shortcut?: string;
    disabled?: boolean;
    /** A thin line between groups. Every other field is ignored. */
    separator?: boolean;
    /** A submenu, opened to the side while the item is hovered. */
    children?: MenuItem[];
    run?: () => void;
}

/** Space kept between a menu and the window edge. */
const EDGE = 6;

/**
 * A right-click style menu with submenus, in the manner of the Cocos editor's.
 *
 * The browser's own context menu cannot be extended, so this draws one: a stack of
 * panels, each submenu opening beside the item that owns it and flipping to the other
 * side when it would run off the window. It closes when the pointer goes down anywhere
 * else, on Escape, when the window loses focus, and after an item has been chosen.
 *
 * It holds no state about what the items do; each carries its own `run`.
 */
export class ContextMenu {
    /** True while the pointer is over any panel, so the scene underneath can ignore it. */
    public get cursorInside (): boolean { return this._inside; }

    public get isOpen (): boolean { return this._levels.length > 0; }

    private _levels: HTMLElement[] = [];
    private _inside = false;
    private _listening = false;

    /** Open the menu with its top-left corner at (x, y), in CSS pixels. Replaces any menu already open. */
    public open (x: number, y: number, items: MenuItem[]) {
        if (typeof document === 'undefined') return;
        ensureStyles();
        this.close();
        this._openLevel(items, 0, x, y, null);

        // Registered next tick, so the very click or contextmenu event that opened it does not close it.
        window.setTimeout(() => {
            if (!this._levels.length || this._listening) return;
            this._listening = true;
            document.addEventListener('mousedown', this._outside, true);
            document.addEventListener('keydown', this._key, true);
            window.addEventListener('blur', this._blur);
        }, 0);
    }

    public close () {
        for (const level of this._levels) level.remove();
        this._levels.length = 0;
        this._inside = false;
        if (this._listening) {
            this._listening = false;
            document.removeEventListener('mousedown', this._outside, true);
            document.removeEventListener('keydown', this._key, true);
            window.removeEventListener('blur', this._blur);
        }
    }

    private _openLevel (items: MenuItem[], depth: number, x: number, y: number, anchor: DOMRect | null) {
        const menu = document.createElement('div');
        menu.className = 'sv-menu';
        menu.addEventListener('mouseenter', () => { this._inside = true; });
        menu.addEventListener('mouseleave', () => { this._inside = false; });
        // The browser's menu must not appear on top of ours.
        menu.addEventListener('contextmenu', (e) => e.preventDefault());

        for (const item of items) menu.appendChild(this._element(item, depth));

        document.body.appendChild(menu);
        this._levels[depth] = menu;

        const size = menu.getBoundingClientRect();
        let left = anchor ? anchor.right - 2 : x;
        let top = anchor ? anchor.top - 4 : y;

        if (left + size.width > window.innerWidth - EDGE) {
            // A submenu goes to the other side of its parent; the first menu just slides in.
            left = anchor ? anchor.left - size.width + 2 : window.innerWidth - EDGE - size.width;
        }
        if (top + size.height > window.innerHeight - EDGE) top = window.innerHeight - EDGE - size.height;
        menu.style.left = `${Math.max(EDGE, left)}px`;
        menu.style.top = `${Math.max(EDGE, top)}px`;
    }

    private _element (item: MenuItem, depth: number): HTMLElement {
        if (item.separator) {
            const line = document.createElement('div');
            line.className = 'sv-menu-sep';
            return line;
        }

        const row = document.createElement('div');
        row.className = 'sv-menu-item' + (item.disabled ? ' sv-disabled' : '');

        const label = document.createElement('span');
        label.className = 'sv-menu-label';
        label.textContent = item.label || '';
        row.appendChild(label);

        if (item.shortcut) {
            const shortcut = document.createElement('span');
            shortcut.className = 'sv-menu-shortcut';
            shortcut.textContent = item.shortcut;
            row.appendChild(shortcut);
        }
        if (item.children && item.children.length) {
            const arrow = document.createElement('span');
            arrow.className = 'sv-menu-arrow';
            arrow.textContent = '▸';
            row.appendChild(arrow);
        }

        row.addEventListener('mouseenter', () => {
            // Hovering any item closes whatever was open beside the previous one.
            this._trim(depth + 1);
            if (!item.disabled && item.children && item.children.length) {
                this._openLevel(item.children, depth + 1, 0, 0, row.getBoundingClientRect());
            }
        });
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.disabled || (item.children && item.children.length)) return;
            this.close();
            item.run?.();
        });
        return row;
    }

    /** Close every panel from `depth` on, keeping the ones above. */
    private _trim (depth: number) {
        while (this._levels.length > depth) this._levels.pop().remove();
    }

    private _outside = (e: Event) => {
        const target = e.target as Node;
        if (this._levels.some((level) => level.contains(target))) return;
        this.close();
    };

    private _key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this.close();
    };

    private _blur = () => { this.close(); };
}
