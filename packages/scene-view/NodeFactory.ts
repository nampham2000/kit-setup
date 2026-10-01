import {
    Camera, Canvas, DirectionalLight, director, Label, Layers, Material, MeshRenderer, Node, utils, Vec3,
} from 'cc';
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

/**
 * A lit material for the primitives made here, found rather than assumed.
 *
 * The engine's `builtin-standard` effect is not always registered: a project can crop
 * what its build contains, and then a material built from it has no passes, which makes
 * the first mesh using it throw when it enters the scene. So this looks for a material
 * that is known to work, in order of preference:
 *   1. one already on a mesh in the scene whose effect is the standard one;
 *   2. any other standard-looking material on a mesh in the scene;
 *   3. a fresh `builtin-standard`, if that effect turns out to exist;
 *   4. any usable material on a mesh in the scene, whatever it is.
 * Returns null when none works, and the caller declines to create the object.
 */
function standardMaterial (): Material | null {
    if (usable(_material)) return _material;
    _material = null;

    const found: Material[] = [];
    const scene = director.getScene();
    if (scene) {
        for (const renderer of scene.getComponentsInChildren(MeshRenderer)) {
            const material = renderer.sharedMaterial;
            if (usable(material) && found.indexOf(material as Material) < 0) found.push(material as Material);
        }
    }
    const named = (material: Material, text: string) => (material.effectName || '').toLowerCase().indexOf(text) >= 0;

    const exact = found.find((m) => named(m, 'builtin-standard'));
    const similar = found.find((m) => named(m, 'standard'));
    if (exact || similar) {
        _material = exact || similar;
        return _material;
    }

    try {
        const fresh = new Material();
        fresh.initialize({ effectName: 'builtin-standard' });
        if (usable(fresh)) {
            _material = fresh;
            return fresh;
        }
        fresh.destroy();
    } catch {
        // The effect is not there; fall through to whatever the scene has.
    }

    _material = found.length ? found[0] : null;
    return _material;
}

function primitiveNode (name: string, data: MeshData): Node | null {
    // The meshes are our own data, but turning data into a Mesh still takes the engine's utility.
    if (typeof utils === 'undefined' || !utils.MeshUtils) {
        console.warn('[SceneView] this build has no mesh utility (utils.MeshUtils), so a 3D object cannot be created');
        return null;
    }
    const material = standardMaterial();
    if (!material) {
        console.warn('[SceneView] cannot create a 3D object: no usable material. The engine\'s builtin-standard effect is not '
            + 'in this build and no mesh in the scene has a material to borrow.');
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
