import { _decorator, Camera, Color, Component, director, gfx, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/** Unity LineRenderer settings the porter serializes (particle-line-renderer-binding.js). */
export interface UnityLineRendererContract {
    /** Unity Gradient keys: time 0..1 (Unity ctime/65535), color rgba 0..1 linear-space values as authored. */
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
const segment = new Vec3(), toCamera = new Vec3(), side = new Vec3(), world = new Vec3(), prev = new Vec3(), next = new Vec3();
const tint = new Color();

function sampleKeys<T extends { time: number }>(keys: T[], t: number): [T, T, number] {
    if (keys.length === 1) return [keys[0], keys[0], 0];
    for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i].time) {
            const a = keys[i - 1], b = keys[i];
            return [a, b, b.time > a.time ? (t - a.time) / (b.time - a.time) : 0];
        }
    }
    const last = keys[keys.length - 1];
    return [last, last, 0];
}

/**
 * Unity LineRenderer as a camera-facing quad strip (View alignment) on a child node at
 * world origin: the strip is rebuilt in world space each frame through a dynamic mesh,
 * so `setPositions` (Hovl_Laser writes positions 0/1 every Update) needs no mesh reallocation.
 * Width follows widthCurve * widthMultiplier over the normalized line length; color
 * follows the gradient; UVs follow textureMode (Stretch: u 0..1 along the line).
 * Corner/cap vertices are not generated (the Hovl lasers author 0).
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
    private readonly geometry = {
        positions: new Array<number>(MAX_POINTS * 2 * 3).fill(0),
        uvs: new Array<number>(MAX_POINTS * 2 * 2).fill(0),
        colors: new Array<number>(MAX_POINTS * 2 * 4).fill(1),
        normals: new Array<number>(MAX_POINTS * 2 * 3).fill(0),
        indices: new Array<number>((MAX_POINTS - 1) * 6).fill(0),
    };
    private readonly worldPoints: Vec3[] = Array.from({ length: MAX_POINTS }, () => new Vec3());
    private readonly _positions = new Float32Array(MAX_POINTS * 2 * 3);
    private readonly _uvs = new Float32Array(MAX_POINTS * 2 * 2);
    private readonly _colors = new Float32Array(MAX_POINTS * 2 * 4);
    private readonly _normals = new Float32Array(MAX_POINTS * 2 * 3);
    private readonly _indices = new Uint16Array((MAX_POINTS - 1) * 6);
    private visible = true;

    /** Unity LineRenderer.enabled: the strip stays allocated, only drawing stops. */
    setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.renderer) this.renderer.enabled = visible;
    }

    get visibleState(): boolean { return this.visible; }

    /** Unity `Renderer.material`: the per-renderer material instance (scripts set texture scale/offset on it). */
    get materialInstance(): Material | null {
        return this.renderer ? this.renderer.material : null;
    }

    /** Unity LineRenderer.SetPosition; local or world per useWorldSpace. */
    setPosition(index: number, value: Vec3): void {
        while (this.positions.length <= index && this.positions.length < MAX_POINTS) this.positions.push(new Vec3());
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
        this.mesh = utils.createDynamicMesh(0, { positions: this._positions, uvs: this._uvs, colors: this._colors, normals: this._normals, indices16: this._indices, primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST },
            undefined, { maxSubMeshes: 1, maxSubMeshVertices: MAX_POINTS * 2, maxSubMeshIndices: (MAX_POINTS - 1) * 6 });
        this.renderer = this.child.addComponent(MeshRenderer);
        this.renderer.mesh = this.mesh;
        if (this.material) this.renderer.setSharedMaterial(this.material, 0);
        this.renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        this.renderer.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
        this.renderer.enabled = this.visible;
    }

    protected onDestroy(): void {
        this.child?.destroy();
        this.child = null;
        this.mesh?.destroy();
        this.mesh = null;
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
        const cumulative = [0];
        for (let i = 1; i < count; i++) { length += Vec3.distance(this.worldPoints[i], this.worldPoints[i - 1]); cumulative.push(length); }
        const camera = this.activeCamera();
        const cameraPosition = camera ? camera.node.worldPosition : Vec3.ZERO;
        for (let i = 0; i < count; i++) {
            const t = length > 0 ? cumulative[i] / length : 0;
            // Tangent: average of adjacent segments, as Unity's strip builder does.
            segment.set(0, 0, 0);
            if (i > 0) { Vec3.subtract(prev, this.worldPoints[i], this.worldPoints[i - 1]); prev.normalize(); Vec3.add(segment, segment, prev); }
            if (i < count - 1) { Vec3.subtract(next, this.worldPoints[i + 1], this.worldPoints[i]); next.normalize(); Vec3.add(segment, segment, next); }
            if (segment.lengthSqr() < 1e-12) segment.set(0, 0, 1); else segment.normalize();
            if (c.alignment === 1) side.set(this.node.worldMatrix.m04, this.node.worldMatrix.m05, this.node.worldMatrix.m06); // TransformZ: node up
            else { Vec3.subtract(toCamera, cameraPosition, this.worldPoints[i]); Vec3.cross(side, segment, toCamera); }
            if (side.lengthSqr() < 1e-12) side.set(0, 1, 0); else side.normalize();
            const [wa, wb, wt] = sampleKeys(c.widthKeys, t);
            const halfWidth = 0.5 * c.widthMultiplier * (wa.value + (wb.value - wa.value) * wt);
            const [ca, cb, ct] = sampleKeys(c.colorKeys, t);
            const [aa, ab, at] = sampleKeys(c.alphaKeys, t);
            tint.set(255 * (ca.r + (cb.r - ca.r) * ct), 255 * (ca.g + (cb.g - ca.g) * ct), 255 * (ca.b + (cb.b - ca.b) * ct), 255 * (aa.a + (ab.a - aa.a) * at));
            const u = c.textureMode === 1 ? cumulative[i] / Math.max(2 * halfWidth, 1e-5) : t;
            for (let k = 0; k < 2; k++) {
                const v = i * 2 + k;
                Vec3.scaleAndAdd(world, this.worldPoints[i], side, k === 0 ? halfWidth : -halfWidth);
                this._positions[v * 3] = world.x; this._positions[v * 3 + 1] = world.y; this._positions[v * 3 + 2] = world.z;
                this._uvs[v * 2] = u; this._uvs[v * 2 + 1] = k === 0 ? 1 : 0;
                this._colors[v * 4] = tint.r / 255; this._colors[v * 4 + 1] = tint.g / 255; this._colors[v * 4 + 2] = tint.b / 255; this._colors[v * 4 + 3] = tint.a / 255;
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
        this.mesh.updateSubMesh(0, {
            positions: this._positions.subarray(0, count * 2 * 3), uvs: this._uvs.subarray(0, count * 2 * 2), colors: this._colors.subarray(0, count * 2 * 4),
            normals: this._normals.subarray(0, count * 2 * 3), indices16: this._indices.subarray(0, n),
        });
        this.renderer.onGeometryChanged();
    }

    private activeCamera(): Camera | null {
        const scene = director.getScene();
        if (!scene) return null;
        let best: Camera | null = null;
        for (const camera of scene.getComponentsInChildren(Camera)) {
            if (!camera.enabledInHierarchy) continue;
            if (!best || camera.priority < best.priority) best = camera;
        }
        return best;
    }
}
