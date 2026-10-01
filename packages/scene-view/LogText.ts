import { LogEntry } from './ConsoleCapture';

type Line = Pick<LogEntry, 'time' | 'level' | 'text' | 'count'>;

/** `HH:MM:SS.mmm`, local time. */
export function clock (ms: number): string {
    const d = new Date(ms);
    // No String.padStart: the projects this is dropped into may target an older library.
    const pad = (n: number, width = 2) => {
        let text = String(n);
        while (text.length < width) text = `0${text}`;
        return text;
    };
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** A whole log line as copied: time, level, message, and how many times it repeated. */
export function formatLine (entry: Line): string {
    return `${clock(entry.time)} [${entry.level}] ${entry.text}${entry.count > 1 ? ` (x${entry.count})` : ''}`;
}

/** Just the message, for pasting somewhere that has its own timestamps. */
export function formatMessage (entry: Line): string {
    return entry.text;
}

/**
 * Which log rows are picked, with the usual rules of a list:
 *   click           picks that row alone, or clears it if it was the only one picked;
 *   Ctrl / Cmd      adds or removes that one row;
 *   Shift           picks everything from the last clicked row to this one.
 *
 * Rows are identified by entry id, and `order` is always the ids on screen from top to
 * bottom, so a range follows what the user sees and not the order things were logged in.
 */
export class LogSelection {
    private _picked = new Set<number>();
    private _anchor: number | null = null;

    public get size (): number { return this._picked.size; }

    public has (id: number): boolean { return this._picked.has(id); }

    /** The picked ids in display order. */
    public inOrder (order: readonly number[]): number[] {
        return order.filter((id) => this._picked.has(id));
    }

    public clear () {
        this._picked.clear();
        this._anchor = null;
    }

    public selectAll (order: readonly number[]) {
        this._picked = new Set(order);
        this._anchor = order.length ? order[order.length - 1] : null;
    }

    public click (id: number, order: readonly number[], additive: boolean, range: boolean) {
        const anchorAt = this._anchor === null ? -1 : order.indexOf(this._anchor);
        const at = order.indexOf(id);

        if (range && anchorAt >= 0 && at >= 0) {
            if (!additive) this._picked.clear();
            const [from, to] = anchorAt < at ? [anchorAt, at] : [at, anchorAt];
            for (let i = from; i <= to; i++) this._picked.add(order[i]);
            return; // The anchor stays, so the range can be stretched again.
        }

        if (additive) {
            if (this._picked.has(id)) this._picked.delete(id);
            else this._picked.add(id);
        } else if (this._picked.size === 1 && this._picked.has(id)) {
            this._picked.clear();
        } else {
            this._picked.clear();
            this._picked.add(id);
        }
        this._anchor = id;
    }

    /** Forget picked rows that are no longer in `order` (cleared, filtered out, or scrolled out of the log). */
    public retain (order: readonly number[]) {
        const present = new Set(order);
        for (const id of Array.from(this._picked)) {
            if (!present.has(id)) this._picked.delete(id);
        }
        if (this._anchor !== null && !present.has(this._anchor)) this._anchor = null;
    }
}
