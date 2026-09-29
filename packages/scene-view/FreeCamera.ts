import { Camera, EventKeyboard, EventMouse, Input, KeyCode, Node, Quat, Vec3, input } from 'cc';
import { isInsideViewport } from './ScenePicker';

const _move = new Vec3();
const _tmp = new Vec3();
const _rot = new Quat();

/**
 * Editor-style free-fly camera driven by raw input. Not a Component — the
 * scene view owns one and ticks it, so nothing has to be wired in the editor.
 *
 * Controls: hold RMB to look, WASD to move, Q/E down/up, MMB to pan,
 * wheel to dolly, Shift to move faster.
 */
export class FreeCamera {
    /** Drags are only honoured inside this camera's viewport. */
    public viewportCamera: Camera = null;

    public moveSpeed = 8;
    public fastMultiplier = 3;
    public lookSensitivity = 0.15;
    public panSpeed = 0.01;
    public dollySpeed = 0.02;

    private _node: Node;
    private _yaw = 0;
    private _pitch = 0;
    private _looking = false;
    private _panning = false;
    private _keys = new Set<KeyCode>();
    private _attached = false;

    constructor (node: Node) {
        this._node = node;
        const euler = node.eulerAngles;
        this._yaw = euler.y;
        this._pitch = euler.x;
    }

    public attach () {
        if (this._attached) return;
        this._attached = true;
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);
        input.on(Input.EventType.MOUSE_WHEEL, this._onMouseWheel, this);
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    public detach () {
        if (!this._attached) return;
        this._attached = false;
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);
        input.off(Input.EventType.MOUSE_WHEEL, this._onMouseWheel, this);
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this._onKeyUp, this);
        this._looking = false;
        this._panning = false;
        this._keys.clear();
    }

    /**
     * Drop all held keys. Cocos registers keyup on the canvas, so a key held down
     * while focus moves to a DOM field never gets its keyup and would stay stuck.
     */
    public clearKeys () { this._keys.clear(); }

    /**
     * Re-read yaw/pitch from the node. Call after moving the camera externally
     * (e.g. focusing on a selection), otherwise the next look input snaps the
     * camera back to the stale angles cached here.
     */
    public syncFromNode () {
        const euler = this._node.eulerAngles;
        this._yaw = euler.y;
        this._pitch = euler.x;
    }

    public update (dt: number) {
        if (!this._keys.size) return;

        _move.set(0, 0, 0);
        if (this._keys.has(KeyCode.KEY_W)) Vec3.add(_move, _move, this._node.forward);
        if (this._keys.has(KeyCode.KEY_S)) Vec3.subtract(_move, _move, this._node.forward);
        if (this._keys.has(KeyCode.KEY_D)) Vec3.add(_move, _move, this._node.right);
        if (this._keys.has(KeyCode.KEY_A)) Vec3.subtract(_move, _move, this._node.right);
        if (this._keys.has(KeyCode.KEY_E)) Vec3.add(_move, _move, Vec3.UP);
        if (this._keys.has(KeyCode.KEY_Q)) Vec3.subtract(_move, _move, Vec3.UP);
        if (_move.lengthSqr() < 1e-6) return;

        const fast = this._keys.has(KeyCode.SHIFT_LEFT) || this._keys.has(KeyCode.SHIFT_RIGHT);
        _move.normalize().multiplyScalar(this.moveSpeed * (fast ? this.fastMultiplier : 1) * dt);
        this._node.setPosition(Vec3.add(_tmp, this._node.position, _move));
    }

    private _insideViewport (e: EventMouse) {
        // Shares the picker's test so the look region and the pick region can never
        // drift apart, and so both stay in the camera's own coordinate space.
        return isInsideViewport(this.viewportCamera, e.getLocationX());
    }

    private _onMouseDown (e: EventMouse) {
        if (!this._insideViewport(e)) return;
        if (e.getButton() === EventMouse.BUTTON_RIGHT) this._looking = true;
        else if (e.getButton() === EventMouse.BUTTON_MIDDLE) this._panning = true;
    }

    private _onMouseUp (e: EventMouse) {
        if (e.getButton() === EventMouse.BUTTON_RIGHT) this._looking = false;
        else if (e.getButton() === EventMouse.BUTTON_MIDDLE) this._panning = false;
    }

    private _onMouseMove (e: EventMouse) {
        if (this._looking) {
            this._yaw -= e.getDeltaX() * this.lookSensitivity;
            // Mouse Y grows upward in Cocos, and pitching up is a positive X rotation.
            this._pitch += e.getDeltaY() * this.lookSensitivity;
            this._pitch = Math.max(-89, Math.min(89, this._pitch));
            Quat.fromEuler(_rot, this._pitch, this._yaw, 0);
            this._node.setRotation(_rot);
        } else if (this._panning) {
            Vec3.multiplyScalar(_move, this._node.right, -e.getDeltaX() * this.panSpeed);
            Vec3.scaleAndAdd(_move, _move, this._node.up, -e.getDeltaY() * this.panSpeed);
            this._node.setPosition(Vec3.add(_tmp, this._node.position, _move));
        }
    }

    private _onMouseWheel (e: EventMouse) {
        if (!this._insideViewport(e)) return;
        Vec3.multiplyScalar(_move, this._node.forward, e.getScrollY() * this.dollySpeed);
        this._node.setPosition(Vec3.add(_tmp, this._node.position, _move));
    }

    private _onKeyDown (e: EventKeyboard) { this._keys.add(e.keyCode); }
    private _onKeyUp (e: EventKeyboard) { this._keys.delete(e.keyCode); }
}
