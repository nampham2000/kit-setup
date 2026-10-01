import {
    Camera, Canvas, DirectionalLight, director, Label, Layers, Material, MeshRenderer, Node, utils, Vec3,
} from 'cc';
import * as engine from 'cc';
import { boxData, capsuleData, cylinderData, MeshData, planeData, sphereData } from './Primitives';

export type NodeKind = 'empty' | 'cube' | 'sphere' | 'capsule' | 'cylinder' | 'plane' | 'light' | 'label';

export interface KindInfo {
    kind: NodeKind;
    label: string;
    group: string;
}

/** What the New menu offers, in order. */
export const NODE_KINDS: KindInfo[] = [
    { kind: 'empty', label: 'Empty node', group: 'Node' },
    { kind: 'cube', label: 'Cube', group: '3D object' },
    { kind: 'sphere', label: 'Sphere', group: '3D object' },
    { kind: 'capsule', label: 'Capsule', group: '3D object' },
    { kind: 'cylinder', label: 'Cylinder', group: '3D object' },
    { kind: 'plane', label: 'Plane', group: '3D object' },
    { kind: 'light', label: 'Directional light', group: 'Light' },
    { kind: 'label', label: 'Label', group: 'UI' },
];

/** How far in front of the scene camera a new 3D object is placed. */
const SPAWN_DISTANCE = 6;

const _forward = new Vec3();
const _spawn = new Vec3();

let _material: Material = null;

/** A material the renderer can actually draw with: it exists, and its effect gave it passes. */
function usable (material: Material | null | undefined): boolean {
    return !!material && material.isValid && !!material.passes && material.passes.length > 0 && !!material.effectAsset;
}

/** Names the engine registers its own ready-made materials under, best first. */
const BUILTIN_MATERIALS = ['default-material', 'standard-material'];

/**
 * The material for the primitives made here: Cocos's own default, a plain lit surface
 * with no texture, which is what the editor gives a new cube.
 *
 * It is looked up rather than assumed, because a project can crop what its build
 * contains, and a material whose effect is missing has no passes and makes the first
 * mesh using it throw. In order of preference:
 *   1. the engine's own default material, from its built-in resources;
 *   2. a fresh material from the `builtin-standard` effect, if that effect exists;
 *   3. a fresh material from the same effect as a standard-looking material on a mesh
 *      in the scene. It is a new material, so it carries that effect's defaults and none
 *      of the mesh's textures or colours;
 *   4. the same, from any effect a scene mesh uses.
 * Returns null when none works, and the caller declines to create the object.
 */
function defaultMaterial (): Material | null {
    if (usable(_material)) return _material;
    _material = null;

    // 1. The engine's own.
    const manager = (engine as unknown as { builtinResMgr?: { get (name: string): Material | undefined } }).builtinResMgr;
    if (manager && typeof manager.get === 'function') {
        for (const name of BUILTIN_MATERIALS) {
            try {
                const material = manager.get(name);
                if (usable(material)) {
                    _material = material as Material;
                    return _material;
                }
            } catch {
                // Not registered under this name in this build.
            }
        }
    }

    // 2. A fresh one from the standard effect.
    const fresh = tryFromEffect({ effectName: 'builtin-standard' });
    if (fresh) return (_material = fresh);

    // 3 and 4. Borrow an effect from the scene, but not the material that uses it.
    const scene = director.getScene();
    if (scene) {
        const effects: engine.EffectAsset[] = [];
        for (const renderer of scene.getComponentsInChildren(MeshRenderer)) {
            const effect = renderer.sharedMaterial ? renderer.sharedMaterial.effectAsset : null;
            if (effect && effects.indexOf(effect) < 0) effects.push(effect);
        }
        const standard = effects.filter((effect) => (effect.name || '').toLowerCase().indexOf('standard') >= 0);
        for (const effect of standard.concat(effects)) {
            const made = tryFromEffect({ effectAsset: effect });
            if (made) return (_material = made);
        }
    }
    return null;
}

/** Build a material from `info`, or return null if it comes out unusable. */
function tryFromEffect (info: engine.IMaterialInfo): Material | null {
    try {
        const material = new Material();
        material.initialize(info);
        if (usable(material)) return material;
        material.destroy();
    } catch {
        // The effect is missing or rejected; the caller tries the next source.
    }
    return null;
}

function primitiveNode (name: string, data: MeshData): Node | null {
    // The meshes are our own data, but turning data into a Mesh still takes the engine's utility.
    if (typeof utils === 'undefined' || !utils.MeshUtils) {
        console.warn('[SceneView] this build has no mesh utility (utils.MeshUtils), so a 3D object cannot be created');
        return null;
    }
    const material = defaultMaterial();
    if (!material) {
        console.warn('[SceneView] cannot create a 3D object: no usable material. The engine\'s default material and its '
            + 'builtin-standard effect are not in this build, and no mesh in the scene offers an effect to build one from.');
        return null;
    }
    const node = new Node(name);
    node.layer = Layers.Enum.DEFAULT;
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.MeshUtils.createMesh(data);
    renderer.material = material;
    return node;
}

/** The first Canvas at or above `node`, or failing that any Canvas in the scene. */
function findCanvas (node: Node): Node | null {
    for (let n = node; n; n = n.parent) {
        if (n.getComponent(Canvas)) return n;
    }
    const scene = director.getScene();
    const any = scene ? scene.getComponentInChildren(Canvas) : null;
    return any ? any.node : null;
}

/**
 * Build a node of `kind` under `parent` and return it, or null if it cannot be made.
 *
 * A 3D object is placed a few units in front of `camera`, so it appears where the user
 * is looking rather than at the world origin, which may be far away. A UI label has to
 * live under a Canvas to be drawn at all, so it goes under the nearest one.
 */
export function createNode (kind: NodeKind, parent: Node, camera: Camera | null): Node | null {
    if (!parent || !parent.isValid) return null;

    let node: Node = null;
    let parentFor = parent;

    switch (kind) {
    case 'empty':
        node = new Node('Node');
        node.layer = Layers.Enum.DEFAULT;
        break;
    case 'cube':
        node = primitiveNode('Cube', boxData(1));
        break;
    case 'sphere':
        node = primitiveNode('Sphere', sphereData(0.5));
        break;
    case 'capsule':
        node = primitiveNode('Capsule', capsuleData(0.5, 1));
        break;
    case 'cylinder':
        node = primitiveNode('Cylinder', cylinderData(0.5, 1));
        break;
    case 'plane':
        node = primitiveNode('Plane', planeData(2, 2));
        break;
    case 'light':
        node = new Node('Directional Light');
        node.layer = Layers.Enum.DEFAULT;
        node.addComponent(DirectionalLight);
        break;
    case 'label': {
        const canvas = findCanvas(parent);
        if (!canvas) {
            console.warn('[SceneView] a Label needs a Canvas in the scene, and there is none');
            return null;
        }
        parentFor = canvas;
        node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        const label = node.addComponent(Label);
        label.string = 'Label';
        break;
    }
    default:
        return null;
    }

    if (!node) return null;
    try {
        parentFor.addChild(node);
    } catch (error) {
        // Entering the scene runs the components' onEnable, which can throw. Leaving the half-added
        // node behind would repeat the error every frame, so take it out and say what happened.
        console.error(`[SceneView] could not add the new ${node.name} to the scene:`, error);
        try {
            node.removeFromParent();
            node.destroy();
        } catch {
            // Nothing more can be done for it.
        }
        return null;
    }

    if (kind !== 'label' && camera && camera.isValid) {
        camera.node.getWorldPosition(_spawn);
        Vec3.copy(_forward, camera.node.forward);
        Vec3.scaleAndAdd(_spawn, _spawn, _forward, SPAWN_DISTANCE);
        node.setWorldPosition(_spawn);
    }
    return node;
}
