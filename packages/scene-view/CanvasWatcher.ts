import { game } from 'cc';

/**
 * Re-measure again this long after a change, in milliseconds.
 *
 * The engine applies a new size over a few frames, so the first measurement after a
 * change can still see the old canvas. A few later ones catch it once it has settled.
 */
const SETTLE_MS = [60, 250, 700];

/**
 * Tells the scene view when the canvas has moved or changed size, so everything
 * positioned from its rect can follow.
 *
 * Choosing a device in the preview page's Design Resolution list sets the engine's
 * window size and then fires `resize` straight away, before the canvas has changed.
 * A handler that measured then saw the old canvas. Rotate fires `orientationchange`
 * instead, which nothing was listening to. A ResizeObserver on the canvas reports the
 * change itself, whoever makes it and however, which is why it is the main trigger
 * here; the window events and the settling re-measures cover what it cannot see, such
 * as the canvas moving without changing size.
 */
export class CanvasWatcher {
    private _observer: ResizeObserver = null;
    private _timers: number[] = [];
    private _callback: () => void = null;

    public start (callback: () => void) {
        if (typeof window === 'undefined' || this._callback) return;
        this._callback = callback;

        window.addEventListener('resize', this._notify);
        window.addEventListener('orientationchange', this._notify);

        const canvas = game.canvas as HTMLCanvasElement;
        if (canvas && typeof ResizeObserver !== 'undefined') {
            this._observer = new ResizeObserver(this._notify);
            this._observer.observe(canvas);
            // The page resizes the container the canvas lives in, not always the canvas.
            if (canvas.parentElement) this._observer.observe(canvas.parentElement);
        }
    }

    public stop () {
        if (typeof window === 'undefined') return;
        window.removeEventListener('resize', this._notify);
        window.removeEventListener('orientationchange', this._notify);
        this._observer?.disconnect();
        this._observer = null;
        this._clearTimers();
        this._callback = null;
    }

    private _notify = () => {
        if (!this._callback) return;
        this._callback();

        this._clearTimers();
        for (const delay of SETTLE_MS) {
            this._timers.push(window.setTimeout(() => this._callback?.(), delay));
        }
    };

    private _clearTimers () {
        for (const timer of this._timers) window.clearTimeout(timer);
        this._timers.length = 0;
    }
}
