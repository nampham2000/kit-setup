import { _decorator, Camera, Component, director, gfx, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/** Unity LineRenderer settings the porter serializes (line-renderer-binding.js). */
export interface UnityLineRendererContract {
    /** Unity Gradient keys: time 0..1 (Unity ctime/65535), color rgba 0..1 as authored. */
    colorKeys: { time: number; r: number; g: number; b: number }[];
    alphaKeys: { time: number; a: number }[];
    widthMultiplier: number;
    widthKeys: { time: number; value: number }[];
    /** 0 Stretch (u spans the whole line), 1 Tile (u in width units), 2 DistributePerSegment, 3 RepeatPerSegment. */
    textureMode: number;
    /** 0 View, 1 TransformZ. */
    alignment: number;
    numCapVertices: number;
    numCornerVertices: number;
    loop: boolean;
    useWorldSpace: boolean;
}

const MAX_POINTS = 64;
const segment = new Vec3(), toCamera = new Vec3(), side = new Vec3(), world = new Vec3(), prev = new Vec3(), next = new Vec3(), axisZ = new Vec3();
/** sampleKeys output: [index a, index b, fraction]; module scratch keeps lateUpdate allocation-free. */
const sample = { a: 0, b: 0, t: 0 };

function sampleKeys(keys: { time: number }[], t: number): void {
    sample.a = sample.b = keys.length - 1;
    sample.t = 0;
    if (keys.length === 1) { sample.a = sample.b = 0; return; }
    for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i].time) {
            const a = keys[i - 1], b = keys[i];
            sample.a = i - 1; sample.b = i;
            sample.t = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0;
            return;
        }
    }
}

/**
 * Unity LineRenderer as a quad strip on a child node at world origin: the strip is rebuilt in
 * world space each frame through a dynamic mesh, so `setPosition` (Hovl_Laser writes positions
 * 0/1 every Update) needs no mesh reallocation. View alignment faces the camera; TransformZ
 * spreads the width along cross(segment, transform Z). Width follows widthCurve *
 * widthMultiplier over the normalized line length; color follows the gradient; UVs follow
 * textureMode (Stretch: u 0..1 along the line). Corner/cap vertices are not generated.
 * The strip is hidden while this component (or its node) is disabled.
 */
@ccclass('UnityLineRenderer')
export class UnityLineRenderer extends Component {
    @property({ type: Material }) material: Material | null = null;
    @property sourceContract = '';
    @property({ type: [Vec3] }) positions: Vec3[] = [];

    private contract: UnityLineRendererContract | null = null;
    private mesh: Mesh | null = null;
    private renderer: MeshRenderer | null = null;
    private child: Node | null = null;
    private camera: Camera | null = null;
    private readonly worldPoints: Vec3[] = Array.from({ length: MAX_POINTS }, () => new Vec3());
    private readonly cumulative = new Float32Array(MAX_POINTS);
    private readonly _positions = new Float32Array(MAX_POINTS * 2 * 3);
    private readonly _uvs = new Float32Array(MAX_POINTS * 2 * 2);
    private readonly _colors = new Float32Array(MAX_POINTS * 2 * 4);
    private readonly _normals = new Float32Array(MAX_POINTS * 2 * 3);
    private readonly _indices = new Uint16Array((MAX_POINTS - 1) * 6);
    /** Geometry views per point count, built once (lines keep a fixed count in practice). */
    private readonly views = new Map<number, primitives.IDynamicGeometry>();
    private visible = true;

    /** Unity LineRenderer.enabled: the strip stays allocated, only drawing stops. */
    setVisible(visible: boolean): void {
        this.visible = visible;
        this.syncRenderer();
    }

    get visibleState(): boolean { return this.visible; }

    /** Unity `Renderer.material`: the per-renderer material instance (scripts set texture scale/offset on it). */
    get materialInstance(): Material | null {
        return this.renderer ? this.renderer.material : null;
    }

    /** Unity LineRenderer.SetPosition; local or world per useWorldSpace. Indices past the strip capacity are ignored. */
    setPosition(index: number, value: Vec3): void {
        if (index < 0 || index >= MAX_POINTS) return;
        while (this.positions.length <= index) this.positions.push(new Vec3());
        this.positions[index].set(value);
    }

    protected onLoad(): void {
        this.contract = JSON.parse(this.sourceContract || '{}') as UnityLineRendererContract;
        const c = this.contract;
        c.colorKeys = c.colorKeys?.length ? c.colorKeys : [{ time: 0, r: 1, g: 1, b: 1 }];
        c.alphaKeys = c.alphaKeys?.length ? c.alphaKeys : [{ time: 0, a: 1 }];
        c.widthKeys = c.widthKeys?.length ? c.widthKeys : [{ time: 0, value: 1 }];
        this.child = new Node(`${this.node.name} line`);
        this.child.layer = this.node.layer;
        this.node.scene.addChild(this.child);
        this.child.setWorldPosition(0, 0, 0);
        this.mesh = utils.MeshUtils.createDynamicMesh(0, { positions: this._positions, uvs: this._uvs, colors: this._colors, normals: this._normals, indices16: this._indices, primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST },
            undefined, { maxSubMeshes: 1, maxSubMeshVertices: MAX_POINTS * 2, maxSubMeshIndices: (MAX_POINTS - 1) * 6 });
        this.renderer = this.child.addComponent(MeshRenderer);
        this.renderer.mesh = this.mesh;
        if (this.material) this.renderer.setSharedMaterial(this.material, 0);
        this.renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        this.renderer.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
        this.syncRenderer();
    }

    protected onEnable(): void { this.syncRenderer(); }

    protected onDisable(): void { this.syncRenderer(); }

    protected onDestroy(): void {
        this.child?.destroy();
        this.child = null;
        this.mesh?.destroy();
        this.mesh = null;
    }

    private syncRenderer(): void {
        if (this.renderer) this.renderer.enabled = this.visible && this.enabledInHierarchy;
    }

    private geometryFor(count: number, indexCount: number): primitives.IDynamicGeometry {
        let view = this.views.get(count);
        if (!view) {
            view = {
                positions: this._positions.subarray(0, count * 2 * 3), uvs: this._uvs.subarray(0, count * 2 * 2), colors: this._colors.subarray(0, count * 2 * 4),
                normals: this._normals.subarray(0, count * 2 * 3), indices16: this._indices.subarray(0, indexCount),
            };
            this.views.set(count, view);
        }
        return view;
    }

    protected lateUpdate(): void {
        if (!this.mesh || !this.renderer || !this.contract || this.positions.length < 2) return;
        const count = Math.min(this.positions.length, MAX_POINTS);
        const c = this.contract;
        for (let i = 0; i < count; i++) {
            if (c.useWorldSpace) this.worldPoints[i].set(this.positions[i]);
            else Vec3.transformMat4(this.worldPoints[i], this.positions[i], this.node.worldMatrix);
        }
        let length = 0;
        this.cumulative[0] = 0;
        for (let i = 1; i < count; i++) { length += Vec3.distance(this.worldPoints[i], this.worldPoints[i - 1]); this.cumulative[i] = length; }
        const camera = this.activeCamera();
        const cameraPosition = camera ? camera.node.worldPosition : Vec3.ZERO;
        if (c.alignment === 1) {
            const m = this.node.worldMatrix;
            axisZ.set(m.m08, m.m09, m.m10);
        }
        for (let i = 0; i < count; i++) {
            const t = length > 0 ? this.cumulative[i] / length : 0;
            // Tangent: average of adjacent segments, as Unity's strip builder does.
            segment.set(0, 0, 0);
            if (i > 0) { Vec3.subtract(prev, this.worldPoints[i], this.worldPoints[i - 1]); prev.normalize(); Vec3.add(segment, segment, prev); }
            if (i < count - 1) { Vec3.subtract(next, this.worldPoints[i + 1], this.worldPoints[i]); next.normalize(); Vec3.add(segment, segment, next); }
            if (segment.lengthSqr() < 1e-12) segment.set(0, 0, 1); else segment.normalize();
            if (c.alignment === 1) Vec3.cross(side, segment, axisZ); // TransformZ
            else { Vec3.subtract(toCamera, cameraPosition, this.worldPoints[i]); Vec3.cross(side, segment, toCamera); }
            if (side.lengthSqr() < 1e-12) side.set(0, 1, 0); else side.normalize();
            sampleKeys(c.widthKeys, t);
            const wa = c.widthKeys[sample.a].value, wb = c.widthKeys[sample.b].value;
            const halfWidth = 0.5 * c.widthMultiplier * (wa + (wb - wa) * sample.t);
            sampleKeys(c.colorKeys, t);
            const ca = c.colorKeys[sample.a], cb = c.colorKeys[sample.b], ct = sample.t;
            const r = ca.r + (cb.r - ca.r) * ct, g = ca.g + (cb.g - ca.g) * ct, b = ca.b + (cb.b - ca.b) * ct;
            sampleKeys(c.alphaKeys, t);
            const alpha = c.alphaKeys[sample.a].a + (c.alphaKeys[sample.b].a - c.alphaKeys[sample.a].a) * sample.t;
            const u = c.textureMode === 1 ? this.cumulative[i] / Math.max(2 * halfWidth, 1e-5) : t;
            for (let k = 0; k < 2; k++) {
                const v = i * 2 + k;
                Vec3.scaleAndAdd(world, this.worldPoints[i], side, k === 0 ? halfWidth : -halfWidth);
                this._positions[v * 3] = world.x; this._positions[v * 3 + 1] = world.y; this._positions[v * 3 + 2] = world.z;
                this._uvs[v * 2] = u; this._uvs[v * 2 + 1] = k === 0 ? 1 : 0;
                this._colors[v * 4] = r; this._colors[v * 4 + 1] = g; this._colors[v * 4 + 2] = b; this._colors[v * 4 + 3] = alpha;
                Vec3.subtract(toCamera, cameraPosition, world); toCamera.normalize();
                this._normals[v * 3] = toCamera.x; this._normals[v * 3 + 1] = toCamera.y; this._normals[v * 3 + 2] = toCamera.z;
            }
        }
        let n = 0;
        for (let i = 0; i < count - 1; i++) {
            const a = i * 2, b = a + 1, d = a + 2, e = a + 3;
            this._indices[n++] = a; this._indices[n++] = d; this._indices[n++] = b;
            this._indices[n++] = b; this._indices[n++] = d; this._indices[n++] = e;
        }
        this.mesh.updateSubMesh(0, this.geometryFor(count, n));
        this.renderer.onGeometryChanged();
    }

    /** Highest-priority enabled camera, cached until it goes away (no per-frame scene walk). */
    private activeCamera(): Camera | null {
        if (this.camera && this.camera.isValid && this.camera.enabledInHierarchy) return this.camera;
        const scene = director.getScene();
        this.camera = null;
        if (!scene) return null;
        for (const camera of scene.getComponentsInChildren(Camera)) {
            if (!camera.enabledInHierarchy) continue;
            if (!this.camera || camera.priority < this.camera.priority) this.camera = camera;
        }
        return this.camera;
    }
}
