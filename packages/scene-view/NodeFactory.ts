import {
    Camera, Canvas, DirectionalLight, director, Label, Layers, Material, MeshRenderer, Node, primitives, utils, Vec3,
} from 'cc';

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

/**
 * One lit material for every primitive made here. Built from the engine's own standard
 * effect rather than from an asset, so it needs nothing in the project.
 */
function standardMaterial (): Material {
    if (!_material || !_material.isValid) {
        const material = new Material();
        material.initialize({ effectName: 'builtin-standard' });
        _material = material;
    }
    return _material;
}

function primitiveNode (name: string, geometry: primitives.IGeometry): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.DEFAULT;
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.MeshUtils.createMesh(geometry);
    renderer.material = standardMaterial();
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
        node = primitiveNode('Cube', primitives.box());
        break;
    case 'sphere':
        node = primitiveNode('Sphere', primitives.sphere(0.5));
        break;
    case 'capsule':
        node = primitiveNode('Capsule', primitives.capsule(0.5, 0.5, 1) as primitives.IGeometry);
        break;
    case 'cylinder':
        node = primitiveNode('Cylinder', primitives.cylinder(0.5, 0.5, 1));
        break;
    case 'plane':
        node = primitiveNode('Plane', primitives.plane({ width: 2, length: 2, widthSegments: 1, lengthSegments: 1 }));
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

    parentFor.addChild(node);

    if (kind !== 'label' && camera && camera.isValid) {
        camera.node.getWorldPosition(_spawn);
        Vec3.copy(_forward, camera.node.forward);
        Vec3.scaleAndAdd(_spawn, _spawn, _forward, SPAWN_DISTANCE);
        node.setWorldPosition(_spawn);
    }
    return node;
}
