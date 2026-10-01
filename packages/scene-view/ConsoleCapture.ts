export type LogLevel = 'log' | 'warn' | 'error';

export interface LogEntry {
    id: number;
    level: LogLevel;
    /** Wall-clock time of the first occurrence, in milliseconds. */
    time: number;
    text: string;
    /** How many times in a row this exact message was logged. */
    count: number;
}

const MAX_ENTRIES = 1000;
const MAX_TEXT = 4000;

/**
 * Everything the page logs, kept so the scene view can show it without DevTools.
 *
 * It wraps the console methods rather than replacing them: the original always runs
 * first, so DevTools, if open, still shows everything exactly as before. Uncaught
 * errors, unhandled promise rejections and failed resource loads are recorded too,
 * since those are the lines people open F12 to look for. Identical messages logged
 * back to back are folded into one entry with a count, as DevTools does.
 *
 * Installed when this module is first imported, because a hook added later cannot
 * recover what was logged before it.
 */
class ConsoleCapture {
    public readonly entries: LogEntry[] = [];
    public readonly counts: Record<LogLevel, number> = { log: 0, warn: 0, error: 0 };
    /** Bumped by clear(), so a view can tell that its rows no longer match the entries. */
    public generation = 0;

    private _listeners = new Set<() => void>();
    private _nextId = 1;
    private _installed = false;

    public subscribe (listener: () => void): () => void {
        this._listeners.add(listener);
        return () => { this._listeners.delete(listener); };
    }

    public clear () {
        this.generation++;
        this.entries.length = 0;
        this.counts.log = 0;
        this.counts.warn = 0;
        this.counts.error = 0;
        this._notify();
    }

    public install () {
        if (this._installed || typeof window === 'undefined' || typeof console === 'undefined') return;
        this._installed = true;

        const levels: [keyof Console, LogLevel][] = [
            ['log', 'log'], ['info', 'log'], ['debug', 'log'], ['warn', 'warn'], ['error', 'error'],
        ];
        for (const [method, level] of levels) {
            const original = console[method] as (...args: unknown[]) => void;
            if (typeof original !== 'function') continue;
            (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
                original.apply(console, args);
                try {
                    this.push(level, formatArgs(args));
                } catch {
                    // Recording must never break the game's own logging.
                }
            };
        }

        window.addEventListener('error', (event) => {
            const target = event.target as (HTMLElement & { src?: string; href?: string }) | Window | null;
            if (target && target !== window && (target as HTMLElement).tagName) {
                // A resource that failed to load: it carries no message of its own.
                const el = target as HTMLElement & { src?: string; href?: string };
                this.push('error', `Failed to load <${el.tagName.toLowerCase()}>: ${el.src || el.href || '(unknown)'}`);
                return;
            }
            // A stack already starts with the message, so use it alone when there is one.
            if (event.error && event.error.stack) {
                this.push('error', `Uncaught ${event.error.stack}`);
                return;
            }
            const where = event.filename ? `\n    at ${shortName(event.filename)}:${event.lineno}:${event.colno}` : '';
            this.push('error', `Uncaught ${event.message}${where}`);
        }, true);

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            this.push('error', `Unhandled promise rejection: ${reason instanceof Error ? (reason.stack || reason.message) : safeJson(reason)}`);
        });
    }

    public push (level: LogLevel, text: string) {
        const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}... (${text.length - MAX_TEXT} more characters)` : text;
        this.counts[level]++;

        const last = this.entries[this.entries.length - 1];
        if (last && last.level === level && last.text === clipped) {
            last.count++;
        } else {
            this.entries.push({ id: this._nextId++, level, time: Date.now(), text: clipped, count: 1 });
            if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        }
        this._notify();
    }

    private _notify () {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch {
                // A broken listener must not stop the others, or the game.
            }
        }
    }
}

function shortName (url: string): string {
    const clean = url.split('?')[0];
    const slash = clean.lastIndexOf('/');
    return slash >= 0 ? clean.slice(slash + 1) : clean;
}

function safeJson (value: unknown): string {
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
    try {
        const seen = new WeakSet<object>();
        const text = JSON.stringify(value, (_key, item) => {
            if (typeof item === 'bigint') return `${item}n`;
            if (item && typeof item === 'object') {
                if (seen.has(item)) return '[Circular]';
                seen.add(item);
            }
            return item;
        });
        return text === undefined ? String(value) : text;
    } catch {
        try {
            return String(value);
        } catch {
            return '[unprintable]';
        }
    }
}

/**
 * console.log arguments to one line of text. Handles the printf-style substitutions
 * (%s %d %i %f %o %O) and drops %c, whose argument is a CSS string that only DevTools can use.
 */
function formatArgs (args: unknown[]): string {
    const rest = args.slice();
    let head = '';

    if (typeof rest[0] === 'string' && /%[sdifoOc]/.test(rest[0] as string)) {
        const template = rest.shift() as string;
        head = template.replace(/%([sdifoOc%])/g, (match, kind: string) => {
            if (kind === '%') return '%';
            if (!rest.length) return match;
            const value = rest.shift();
            switch (kind) {
            case 'c': return '';
            case 'd': case 'i': return String(parseInt(String(value), 10));
            case 'f': return String(parseFloat(String(value)));
            case 's': return typeof value === 'string' ? value : safeJson(value);
            default: return safeJson(value);
            }
        });
    }

    const parts = rest.map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
        return safeJson(arg);
    });
    return head ? [head, ...parts].join(' ') : parts.join(' ');
}

export const consoleLog = new ConsoleCapture();
consoleLog.install();
