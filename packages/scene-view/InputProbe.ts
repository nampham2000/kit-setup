import { EventKeyboard, EventMouse, Input, game, input } from 'cc';

/**
 * Reports which input channels actually deliver events, once each.
 *
 * Mouse input can die at several independent points between the OS and this code,
 * and from the inside they all look identical: nothing happens. This separates
 * them, so one click answers the question instead of a round of guesses.
 *
 * The chain, outermost first:
 *   window pointerdown (capture)  - does the event reach the document at all
 *   window mousedown   (capture)  - does the legacy mouse event reach it
 *   canvas mousedown              - does it reach the canvas Cocos listens on
 *   overlay pointerdown           - do our own DOM widgets receive pointer events
 *   cc MOUSE_DOWN / UP / MOVE     - does the engine dispatch it
 *
 * A gap between two neighbouring lines names the layer that swallows the event.
 */
export class InputProbe {
    private _seen = new Set<string>();
    private _domHandlers: { target: EventTarget; type: string; fn: any; capture: boolean }[] = [];
    private _installed = false;

    public install (overlayRoots: (HTMLElement | null)[]) {
        if (this._installed) return;
        this._installed = true;

        input.on(Input.EventType.MOUSE_DOWN, this._ccDown, this);
        input.on(Input.EventType.MOUSE_UP, this._ccUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this._ccMove, this);
        input.on(Input.EventType.KEY_DOWN, this._ccKey, this);

        if (typeof document === 'undefined') return;

        this._dom(window, 'pointerdown', (e: PointerEvent) => {
            this._report('window pointerdown (capture)', `client ${Math.round(e.clientX)},${Math.round(e.clientY)}`
                + ` target ${describe(e.target)} focus ${document.hasFocus()}`);
        }, true);

        this._dom(window, 'mousedown', (e: MouseEvent) => {
            this._report('window mousedown (capture)', `button ${e.button} target ${describe(e.target)}`);
        }, true);

        const canvas = game.canvas as HTMLCanvasElement;
        if (canvas) {
            this._dom(canvas, 'mousedown', (e: MouseEvent) => {
                this._report('canvas mousedown', `button ${e.button}`);
            }, false);
        } else {
            this._report('canvas mousedown', 'NO CANVAS - game.canvas is null');
        }

        for (const root of overlayRoots) {
            if (!root) continue;
            this._dom(root, 'pointerdown', () => {
                this._report(`overlay pointerdown (.${root.className})`, 'reached the widget');
            }, false);
        }

        console.log('[SceneView] input probe armed - click once in the scene viewport, '
            + 'then send the lines that follow. Missing lines are the point of failure.');
    }

    public uninstall () {
        if (!this._installed) return;
        this._installed = false;

        input.off(Input.EventType.MOUSE_DOWN, this._ccDown, this);
        input.off(Input.EventType.MOUSE_UP, this._ccUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this._ccMove, this);
        input.off(Input.EventType.KEY_DOWN, this._ccKey, this);

        for (const h of this._domHandlers) h.target.removeEventListener(h.type, h.fn, h.capture);
        this._domHandlers.length = 0;
        this._seen.clear();
    }

    private _dom (target: EventTarget, type: string, fn: any, capture: boolean) {
        target.addEventListener(type, fn, capture);
        this._domHandlers.push({ target, type, fn, capture });
    }

    private _report (channel: string, detail: string) {
        if (this._seen.has(channel)) return;
        this._seen.add(channel);
        console.log(`[SceneView][probe] ${channel}: ${detail}`);
    }

    private _ccDown (e: EventMouse) {
        this._report('cc MOUSE_DOWN', `button ${e.getButton()} at ${Math.round(e.getLocationX())},${Math.round(e.getLocationY())}`);
    }

    private _ccUp (e: EventMouse) {
        this._report('cc MOUSE_UP', `button ${e.getButton()} at ${Math.round(e.getLocationX())},${Math.round(e.getLocationY())}`);
    }

    private _ccMove (e: EventMouse) {
        this._report('cc MOUSE_MOVE', `at ${Math.round(e.getLocationX())},${Math.round(e.getLocationY())}`);
    }

    private _ccKey (e: EventKeyboard) {
        this._report('cc KEY_DOWN', `keyCode ${e.keyCode}`);
    }
}

function describe (target: EventTarget | null): string {
    const el = target as HTMLElement;
    if (!el || !el.tagName) return String(target);
    return `${el.tagName.toLowerCase()}${el.className ? `.${el.className}` : ''}`;
}
