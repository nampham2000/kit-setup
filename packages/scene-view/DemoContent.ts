import {
    Color, Component, DirectionalLight, Material, Mesh, MeshRenderer, Node, Vec3,
    _decorator, director, primitives, utils,
} from 'cc';

const { ccclass, property, menu } = _decorator;

/**
 * Optional: fills an empty scene with a few spinning, orbiting boxes so there is
 * something to look at while testing the scene view. Delete once you have real content.
 */
@ccclass('DemoContent')
@menu('Debug/Demo Content')
export class DemoContent extends Component {
    @property
    public count = 8;

    private _spinners: Node[] = [];
    private _time = 0;

    protected onLoad () {
        this._ensureLight();

        const mesh = utils.MeshUtils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
        const ground = utils.MeshUtils.createMesh(primitives.box({ width: 24, height: 0.2, length: 24 }));

        this._spawn(ground, new Color(70, 74, 84), new Vec3(0, -0.6, 0));

        for (let i = 0; i < this.count; i++) {
            const angle = (i / this.count) * Math.PI * 2;
            const radius = 5;
            const node = this._spawn(
                mesh,
                Color.fromHEX(new Color(), ['#e24a4a', '#6ecd58', '#4a8ce2', '#e2c14a'][i % 4]),
                new Vec3(Math.cos(angle) * radius, 1 + (i % 3), Math.sin(angle) * radius),
            );
            this._spinners.push(node);
        }
    }

    protected update (dt: number) {
        this._time += dt;
        for (let i = 0; i < this._spinners.length; i++) {
            const node = this._spinners[i];
            node.setRotationFromEuler(0, this._time * 60 * (1 + i * 0.1), 0);
            const p = node.position;
            node.setPosition(p.x, 1 + (i % 3) + Math.sin(this._time * 2 + i) * 0.5, p.z);
        }
    }

    private _spawn (mesh: Mesh, color: Color, position: Vec3) {
        const node = new Node('DemoBox');
        this.node.addChild(node);
        node.setPosition(position);

        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;

        const material = new Material();
        material.initialize({ effectName: 'builtin-standard' });
        material.setProperty('albedo', color);
        renderer.material = material;

        return node;
    }

    private _ensureLight () {
        if (director.getScene().getComponentInChildren(DirectionalLight)) return;
        const node = new Node('DemoLight');
        this.node.addChild(node);
        node.setRotationFromEuler(-45, -135, 0);
        node.addComponent(DirectionalLight);
    }
}
