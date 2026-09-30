import {
    CCObject, Camera, Color, Component, EventKeyboard, EventMouse, Input, KeyCode, Layers,
    screen,
    MeshRenderer, Node, Rect, UIRenderer, UITransform, Vec3, _decorator, director, game, input,
} from 'cc';
import { DEBUG, EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { DebugOverlay, ensureStyles } from './DebugOverlay';
import { EditorBridge } from './EditorBridge';
import { Axis, GizmoMode, TransformGizmo } from './TransformGizmo';
import { ToolPalette } from './ToolPalette';
import { ViewSplitter } from './ViewSplitter';
import { FreeCamera } from './FreeCamera';
import { HierarchyPanel } from './HierarchyPanel';
import { InputProbe } from './InputProbe';
import { InspectorPanel } from './InspectorPanel';
import { GeometryRenderer, drawBounds, drawFrustum, drawGrid, drawSelection, drawUIBounds, drawWorldAxes } from './SceneGizmos';
import { isInsideViewport, pickRenderer, pickUI, viewportMinX } from './ScenePicker';
import { VisibilityController } from './VisibilityController';

const { ccclass, property, menu } = _decorator;

const BOUNDS_COLOR = new Color(120, 220, 160, 100);
const FRUSTUM_COLOR = new Color(255, 200, 80, 220);
const UI_BOUNDS_COLOR = new Color(90, 190, 255, 120);
const SCENE_BG = new Color(38, 40, 46, 255);

/** Starting fraction of the screen width where the scene viewport begins. */
const DEFAULT_SPLIT = 0.5;

/** A press that travels farther than this (device px) is a drag, not a click. */
const CLICK_SLOP = 4;

/**
 * What the scene view is allowed to see.
 *
 * UI layers are out because UI is authored in screen space and would render
 * nonsensically from an arbitrary viewpoint.
 *
 * The editor layers matter more than they look: the in-editor Preview panel runs
 * in the editor's own scene process, so the editor's gizmo meshes (the X/Y/Z
 * handles under "Editor Scene Foreground / gizmoRoot", on SCENE_GIZMO) are real
 * nodes in the running scene graph. Without this mask they show up in the
 * viewport, collect bounding boxes, and can be clicked and selected.
 */
const EXCLUDED_LAYERS = Layers.Enum.UI_2D
    | Layers.Enum.UI_3D
    | Layers.Enum.GIZMOS
    | Layers.Enum.EDITOR
    | Layers.Enum.SCENE_GIZMO
    | Layers.Enum.PROFILER;

const SCENE_VISIBILITY = Layers.Enum.ALL & ~EXCLUDED_LAYERS;

/**
 * A Unity-style Scene view running inside the game itself.
 *
 * Splits the screen: the real game renders on the left with its own cameras
 * untouched apart from their viewport, and a free-fly observer camera renders the
 * same live scene on the right, with gizmos, picking, a hierarchy tree and a live
 * inspector on top.
 *
 * Attach to any node in the scene. Press F1 to toggle.
 */
@ccclass('SceneViewDebug')
@menu('Debug/Scene View')
export class SceneViewDebug extends Component {
    @property({ tooltip: 'Start with the scene view open.' })
    public startEnabled = true;

    @property({ tooltip: 'Draw a wireframe AABB around every MeshRenderer.' })
    public showBounds = true;

    @property({ tooltip: 'Draw the game camera frustum.' })
    public showFrustum = true;

    @property({ tooltip: 'Draw the ground grid.' })
    public showGrid = true;

    @property({ tooltip: 'Draw the world-origin axis cross. Off by default: it sits on '
        + 'top of whatever is at the origin and gets in the way.' })
    public showWorldAxes = false;

    @property({ tooltip: 'Also pick UI elements. They are screen-space, so the viewport draws their outline rather than the UI itself - that is the only way to aim at them.' })
    public enableUIPicking = true;

    @property({ tooltip: 'Click objects in the scene viewport to select them.' })
    public enablePicking = true;

    @property({ tooltip: 'Drag the coloured handles to move, rotate or scale the selected '
        + 'node. Switch tool with 1 / 2 / 3.' })
    public enableTransformGizmo = true;

    @property({ tooltip: 'Log the coordinate spaces and the topmost element at the divider '
        + 'on open. For diagnosing input that does not reach the viewport.' })
    public debugInput = false;

    @property({ tooltip: 'Clickable tool strip at the left edge of the scene viewport.' })
    public showToolPalette = true;

    @property({ tooltip: 'Draggable bar between the game view and the scene view.' })
    public showSplitter = true;

    @property({ tooltip: 'Select the picked node in the editor Hierarchy and Inspector '
        + 'instead of using the built-in panels. Only possible in the in-editor Preview.' })
    public syncEditorSelection = true;

    @property({ tooltip: 'Show the built-in hierarchy tree and inspector overlay. Off by '
        + 'default: in the editor Preview the real editor panels do this better. Turn on '
        + 'for browser preview or a debug build, where no editor exists.' })
    public showPanels = false;

    @property({ tooltip: 'Seconds between rescans of the scene for new renderers.' })
    public rescanInterval = 0.5;

    private _sceneCamera: Camera = null;
    private _freeCamera: FreeCamera = null;
    private _gizmos: GeometryRenderer = null;
    private _overlay = new DebugOverlay();
    private _bridge = new EditorBridge();
    private _splitter = new ViewSplitter();
    private _handles = new TransformGizmo();
    private _palette = new ToolPalette();
    private _probe = new InputProbe();
    private _split = DEFAULT_SPLIT;
    private _grabbedAxis: Axis | null = null;
    private _inspector = new InspectorPanel();
    private _visibility = new VisibilityController();
    private _hierarchy: HierarchyPanel = null;
    private _savedRects = new Map<Camera, Rect>();
    private _renderers: MeshRenderer[] = [];
    private _uiElements: UIRenderer[] = [];
    private _selected: Node = null;
    private _rescanTimer = 0;
    private _active = false;
    private _hint: HTMLElement = null;
    private _warnedNoGizmos = false;
    private _pressValid = false;
    private _pressX = 0;
    private _pressY = 0;

    protected onLoad () {
        // NOTE: EDITOR is true inside the editor Preview panel too, so guard on the
        // narrower macro — otherwise the scene view never starts while previewing.
        if (EDITOR_NOT_IN_PREVIEW) return;
        if (!DEBUG) {
            // Never ship the scene view in a release build.
            this.destroy();
            return;
        }

        this._hierarchy = new HierarchyPanel(this._visibility, {
            onSelect: (node) => this.select(node),
            onToggleHide: (node) => this._visibility.toggleHidden(node),
            onToggleSolo: (node) => this._visibility.toggleSolo(node, director.getScene()),
        });
        // A key held while focus moves into a field never gets its keyup.
        this._overlay.onFocusIn = () => this._freeCamera?.clearKeys();

        if (this.syncEditorSelection) this._bridge.probe();
        console.log(`[SceneView] ${this._bridge.describe()}`);

        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        this._suppressContextMenu();
        if (this.startEnabled) this.open();
    }

    protected onDestroy () {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        this.close();
        // close() only parks the observer camera; this is where it actually goes.
        if (this._sceneCamera && this._sceneCamera.isValid) this._sceneCamera.node.destroy();
        this._sceneCamera = null;
    }

    protected update (dt: number) {
        if (!this._active) return;

        this._freeCamera.update(dt);

        this._rescanTimer -= dt;
        if (this._rescanTimer <= 0) {
            this._rescanTimer = this.rescanInterval;
            this._rescan();
            if (this.showPanels) {
                this._hierarchy.refresh(director.getScene().children, EXCLUDED_LAYERS, this._sceneCamera?.node);
            }
            if (this._bridge.available) this._pullEditorSelection();
            this._syncWidgets();
        }

        // Gameplay can destroy the selected node at any moment.
        if (this._selected && !this._selected.isValid) this.select(null);
        if (this.showPanels) this._inspector.sync();

        // Kept above the gizmo-renderer guard: hit-testing uses the handle size
        // computed here, so it must stay current even when nothing can be drawn.
        if (this.enableTransformGizmo) this._handles.sync(this._sceneCamera, this._selected);

        if (!this._gizmos && !this._initGizmos()) return;
        if (this.showGrid) drawGrid(this._gizmos);
        if (this.showWorldAxes) drawWorldAxes(this._gizmos);
        if (this.showBounds) drawBounds(this._gizmos, this._renderers, BOUNDS_COLOR);
        if (this.enableUIPicking) drawUIBounds(this._gizmos, this._uiElements, UI_BOUNDS_COLOR);
        if (this.showFrustum) {
            for (const camera of this._savedRects.keys()) {
                if (camera.isValid && camera.enabledInHierarchy) drawFrustum(this._gizmos, camera, FRUSTUM_COLOR);
            }
        }
        if (this._selected) {
            drawSelection(this._gizmos, this._selected);
            if (this.enableTransformGizmo) this._handles.draw(this._gizmos);
        }

        // Overlay widgets go last so they sit on top of the scene and the gizmos.
        if (this.showSplitter) this._splitter.draw(this._gizmos);
        if (this.enableTransformGizmo && this.showToolPalette) this._palette.draw(this._gizmos);
    }

    public toggle () { this._active ? this.close() : this.open(); }

    public get selected (): Node | null { return this._selected; }

    public select (node: Node | null) {
        this._selected = node && node.isValid ? node : null;
        this._hierarchy.setSelected(this._selected);
        this._inspector.show(this._selected);

        // Drive the editor's own Hierarchy and Inspector. Reverse sync compares
        // uuids, so echoing our own selection back is a no-op, not a loop.
        if (!this._bridge.available) return;
        if (this._selected) this._bridge.select(this._selected.uuid);
        else this._bridge.clear();
    }

    /** Follow a selection made in the editor's Hierarchy panel. */
    private _pullEditorSelection () {
        const uuid = this._bridge.currentSelection();
        if (!uuid || uuid === this._selected?.uuid) return;

        const node = findByUuid(director.getScene(), uuid);
        if (node && node !== this._selected) {
            this._selected = node;
            this._hierarchy.setSelected(node);
            this._inspector.show(node);
        }
    }

    public open () {
        if (this._active) return;
        this._active = true;

        this._splitGameCameras();
        this._ensureSceneCamera();
        this._rescan();

        if (this.showPanels && this._overlay.available) {
            this._overlay.mount();
            this._hierarchy.mount(this._overlay);
            this._inspector.mount(this._overlay);
        }
        // Every widget is driven by engine input now, so these listeners are what
        // makes the divider and the tool strip clickable, not just picking.
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);

        if (this.showSplitter) {
            this._splitter.onChange = (fraction) => this._applySplit(fraction);

        }
        if (this.enableTransformGizmo && this.showToolPalette) {
            this._palette.setMode(this._handles.mode);
        }
        this._syncWidgets();

        if (this.debugInput) {
            this._logInputDiagnostics();
            this._probe.install([]);
        }
        this._showHint();
    }

    public close () {
        if (!this._active) return;
        this._active = false;

        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);


        this._probe.uninstall();
        this._handles.endDrag();
        this._grabbedAxis = null;
        this._freeCamera?.detach();
        this._freeCamera = null;
        this._gizmos = null;
        this._selected = null;

        // Put every renderer this tool switched off back the way it was.
        this._visibility.restoreAll();
        this._inspector.unmount();
        this._hierarchy.unmount();
        this._overlay.unmount();

        // Deactivated, not destroyed: see _ensureSceneCamera. The reference is kept
        // so _splitGameCameras can still recognise and skip it on the next open.
        if (this._sceneCamera && this._sceneCamera.isValid) this._sceneCamera.node.active = false;

        for (const [camera, rect] of this._savedRects) {
            if (camera.isValid) camera.rect = rect;
        }
        this._savedRects.clear();
        this._renderers.length = 0;
        this._hideHint();
    }

    public get gizmoMode (): GizmoMode { return this._handles.mode; }

    private _setGizmoMode (mode: GizmoMode) {
        if (!this._active || this._handles.mode === mode) return;
        // Switching tool mid-drag would reinterpret the drag under new maths.
        this._handles.endDrag();
        this._grabbedAxis = null;
        this._handles.mode = mode;
        this._handles.clearHover();
        this._palette.setMode(mode);
        this._updateHint();
    }

    /** Frame the current selection, keeping the camera's current view direction. */
    public focusSelection () {
        if (!this._selected || !this._selected.isValid || !this._sceneCamera) return;

        const bounds = this._selected.getComponent(MeshRenderer)?.model?.worldBounds;
        const target = this._selected.getWorldPosition(new Vec3());
        const radius = bounds
            ? Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z)
            : 1;

        const fovRadians = this._sceneCamera.fov * Math.PI / 180;
        const distance = Math.max(radius / Math.tan(fovRadians / 2) * 1.6, radius + 1);

        const node = this._sceneCamera.node;
        const back = new Vec3();
        Vec3.negate(back, node.forward);
        node.setPosition(Vec3.scaleAndAdd(back, target, back, distance));
        node.lookAt(target);
        // lookAt bypasses the controller, so its cached angles must be refreshed.
        this._freeCamera.syncFromNode();
    }

    /**
     * Move the divider. Every consumer of the split has to be updated together:
     * the game cameras, the observer camera, the free-look hit region and the
     * picker's viewport test all read the same fraction.
     */
    private _applySplit (fraction: number) {
        this._split = fraction;

        for (const camera of this._savedRects.keys()) {
            if (camera.isValid) camera.rect = new Rect(0, 0, fraction, 1);
        }
        if (this._sceneCamera && this._sceneCamera.isValid) {
            this._sceneCamera.rect = new Rect(fraction, 0, 1 - fraction, 1);
        }

        // The strip is anchored to the viewport boundary, not the window.
        this._syncWidgets();
    }

    /** Squeeze every existing camera — 3D and UI alike — into the left half. */
    private _splitGameCameras () {
        const cameras = director.getScene().getComponentsInChildren(Camera);
        for (const camera of cameras) {
            if (camera === this._sceneCamera) continue;
            this._savedRects.set(camera, camera.rect.clone());
            camera.rect = new Rect(0, 0, this._split, 1);
        }
    }

    /**
     * Bring up the observer camera, creating it only the first time.
     *
     * Closing the view deactivates this camera instead of destroying it. The first
     * open runs during scene activation while later ones run from an input callback
     * mid-frame, and a Camera built under those two conditions does not come up the
     * same way — reopening used to leave the viewport black. Reusing one camera
     * removes that difference entirely, and costs nothing to keep around.
     */
    private _ensureSceneCamera () {
        if (!this._sceneCamera || !this._sceneCamera.isValid) {
            const node = new Node('__SceneViewCamera__');
            node.layer = Layers.Enum.DEFAULT;
            // The in-editor Preview shares its scene graph with the editor, so this
            // runtime-only node would otherwise be saved into the .scene on Ctrl+S.
            node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
            director.getScene().addChild(node);
            node.setPosition(new Vec3(10, 10, 10));
            node.lookAt(Vec3.ZERO);
            this._sceneCamera = node.addComponent(Camera);
        }

        const camera = this._sceneCamera;
        camera.node.active = true;
        camera.enabled = true;
        camera.rect = new Rect(this._split, 0, 1 - this._split, 1);
        camera.priority = 1 << 20;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = SCENE_BG;
        camera.visibility = SCENE_VISIBILITY;
        camera.near = 0.05;
        camera.far = 2000;

        this._initGizmos();

        this._freeCamera = new FreeCamera(camera.node);
        this._freeCamera.viewportCamera = camera;
        this._freeCamera.attach();
    }

    /**
     * The renderer-side camera can lag a frame behind the component when the
     * component is added mid-update, so this is retried from `update` rather than
     * giving up after one attempt and silently losing every gizmo.
     */
    private _initGizmos (): boolean {
        if (this._gizmos) return true;

        const internal = this._sceneCamera?.camera as any;
        if (!internal) return false;

        internal.initGeometryRenderer?.();
        this._gizmos = internal.geometryRenderer ?? null;
        if (!this._gizmos && !this._warnedNoGizmos) {
            this._warnedNoGizmos = true;
            console.warn('[SceneView] GeometryRenderer unavailable - gizmos disabled. '
                + 'Enable Project Settings -> Feature Cropping -> Geometry Renderer.');
        }
        return !!this._gizmos;
    }

    /** Re-anchor the widgets to the camera. Cheap, so it also tracks canvas resizes. */
    private _syncWidgets () {
        this._splitter.sync(this._sceneCamera, this._split);
        this._palette.sync(this._sceneCamera, this._split);
    }

    private _rescan () {
        const all = director.getScene().getComponentsInChildren(MeshRenderer);
        const own = this._sceneCamera ? this._sceneCamera.node : null;
        // Same mask the camera renders with, so bounds and picking can never target
        // something the viewport does not even draw (editor gizmos, UI, profiler).
        this._renderers = all.filter((r) => r.node !== own && (r.node.layer & SCENE_VISIBILITY) !== 0);

        // UI is deliberately outside SCENE_VISIBILITY, so it is gathered on its own
        // rather than filtered by the same mask.
        this._uiElements = this.enableUIPicking
            ? director.getScene().getComponentsInChildren(UIRenderer)
            : [];
    }

    /**
     * Widgets are consulted before the scene, outermost first: the divider, then the
     * tool strip, then the gizmo handles, and only then a pick. Each one that claims
     * the press clears `_pressValid`, which is what stops the matching release from
     * also changing the selection.
     */
    private _onMouseDown (e: EventMouse) {
        if (e.getButton() !== EventMouse.BUTTON_LEFT) return;
        const x = e.getLocationX();
        const y = e.getLocationY();
        this._pressValid = true;
        this._pressX = x;
        this._pressY = y;

        if (this.showSplitter && this._splitter.hitTest(x)) {
            this._splitter.beginDrag();
            this._pressValid = false;
            return;
        }

        if (this.enableTransformGizmo && this.showToolPalette) {
            const tool = this._palette.hitTest(x, y);
            if (tool) {
                this._setGizmoMode(tool);
                this._pressValid = false;
                return;
            }
        }

        if (!this.enableTransformGizmo || !this._selected) return;
        if (this._overlay.cursorInside || !isInsideViewport(this._sceneCamera, x)) return;

        // Grabbing a handle takes priority over selecting whatever is behind it.
        const axis = this._handles.hitTest(x, y);
        if (axis !== null) {
            this._grabbedAxis = axis;
            this._handles.beginDrag(axis, x, y);
        }
    }

    private _onMouseMove (e: EventMouse) {
        const x = e.getLocationX();
        const y = e.getLocationY();

        if (this._splitter.dragging) {
            this._splitter.drag(x);
            return;
        }
        if (this.showSplitter) this._splitter.setHover(this._splitter.hitTest(x));
        if (this.enableTransformGizmo && this.showToolPalette) {
            this._palette.setHover(this._palette.hitTest(x, y));
        }

        if (!this.enableTransformGizmo || !this._selected) return;
        if (this._handles.dragging) {
            this._handles.drag(x, y);
        } else if (this._overlay.cursorInside || !isInsideViewport(this._sceneCamera, x)) {
            this._handles.clearHover();
        } else {
            this._handles.setHover(x, y);
        }
    }

    private _onMouseUp (e: EventMouse) {
        if (e.getButton() !== EventMouse.BUTTON_LEFT) return;

        // MOUSE_DOWN comes from the canvas but MOUSE_UP also comes from window, so a
        // press that began on the splitter or a panel arrives here with no matching
        // down — and with a stale press position that could pass the slop test.
        const pressed = this._pressValid;
        this._pressValid = false;
        this._splitter.endDrag();

        const dragged = this._grabbedAxis !== null;
        this._handles.endDrag();
        this._grabbedAxis = null;
        // A release that ended a handle drag must not re-pick under the cursor.
        if (dragged) return;

        // Cocos registers mouseup on window, not just the canvas, so releasing a
        // click on a panel lands here too. Without this, clicking a hierarchy row
        // would also fire a pick at that screen position.
        if (!pressed || this._overlay.cursorInside || this._splitter.dragging) return;
        if (!this.enablePicking) return;

        const x = e.getLocationX();
        const y = e.getLocationY();
        if (!isInsideViewport(this._sceneCamera, x)) return;
        // Ignore drags - only a clean click changes the selection.
        if (Math.abs(x - this._pressX) > CLICK_SLOP || Math.abs(y - this._pressY) > CLICK_SLOP) return;

        this.select(this._pickAt(x, y));
    }

    /**
     * Resolve a click to a node, meshes and UI together.
     *
     * UI wins ties rather than being sorted by distance with the meshes. A
     * screen-space element sits wherever its canvas happens to be in the world,
     * which says nothing about what the eye sees in front: the UI you can see is
     * always the thing drawn last.
     */
    private _pickAt (x: number, y: number): Node | null {
        const ui = this.enableUIPicking
            ? pickUI(this._sceneCamera, x, y, this._uiElements)
            : null;
        if (ui) return ui.element.node;

        const hit = pickRenderer(this._sceneCamera, x, y, this._renderers);
        return hit ? hit.renderer.node : null;
    }

    private _onKeyDown (e: EventKeyboard) {
        switch (e.keyCode) {
        case KeyCode.F1:
            this.toggle();
            break;
        case KeyCode.KEY_F:
            if (this._active) this.focusSelection();
            break;
        case KeyCode.ESCAPE:
            if (this._active) this.select(null);
            break;
        // Digits rather than Unity's W/E/R: WASD flies the camera here at all times,
        // whereas Unity only enables it while the right button is held.
        case KeyCode.DIGIT_1:
            this._setGizmoMode('move');
            break;
        case KeyCode.DIGIT_2:
            this._setGizmoMode('rotate');
            break;
        case KeyCode.DIGIT_3:
            this._setGizmoMode('scale');
            break;
        case KeyCode.DIGIT_4:
            this._setGizmoMode('view');
            break;
        default:
            break;
        }
    }

    /**
     * One-shot dump of every coordinate space involved, plus whatever element is
     * actually on top at the divider.
     *
     * The editor Preview panel and a browser disagree about these numbers, and the
     * disagreement is invisible from the outside: clicks simply stop landing. This
     * prints the facts instead of leaving it to guesswork.
     */
    private _logInputDiagnostics () {
        const internal = this._sceneCamera?.camera as any;
        const canvas = game.canvas as HTMLCanvasElement;
        const rect = canvas?.getBoundingClientRect?.();

        console.log('[SceneView] observer camera:', {
            nodeActive: this._sceneCamera?.node.activeInHierarchy,
            componentEnabled: this._sceneCamera?.enabled,
            hasRendererCamera: !!internal,
            rendererEnabled: internal?.enabled,
            gizmos: !!this._gizmos,
            rect: this._sceneCamera ? `${this._sceneCamera.rect.x},${this._sceneCamera.rect.width}` : 'none',
        });

        console.log('[SceneView] input spaces:', {
            cameraWidth: internal?.width,
            cameraHeight: internal?.height,
            cameraRectX: this._sceneCamera?.rect.x,
            viewportMinX: viewportMinX(this._sceneCamera),
            windowSize: `${screen.windowSize.width}x${screen.windowSize.height}`,
            devicePixelRatio: screen.devicePixelRatio,
            canvasBacking: canvas ? `${canvas.width}x${canvas.height}` : 'none',
            canvasCss: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : 'none',
        });

        if (typeof document === 'undefined' || !rect) return;
        // If anything other than our splitter answers here, that element is eating
        // the pointer events and the splitter can never be grabbed.
        const x = rect.left + rect.width * this._split;
        const y = rect.top + rect.height * 0.5;
        const top = document.elementFromPoint(x, y) as HTMLElement | null;
        console.log('[SceneView] topmost element at the divider:',
            top ? `${top.tagName.toLowerCase()}.${top.className || '(no class)'}` : 'none');
    }

    /** Right-drag is the look control, so the browser menu has to stay out of the way. */
    private _suppressContextMenu () {
        const canvas = game.canvas as HTMLCanvasElement;
        canvas?.addEventListener?.('contextmenu', (e) => e.preventDefault());
    }

    private _showHint () {
        if (typeof document === 'undefined' || this._hint) return;
        ensureStyles();
        const el = document.createElement('div');
        el.className = 'sv-hint';
        document.body.appendChild(el);
        this._hint = el;
        this._updateHint();
    }

    private _updateHint () {
        if (!this._hint) return;
        const tool = this.enableTransformGizmo
            ? `tool ${this._handles.mode.toUpperCase()} (1 move / 2 rotate / 3 scale / 4 none) | `
            : '';
        this._hint.textContent = `SCENE VIEW - ${tool}LMB select | F focus | Esc deselect`
            + ' | RMB look | WASD move | Q/E down/up | MMB pan | wheel dolly | Shift fast | F1 close';
    }

    private _hideHint () {
        this._hint?.remove();
        this._hint = null;
    }
}

/** Depth-first search for a node by uuid, used to resolve an editor selection. */
function findByUuid (root: Node, uuid: string): Node | null {
    if (!root || !root.isValid) return null;
    if (root.uuid === uuid) return root;

    const children = root.children;
    for (let i = 0; i < children.length; i++) {
        const found = findByUuid(children[i], uuid);
        if (found) return found;
    }
    return null;
}
