import {
    CCObject, Camera, Color, Component, Director, EventKeyboard, EventMouse, Game, Input, KeyCode, Layers,
    screen,
    ModelRenderer, Node, Rect, UIRenderer, UITransform, Vec3, _decorator, director, game, geometry, input,
} from 'cc';
import { DEBUG, EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { CanvasWatcher } from './CanvasWatcher';
import { DebugOverlay, ensureStyles } from './DebugOverlay';
import { EditorBridge } from './EditorBridge';
import { HelpPanel, HelpToggle } from './HelpPanel';
import { Axis, GizmoMode, TransformGizmo } from './TransformGizmo';
import { ToolPalette } from './ToolPalette';
import { ViewSplitter } from './ViewSplitter';
import { FreeCamera } from './FreeCamera';
import { HierarchyPanel } from './HierarchyPanel';
import { InputProbe } from './InputProbe';
import { InspectorPanel } from './InspectorPanel';
import { GeometryRenderer, drawBounds, drawFrustum, drawGrid, drawSelection, drawUIBounds, drawWorldAxes } from './SceneGizmos';
import { subtreeBounds } from './ModelAccess';
import { cameraPixelSize, isInsideViewport, pickRenderer, pickUI, viewportMinX } from './ScenePicker';
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

/** Two clicks on the same node within this window are a double-click. */
const DOUBLE_CLICK_MS = 400;

/** How often the editor Hierarchy selection is read, in seconds. */
const SELECTION_POLL_SECONDS = 0.15;

/** After we change the editor selection, how long its answer is not to be trusted. */
const OWN_SELECT_GRACE_MS = 400;

/** How quickly the camera glides to a focus target. Higher is snappier. */
const FOCUS_SPEED = 12;

const _focusBox = geometry.AABB.create();
const _focusStep = new Vec3();

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
 * The editor's own scaffolding, which is never content. UI picking and the DOM
 * Hierarchy both want the UI layers but not these. The Preview panel shares its scene graph with the
 * editor, so nodes like internal/editor/grid-2d are present at runtime, and an
 * unfiltered scan would hand their huge boxes to the ray.
 */
const EDITOR_LAYERS = Layers.Enum.GIZMOS
    | Layers.Enum.EDITOR
    | Layers.Enum.SCENE_GIZMO
    | Layers.Enum.PROFILER;

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

    @property({ tooltip: 'Draw a wireframe AABB around every mesh and 3D sprite.' })
    public showBounds = true;

    @property({ tooltip: 'Draw the frustum of the selected camera, so you can see what '
        + 'the player would see. Only while a camera is selected, like Unity.' })
    public showFrustum = true;

    @property({ tooltip: 'Draw every game camera frustum all the time. Off by default: '
        + 'they are huge, and the UI camera adds a box the size of the design resolution, '
        + 'so together they bury the scene and make things hard to aim at.' })
    public showAllFrustums = false;

    @property({ tooltip: 'Draw the ground grid.' })
    public showGrid = true;

    @property({ tooltip: 'Draw the world-origin axis cross. Off by default: it sits on '
        + 'top of whatever is at the origin and gets in the way.' })
    public showWorldAxes = false;

    @property({ tooltip: 'Render the game UI in the scene viewport. On by default; press U to toggle it live. The catch: the engine hit-tests UI against EVERY camera that can see its layer and ignores depth, so a click in the scene viewport could be taken as a click on the game UI and fire its buttons. UI is also drawn without depth testing, so a design-resolution canvas can paint over the whole scene. If the game starts reacting to scene-view clicks, turn this off.' })
    public showUI = true;

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

    @property({ tooltip: 'Fly the scene camera to a node as soon as it is selected in the editor Hierarchy. On by default; press G to toggle it live. The editor sends this process no selection events, so a double-click in the Hierarchy cannot be detected; this follows the selection instead.' })
    public focusOnEditorSelect = true;


    @property({ tooltip: 'Show the built-in Hierarchy and Inspector panels. On by default, but only in a browser: inside the editor Preview the editor has its own, and these could not be clicked there anyway. Press P to toggle them live.' })
    public showPanels = true;

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
    private _renderers: ModelRenderer[] = [];
    private _uiElements: UIRenderer[] = [];
    private _selected: Node = null;
    private _rescanTimer = 0;
    private _active = false;
    private _help = new HelpPanel();
    private _watcher = new CanvasWatcher();
    private _panelsOn = false;
    private _warnedNoGizmos = false;
    private _lastClickNode: Node = null;
    private _lastClickTime = 0;
    private _selectionTimer = 0;
    private _pausedLoop = 0;
    private _lastFrameMs = 0;
    private _selectionSynced = false;
    private _ownSelectAt = 0;
    private _focusGoal: Vec3 = null;
    private _focusSpan = 0;
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
            onFocus: (node) => {
                this.select(node);
                this.focusSelection();
            },
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
        this._frame(dt);
    }

    /**
     * One frame of the scene view.
     *
     * Normally the engine calls this through update(). It does not while the game
     * is paused, so _onBeforeDraw and the paused loop below call it instead. Exactly
     * one of the three drives any given frame.
     */
    private _frame (dt: number) {
        if (!this._active) return;

        this._freeCamera.update(dt);
        this._stepFocus(dt);
        // Selections made in the editor Hierarchy arrive by polling. That runs more
        // often than the scene rescan so following a selection feels immediate.
        this._selectionTimer -= dt;
        if (this._selectionTimer <= 0 && this._bridge.available) {
            this._selectionTimer = SELECTION_POLL_SECONDS;
            this._pullEditorSelection();
        }

        this._rescanTimer -= dt;
        if (this._rescanTimer <= 0) {
            this._rescanTimer = this.rescanInterval;
            try {
                this._rescan();
            } catch (error) {
                this._warnOnce('rescan', `[SceneView] scene scan failed: ${error}`);
            }
            if (this._panelsOn) {
                this._hierarchy.refresh(director.getScene().children, EDITOR_LAYERS, this._sceneCamera?.node);
            }
            this._syncWidgets();
        }

        // Gameplay can destroy the selected node at any moment.
        if (this._selected && !this._selected.isValid) this.select(null);
        if (this._panelsOn) this._inspector.sync();

        // Kept above the gizmo-renderer guard: hit-testing uses the handle size
        // computed here, so it must stay current even when nothing can be drawn.
        if (this.enableTransformGizmo) this._handles.sync(this._sceneCamera, this._selected);

        if (!this._gizmos && !this._initGizmos()) return;
        if (this.showGrid) drawGrid(this._gizmos);
        if (this.showWorldAxes) drawWorldAxes(this._gizmos);
        if (this.showBounds) drawBounds(this._gizmos, this._renderers, BOUNDS_COLOR);
        // Outlines stand in for UI the observer cannot draw. With the UI actually
        // rendered they would only be clutter on top of it; the selection highlight
        // still shows which element is picked.
        if (this.enableUIPicking && !this.showUI) {
            drawUIBounds(this._gizmos, this._uiElements, UI_BOUNDS_COLOR);
        }
        this._drawFrustums();
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
        this._updateHint();

        // Drive the editor's own Hierarchy and Inspector. Reverse sync compares
        // uuids, so echoing our own selection back is a no-op, not a loop.
        if (!this._bridge.available) return;
        this._ownSelectAt = Date.now();
        if (this._selected) this._bridge.select(this._selected.uuid);
        else this._bridge.clear();
    }

    /** Follow a selection made in the editor's Hierarchy panel. */
    private _pullEditorSelection () {
        // Just after we changed the editor's selection ourselves, what it reports may
        // still be the previous node. Adopting that would flip the selection back and,
        // with following on, send the camera to the wrong place.
        if (Date.now() - this._ownSelectAt < OWN_SELECT_GRACE_MS) return;

        const uuid = this._bridge.currentSelection();
        // The first read only brings us in line with whatever was already selected
        // when the view opened. Flying there on start-up would make the camera jump
        // before the user has done anything.
        const firstRead = !this._selectionSynced;
        this._selectionSynced = true;

        if (!uuid || uuid === this._selected?.uuid) return;

        const node = findByUuid(director.getScene(), uuid);
        if (node && node !== this._selected) {
            this._selected = node;
            this._hierarchy.setSelected(node);
            this._inspector.show(node);
            if (this.focusOnEditorSelect && !firstRead) this.focusSelection();
        }
    }

    public open () {
        if (this._active) return;
        this._active = true;
        this._selectionSynced = false;

        this._splitGameCameras();
        this._ensureSceneCamera();

        this._applyPanels();
        // Every widget is driven by engine input now, so these listeners are what
        // makes the divider and the tool strip clickable, not just picking.
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);

        // Keep the viewport alive while the game is paused. See the pause section.
        director.on(Director.EVENT_BEFORE_DRAW, this._onBeforeDraw, this);
        game.on(Game.EVENT_PAUSE, this._onGamePause, this);
        game.on(Game.EVENT_RESUME, this._onGameResume, this);
        if (game.isPaused()) this._startPausedLoop();

        // Scanning the scene runs after the listeners are live, and never before.
        // It used to come first, so one throw in here left the view rendering with
        // no input at all - which looks like picking is broken, not like a crash.
        this._rescan();

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
        this._mountHelp();
        // Everything placed from the canvas rect follows it when a device is chosen,
        // rotated or the window changes.
        this._watcher.start(() => this._syncWidgets());
    }

    public close () {
        if (!this._active) return;
        this._active = false;

        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);
        director.off(Director.EVENT_BEFORE_DRAW, this._onBeforeDraw, this);
        game.off(Game.EVENT_PAUSE, this._onGamePause, this);
        game.off(Game.EVENT_RESUME, this._onGameResume, this);
        this._stopPausedLoop();


        this._probe.uninstall();
        this._focusGoal = null;
        this._handles.endDrag();
        this._grabbedAxis = null;
        this._freeCamera?.detach();
        this._freeCamera = null;
        this._gizmos = null;
        this._selected = null;

        // Put every renderer this tool switched off back the way it was.
        this._visibility.restoreAll();
        this._unmountPanels();

        // Deactivated, not destroyed: see _ensureSceneCamera. The reference is kept
        // so _splitGameCameras can still recognise and skip it on the next open.
        if (this._sceneCamera && this._sceneCamera.isValid) this._sceneCamera.node.active = false;

        for (const [camera, rect] of this._savedRects) {
            if (camera.isValid) camera.rect = rect;
        }
        this._savedRects.clear();
        this._renderers.length = 0;
        this._watcher.stop();
        this._help.unmount();
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

        const camera = this._sceneCamera;
        const bounds = subtreeBounds(this._selected, _focusBox);

        // Frame the centre of what the node contains, not its pivot. A node's origin
        // is often a corner or the floor, nowhere near the middle of its content.
        const target = bounds
            ? Vec3.copy(new Vec3(), bounds.center)
            : this._selected.getWorldPosition(new Vec3());
        // Bounding-sphere radius, so a flat element as wide as a canvas still counts.
        const radius = bounds ? Math.max(bounds.halfExtents.length(), 0.5) : 1;

        // Fit against the narrower of the two field-of-view angles, or a tall object
        // in a wide viewport - or the reverse - would spill out of frame.
        const size = cameraPixelSize(camera);
        const aspect = (size.width * camera.rect.width) / Math.max(size.height * camera.rect.height, 1);
        const tanHalfVertical = Math.tan((camera.fov * Math.PI / 180) / 2);
        const halfAngle = Math.atan(Math.min(tanHalfVertical, tanHalfVertical * aspect));
        const distance = Math.max(radius / Math.sin(halfAngle) * 1.15, camera.near * 4);

        // A canvas-sized target can sit farther away than the far plane allows.
        if (distance * 2 > camera.far) camera.far = distance * 2;

        // Keep the viewing direction and slide back along it: that centres the
        // target without turning the camera, which is how Unity's frame behaves.
        const goal = new Vec3();
        Vec3.scaleAndAdd(goal, target, camera.node.forward, -distance);
        this._focusGoal = goal;
        this._focusSpan = Vec3.distance(camera.node.position, goal);
    }

    /** Glide towards the focus goal instead of cutting to it, as Unity does. */
    private _stepFocus (dt: number) {
        const goal = this._focusGoal;
        if (!goal || !this._sceneCamera) return;

        const node = this._sceneCamera.node;
        // Frame-rate independent exponential approach.
        Vec3.lerp(_focusStep, node.position, goal, 1 - Math.exp(-dt * FOCUS_SPEED));

        if (Vec3.distance(_focusStep, goal) < 0.01 + this._focusSpan * 0.002) {
            node.setPosition(goal);
            this._focusGoal = null;
        } else {
            node.setPosition(_focusStep);
        }
    }

    // --- pause --------------------------------------------------------------

    /**
     * There are two kinds of pause, and they need different handling.
     *
     * director.pause() skips component updates but keeps rendering, so update()
     * goes quiet while frames continue: _onBeforeDraw covers that.
     *
     * game.pause() is what the Preview Pause button calls. It stops the main loop
     * outright - no update, no render, no frame at all - so the viewport would
     * freeze along with the game. The paused loop below renders on its own instead:
     * it runs the scene view and redraws the scene, and leaves game logic alone.
     * That is why it calls Root.frameMove directly rather than director.tick, which
     * would also run every component's update and un-pause the game's behaviour.
     */
    private _frameDelta (): number {
        const now = performance.now();
        // Clamped so a long stall, or the first frame after a resume, is not a leap.
        const dt = Math.min(Math.max((now - this._lastFrameMs) / 1000, 0), 0.1);
        this._lastFrameMs = now;
        return dt;
    }

    private _onBeforeDraw () {
        // While the director is running, update() already drove this frame.
        if (this._active && director.isPaused()) this._frame(this._frameDelta());
    }

    private _onGamePause () {
        if (this._active) this._startPausedLoop();
    }

    private _onGameResume () {
        this._stopPausedLoop();
    }

    private _startPausedLoop () {
        if (this._pausedLoop || typeof requestAnimationFrame === 'undefined') return;

        this._lastFrameMs = performance.now();
        if (this.debugInput) console.log('[SceneView] game paused - scene view keeps rendering');

        const step = () => {
            if (!this._active || !game.isPaused()) {
                this._pausedLoop = 0;
                return;
            }
            try {
                const dt = this._frameDelta();
                this._frame(dt);
                director.root?.frameMove(dt);
            } catch (error) {
                this._warnOnce('paused-loop', `[SceneView] paused render failed: ${error}`);
            }
            this._pausedLoop = requestAnimationFrame(step);
        };
        this._pausedLoop = requestAnimationFrame(step);
    }

    private _stopPausedLoop () {
        if (!this._pausedLoop) return;
        cancelAnimationFrame(this._pausedLoop);
        this._pausedLoop = 0;
    }

    /**
     * Turn click logging on or off, live.
     *
     * debugInput is a property, and under AutoBoot the node that holds it is
     * hidden, so without a key there would be no way to ask for diagnostics.
     */
    public toggleDebug () {
        this.debugInput = !this.debugInput;
        console.log(`[SceneView] debug logging ${this.debugInput ? 'ON' : 'OFF'} - ${this._bridge.describe()}`);
        this._updateHint();
    }

    /**
     * Fly to whatever is selected in the editor's Hierarchy as soon as it changes.
     *
     * This is the only way to frame a Hierarchy selection, because the editor sends
     * this process no selection events at all - a listener on selection:select
     * registered fine and then saw nothing, even for clicks on different nodes - so
     * a double-click there cannot be told apart. Following the selection is a
     * single click rather than a double, which is why it is a mode you switch on.
     * It is a key because, under AutoBoot, no property can be set from the Inspector.
     */
    public toggleFollow () {
        this.focusOnEditorSelect = !this.focusOnEditorSelect;
        console.log(`[SceneView] following Hierarchy selection ${this.focusOnEditorSelect ? 'ON' : 'OFF'}`);
        this._updateHint();
    }

    /** Show or hide the game UI in the scene viewport, live. See showUI for the catch. */
    public toggleUI () {
        this.showUI = !this.showUI;
        if (this._sceneCamera) this._sceneCamera.visibility = this._observerVisibility();
        try {
            this._rescan();
        } catch (error) {
            this._warnOnce('rescan', `[SceneView] scene scan failed: ${error}`);
        }
        console.log(`[SceneView] UI rendering ${this.showUI ? 'ON' : 'OFF'}`);
        this._updateHint();
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
        camera.visibility = this._observerVisibility();
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

    /**
     * Frustums are contextual. A camera only shows its frustum while it is the
     * selection, which is how Unity treats them: drawn for every camera at once
     * they bury the scene, and an orthographic UI camera contributes a box the
     * size of the whole canvas.
     */
    private _drawFrustums () {
        if (!this._gizmos) return;

        if (this.showAllFrustums) {
            for (const camera of this._savedRects.keys()) {
                if (camera.isValid && camera.enabledInHierarchy) drawFrustum(this._gizmos, camera, FRUSTUM_COLOR);
            }
            return;
        }

        if (!this.showFrustum || !this._selected || !this._selected.isValid) return;
        const camera = this._selected.getComponent(Camera);
        // Never the observer camera itself: it is hidden, but be explicit.
        if (camera && camera !== this._sceneCamera && camera.enabledInHierarchy) {
            drawFrustum(this._gizmos, camera, FRUSTUM_COLOR);
        }
    }

    /**
     * What the observer camera renders and what picking may consider.
     *
     * UI layers are opt-in (see showUI). Keeping camera and picker on the same mask
     * means a mesh on a UI layer is pickable exactly when it is visible.
     */
    private _observerVisibility (): number {
        return this.showUI
            ? SCENE_VISIBILITY | Layers.Enum.UI_2D | Layers.Enum.UI_3D
            : SCENE_VISIBILITY;
    }

    /** Log a given problem once, not every rescan - this runs twice a second. */
    private _warned = new Set<string>();
    private _warnOnce (key: string, message: string) {
        if (this._warned.has(key)) return;
        this._warned.add(key);
        console.warn(message);
    }

    /** Re-anchor the widgets to the camera. Cheap, so it also tracks canvas resizes. */
    private _syncWidgets () {
        this._splitter.sync(this._sceneCamera, this._split);
        this._palette.sync(this._sceneCamera, this._split);
        this._help.sync(this._sceneCamera, this._split);
        // Keeps each panel inside the free margin beside the canvas as it moves.
        this._overlay.layout();
    }

    private _rescan () {
        const all = director.getScene().getComponentsInChildren(ModelRenderer);
        const own = this._sceneCamera ? this._sceneCamera.node : null;
        // Same mask the camera renders with, so bounds and picking can never target
        // something the viewport does not even draw (editor gizmos, UI, profiler).
        this._renderers = all.filter((r) => r.node !== own && (r.node.layer & this._observerVisibility()) !== 0);

        // UI is gathered on its own: it is picked through UITransform, not a model.
        // rather than filtered by the same mask.
        this._uiElements = [];
        if (!this.enableUIPicking) return;

        // UIRenderer is undefined when the UI engine module is cropped out, and
        // getComponentsInChildren dereferences the constructor without checking,
        // so asking for it would throw rather than return nothing.
        if (!UIRenderer) {
            this._warnOnce('ui-module', '[SceneView] UI module not in this build - UI picking off.');
            return;
        }

        try {
            this._uiElements = director.getScene().getComponentsInChildren(UIRenderer)
                .filter((element) => (element.node.layer & EDITOR_LAYERS) === 0);
        } catch (error) {
            this._warnOnce('ui-scan', `[SceneView] could not scan UI: ${error}`);
        }
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
        if (this._overUI() || !isInsideViewport(this._sceneCamera, x)) return;

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
        } else if (this._overUI() || !isInsideViewport(this._sceneCamera, x)) {
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

        const x = e.getLocationX();
        const y = e.getLocationY();
        const moved = Math.abs(x - this._pressX) > CLICK_SLOP || Math.abs(y - this._pressY) > CLICK_SLOP;

        // A release that ended a real handle drag must not re-pick under the cursor.
        //
        // A press on a handle that never moved is another matter. The handles are
        // drawn from the object's pivot, so the second click of a double-click on the
        // middle of an already-selected object lands on them. Treating that as a
        // drag swallowed the click, and double-click could never register.
        if (dragged && moved) return;

        // Cocos registers mouseup on window, not just the canvas, so releasing a
        // click on a panel lands here too. Without this, clicking a hierarchy row
        // would also fire a pick at that screen position.
        if (!pressed || this._overUI() || this._splitter.dragging) return;
        if (!this.enablePicking) return;
        if (!isInsideViewport(this._sceneCamera, x)) return;
        // Ignore drags - only a clean click changes the selection.
        if (moved) return;

        const picked = this._pickAt(x, y);

        // A click that only landed on a handle keeps the selection unless the ray
        // also hit the selected object, so touching a handle tip over empty space
        // does not deselect it.
        if (dragged && picked !== this._selected) return;
        this.select(picked);

        // Two clicks that resolve to the same node are a double-click: fly to it.
        // Comparing the resolved node, not the raw position, lets the cursor drift
        // between clicks without losing the gesture.
        const now = Date.now();
        const isDouble = picked !== null
            && picked === this._lastClickNode
            && now - this._lastClickTime <= DOUBLE_CLICK_MS;
        if (isDouble) {
            this.focusSelection();
            this._lastClickNode = null;
        } else {
            this._lastClickNode = picked;
            this._lastClickTime = now;
        }
    }

    /**
     * Resolve a click to a node, meshes first and UI as the fallback.
     *
     * A mesh hit is exact, down to the triangle. A screen-space canvas is sized
     * in design-resolution units, so its boxes are enormous next to a 1-unit
     * mesh and a full-screen background sprite would otherwise answer every
     * click in the viewport. Meshes are therefore preferred, and UI takes over
     * where no mesh is under the cursor.
     */
    private _pickAt (x: number, y: number): Node | null {
        const report = (kind: string, node: Node | null) => {
            if (this.debugInput) {
                console.log('[SceneView] click ' + Math.round(x) + ',' + Math.round(y)
                    + ' -> ' + kind + ': ' + (node ? node.name : 'nothing')
                    + '  (' + this._renderers.length + ' meshes, ' + this._uiElements.length + ' ui)');
            }
            return node;
        };

        // An exception out of a mouse callback is swallowed by the engine, and to
        // the user it is indistinguishable from "picking does nothing".
        try {
            const hit = pickRenderer(this._sceneCamera, x, y, this._renderers);
            if (hit) return report('mesh', hit.renderer.node);

            if (this.enableUIPicking) {
                const ui = pickUI(this._sceneCamera, x, y, this._uiElements);
                if (ui) return report('ui', ui.element.node);
            }
            return report('none', null);
        } catch (error) {
            console.error('[SceneView] pick failed:', error);
            return null;
        }
    }
    private _onKeyDown (e: EventKeyboard) {
        switch (e.keyCode) {
        case KeyCode.F1:
            this.toggle();
            break;
        case KeyCode.KEY_F:
            if (this._active) this.focusSelection();
            break;
        case KeyCode.KEY_U:
            if (this._active) this.toggleUI();
            break;
        case KeyCode.KEY_H:
            if (this._active) this.toggleHelp();
            break;
        case KeyCode.KEY_P:
            if (this._active) this.togglePanels();
            break;
        case KeyCode.KEY_G:
            if (this._active) this.toggleFollow();
            break;
        case KeyCode.KEY_I:
            if (this._active) this.toggleDebug();
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

        console.log('[SceneView] scene contents:', {
            meshRenderers: this._renderers.length,
            uiElements: this._uiElements.length,
            uiPicking: this.enableUIPicking,
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

    // --- panels and help ----------------------------------------------------

    /**
     * The DOM Hierarchy and Inspector are for the browser. The editor Preview has the
     * editor's own, which work, and the DOM ones could not be clicked there anyway
     * because the editor delivers no DOM events to the page.
     */
    private _panelsWanted (): boolean {
        return this.showPanels && this._overlay.available && !this._bridge.hasEditor;
    }

    private _applyPanels () {
        const want = this._panelsWanted();
        if (want === this._panelsOn) return;

        if (!want) {
            this._unmountPanels();
            return;
        }

        this._panelsOn = true;
        this._overlay.mount();
        this._hierarchy.mount(this._overlay);
        this._inspector.mount(this._overlay);
        this._hierarchy.setSelected(this._selected);
        this._inspector.show(this._selected);
        this._hierarchy.refresh(director.getScene().children, EDITOR_LAYERS, this._sceneCamera?.node);
    }

    private _unmountPanels () {
        this._panelsOn = false;
        this._inspector.unmount();
        this._hierarchy.unmount();
        this._overlay.unmount();
    }

    /** Show or hide the DOM Hierarchy and Inspector, live. */
    public togglePanels () {
        this.showPanels = !this.showPanels;
        this._applyPanels();
        this._updateHint();
    }

    public toggleHelp () {
        this._help.toggle();
    }

    /** True while the pointer is over any DOM overlay: it must not reach the scene underneath. */
    private _overUI (): boolean {
        return this._overlay.cursorInside || this._help.cursorInside;
    }

    private _mountHelp () {
        if (!this._overlay.available) return;

        this._help.toggles = this._helpToggles();
        this._help.status = () => this._statusLine();
        // Clicking DOM takes keyboard focus off the canvas, and keys only reach the
        // engine from the canvas, so hand it back.
        this._help.onInteract = () => (game.canvas as HTMLCanvasElement)?.focus?.();
        this._help.mount(!this._bridge.hasEditor);
        this._help.sync(this._sceneCamera, this._split);
    }

    private _helpToggles (): HelpToggle[] {
        const toggles: HelpToggle[] = [
            {
                label: 'Game UI',
                key: 'U',
                get: () => this.showUI,
                set: (on) => { if (on !== this.showUI) this.toggleUI(); },
            },
            {
                label: 'Follow Hierarchy selection',
                key: 'G',
                get: () => this.focusOnEditorSelect,
                set: (on) => { this.focusOnEditorSelect = on; },
            },
        ];

        // Only meaningful where the DOM panels are used at all.
        if (!this._bridge.hasEditor) {
            toggles.push({
                label: 'Hierarchy and Inspector',
                key: 'P',
                get: () => this.showPanels,
                set: (on) => { if (on !== this.showPanels) this.togglePanels(); },
            });
        }

        toggles.push(
            { label: 'Grid', key: '', get: () => this.showGrid, set: (on) => { this.showGrid = on; } },
            { label: 'Bounding boxes', key: '', get: () => this.showBounds, set: (on) => { this.showBounds = on; } },
            { label: 'Selected camera frustum', key: '', get: () => this.showFrustum, set: (on) => { this.showFrustum = on; } },
            { label: 'World axes', key: '', get: () => this.showWorldAxes, set: (on) => { this.showWorldAxes = on; } },
            {
                label: 'Debug logging',
                key: 'I',
                get: () => this.debugInput,
                set: (on) => { if (on !== this.debugInput) this.toggleDebug(); },
            },
        );
        return toggles;
    }

    private _statusLine (): string {
        const tool = this.enableTransformGizmo ? `Tool: ${this._handles.mode.toUpperCase()}   ` : '';
        return `${tool}Selected: ${this._selected ? this._selected.name : 'none'}`;
    }

    /** Bring the help panel's switches and status line in step with the real state. */
    private _updateHint () {
        this._help.refresh();
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
