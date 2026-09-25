import { Camera, Director, director, ParticleSystem } from 'cc';

// Unity URP draws transparent renderers with SortingCriteria.CommonTransparent:
// sorting layer value, sortingOrder, material render queue, then back to front
// by camera distance + ParticleSystemRenderer.sortingFudge (world units; a lower
// fudge draws later). Native oracle: fixtures/particle-sort-key-native.json.
// - Perspective distance is Euclidean from the camera position; orthographic
//   distance runs along the view axis (TransparencySortMode.Default).
// - The point is the renderer bounds center: the simulation-space AABB of the
//   particle positions (stretched tails included) through the emitter matrix.
//   Pivot, particle size and mesh offset do not move it. Unity's precomputed
//   procedural-mode bounds are not reproduced.
// - sortMode only orders particles inside one renderer.
// Cocos compares Model.priority first, then the pass hash, then the view-Z of
// the node pivot (particle models carry no world bounds), so the whole Unity
// key is folded into priority. The default key (layer 0, order 0, queue 3000)
// keeps the historical -(distance + fudge) value.
export interface UnityParticleSortSpec {
    path: string;
    fudge: number;
    queue: number;
    order?: number;
    /** Sorting layer value: index of m_SortingLayerID in TagManager m_SortingLayers. */
    layer?: number;
    /** 0 None, 1 Distance, 2 OldestInFront, 3 YoungestInFront, 4 Depth. */
    sortMode?: number;
    /** Stretched billboards: the tail is lengthScale * size + velocityScale * speed. */
    lengthScale?: number;
    velocityScale?: number;
}

interface Point { x: number; y: number; z: number; }
interface SortCamera { position: Point; forward: Point | null; projectionType: number; }

const BAND = 65536;       // world units reserved for distance + fudge per key band
const QUEUE_SPAN = 8192;  // renderQueue - 3000
const ORDER_SPAN = 65536; // int16 sortingOrder
const WORLD = 0;          // cc ParticleSpace.World
const ORTHO = 0;          // cc renderer.scene.CameraProjection.ORTHO
const DEFAULT_SPEC: UnityParticleSortSpec = { path: '', fudge: 0, queue: 3000 };

const _point: Point = { x: 0, y: 0, z: 0 };
const _nodeCamera: SortCamera = { position: { x: 0, y: 0, z: 0 }, forward: null, projectionType: 1 };
const _managed = new WeakSet<object>();
const _defaulted = new WeakSet<object>();
let _keys = new Float64Array(64);
let _defaultsInstalled = false;

export function unitySortPriority(spec: UnityParticleSortSpec, key: number): number {
    const band = (((spec.layer || 0) * ORDER_SPAN + (spec.order || 0)) * QUEUE_SPAN + (spec.queue - 3000)) * BAND;
    return band - Math.max(-BAND / 2, Math.min(BAND / 2, key));
}

function firstCamera(cameras: any[], layer: number): any {
    let best: any = null;
    for (let i = 0; i < cameras.length; i++) {
        const c = cameras[i];
        if (!c.enabled || !(c.visibility & layer)) continue;
        if (!best || c.priority < best.priority) best = c;
    }
    return best;
}

function sortCamera(system: any, camera: any): SortCamera | null {
    if (camera) {
        if (camera.camera) return camera.camera;
        if (camera.position && camera.forward) return camera;
        if (!camera.node?.worldPosition) return null;
        _nodeCamera.position = camera.node.worldPosition;
        return _nodeCamera;
    }
    const cameras = system.node?.scene?.renderScene?.cameras;
    return cameras ? firstCamera(cameras, system.node.layer) : null;
}

function cameraDistance(cam: SortCamera, x: number, y: number, z: number): number {
    const dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z, f = cam.forward;
    return cam.projectionType === ORTHO && f ? dx * f.x + dy * f.y + dz * f.z : Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Unity renderer bounds center of a CPU particle system, in world space. */
export function unityParticleSortPoint(system: any, spec: UnityParticleSortSpec, out: Point): boolean {
    const processor = system.processor;
    const bounds = processor?._model?.worldBounds;
    if (bounds) { out.x = bounds.center.x; out.y = bounds.center.y; out.z = bounds.center.z; return true; }
    const pool = processor?._particles;
    const count = pool ? pool.length : 0;
    if (!count) return false;
    const data = pool.data, stretch = spec.lengthScale !== undefined;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
        const p = data[i];
        let x = p.position.x, y = p.position.y, z = p.position.z;
        for (let end = 0; end < 2; end++) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            if (!stretch || end) break;
            const v = p.ultimateVelocity, speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            if (!(speed > 0)) break;
            const tail = (p.size.x * (spec.lengthScale || 0) + speed * (spec.velocityScale || 0)) / speed;
            x -= v.x * tail; y -= v.y * tail; z -= v.z * tail;
        }
    }
    const x = (minX + maxX) * 0.5, y = (minY + maxY) * 0.5, z = (minZ + maxZ) * 0.5;
    if (system.simulationSpace === WORLD) { out.x = x; out.y = y; out.z = z; return true; }
    const m = system.node.worldMatrix;
    out.x = m.m00 * x + m.m04 * y + m.m08 * z + m.m12;
    out.y = m.m01 * x + m.m05 * y + m.m09 * z + m.m13;
    out.z = m.m02 * x + m.m06 * y + m.m10 * z + m.m14;
    return true;
}

// Stable insertion sort of the live pool into Unity draw order (last = on top).
function sortParticles(system: any, spec: UnityParticleSortSpec, cam: SortCamera): void {
    const mode = spec.sortMode || 0, pool = system.processor?._particles, n = pool ? pool.length : 0;
    if (!mode || n < 2) return;
    if (_keys.length < n) _keys = new Float64Array(Math.max(n, _keys.length * 2));
    const data = pool.data, keys = _keys, f = cam.forward;
    const m = system.simulationSpace === WORLD ? null : system.node.worldMatrix;
    for (let i = 0; i < n; i++) {
        const p = data[i];
        if (mode === 2 || mode === 3) {
            const age = p.startLifetime - p.remainingLifetime;
            keys[i] = mode === 2 ? age : -age;
            continue;
        }
        let x = p.position.x, y = p.position.y, z = p.position.z;
        if (m) {
            const lx = x, ly = y, lz = z;
            x = m.m00 * lx + m.m04 * ly + m.m08 * lz + m.m12;
            y = m.m01 * lx + m.m05 * ly + m.m09 * lz + m.m13;
            z = m.m02 * lx + m.m06 * ly + m.m10 * lz + m.m14;
        }
        const dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z;
        keys[i] = mode === 4 && f ? -(dx * f.x + dy * f.y + dz * f.z) : -Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    for (let i = 1; i < n; i++) {
        const key = keys[i], item = data[i];
        let j = i - 1;
        while (j >= 0 && keys[j] > key) { keys[j + 1] = keys[j]; data[j + 1] = data[j]; j--; }
        keys[j + 1] = key; data[j + 1] = item;
    }
}

function applyPriority(system: any, camera: any, spec: UnityParticleSortSpec): void {
    const cam = sortCamera(system, camera);
    if (!cam || !unityParticleSortPoint(system, spec, _point)) return;
    const priority = unitySortPriority(spec, cameraDistance(cam, _point.x, _point.y, _point.z) + spec.fudge);
    const model = system.processor._model;
    if (model) { model.priority = priority; _managed.add(model); }
    // Unity sorts a renderer's trails with its particles.
    const trail = system.trailModule?.getModel?.();
    if (trail) { trail.priority = priority; _managed.add(trail); }
}

function isTransparent(model: any): boolean {
    const subModels = model.subModels;
    for (let i = 0; i < subModels.length; i++) {
        const passes = subModels[i].passes;
        for (let j = 0; j < passes.length; j++) if (passes[j].blendState.targets[0].blend) return true;
    }
    return false;
}

// Priorities are only comparable when every transparent model has one. Other
// models (meshes, unported particles) get the default Unity key; priorities set
// by cc.Sorting or any other owner are left alone.
function applyDefaultPriorities(): void {
    const scenes = (director as any).root?.scenes;
    if (!scenes) return;
    for (let s = 0; s < scenes.length; s++) {
        const models = scenes[s].models, cameras = scenes[s].cameras;
        for (let i = 0; i < models.length; i++) {
            const model = models[i];
            if (_managed.has(model) || !model.enabled || !model.node) continue;
            if (model.priority !== 0 && !_defaulted.has(model)) continue;
            if (!isTransparent(model)) continue;
            const cam = firstCamera(cameras, model.node.layer);
            if (!cam) continue;
            const c = model.worldBounds ? model.worldBounds.center : model.node.worldPosition;
            model.priority = unitySortPriority(DEFAULT_SPEC, cameraDistance(cam, c.x, c.y, c.z));
            _defaulted.add(model);
        }
    }
}

export function installUnityParticleSorting(system: ParticleSystem, camera: Camera | null, spec: UnityParticleSortSpec): void {
    const processor = (system as any).processor;
    if (!processor) throw new Error('Initialize the particle processor before binding source sorting');
    if (!Number.isFinite(spec.fudge) || !Number.isFinite(spec.queue)) throw new Error('Unsupported source sorting queue/fudge');
    if (processor.unitySourceSorting) return;
    processor.unitySourceSorting = spec;
    const beforeRender = processor.beforeRender, updateRenderData = processor.updateRenderData;
    if (spec.sortMode && updateRenderData) {
        processor.updateRenderData = function (): void {
            const cam = sortCamera(system, camera);
            if (cam) sortParticles(system, spec, cam);
            updateRenderData.call(this);
        };
    }
    processor.beforeRender = function (): void {
        beforeRender.call(this);
        applyPriority(system, camera, spec);
    };
    if (!_defaultsInstalled && Director && director && typeof director.on === 'function') {
        _defaultsInstalled = true;
        director.on(Director.EVENT_BEFORE_RENDER, applyDefaultPriorities);
    }
}
