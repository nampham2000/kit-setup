import {
    _decorator, Camera, Color, Component, gfx, Material, Node, ParticleSystem, RenderTexture, Sprite, SpriteFrame,
    UITransform, Vec3, Vec4,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Viewport of a Coffee UIParticle (com.coffee.ui-particle 4.x, PositionMode Relative, AutoScaling off):
 * Unity simulates the member systems at transform scale 1 and bakes their meshes into the canvas
 * multiplied by m_Scale3D, so one particle unit covers `scale` canvas units. A view that covers
 * `viewWidth` x `viewHeight` canvas units therefore sees `viewHeight / scale` particle units.
 */
export function uiParticleOrthoHeight(viewHeight: number, scale: number): number {
    if (!(scale > 0) || !(viewHeight > 0)) throw new Error('UIParticle scale and view height must be positive');
    return viewHeight / 2 / scale;
}

const _position = new Vec3();

// unity-particle.effect techniques and formulas (tools/unity-cocos-port/unity-particle-material.js).
const TECHNIQUE_ALPHA = 0, TECHNIQUE_PREMULTIPLY = 1, TECHNIQUE_ADDITIVE = 2, TECHNIQUE_ADDITIVE_ONE = 3;
const FORMULA_STANDARD = 0, FORMULA_PREMULTIPLY_ALPHA = 6;

/**
 * The bridge's target starts transparent black, and unity-particle.effect encodes sRGB before the
 * fixed-function blend (no float output): SrcAlpha blending then yields srgb(c) * a instead of Unity's
 * srgb(c * a). Premultiplying in the shader (One / OneMinusSrcAlpha, One / One) is exact over the black
 * target, the case this view composites. Only the standard formula (tint * vertex * texture) is moved.
 */
export function premultipliedTechnique(technique: number, formula: number): number {
    if (formula !== FORMULA_STANDARD) return -1;
    if (technique === TECHNIQUE_ALPHA) return TECHNIQUE_PREMULTIPLY;
    if (technique === TECHNIQUE_ADDITIVE) return TECHNIQUE_ADDITIVE_ONE;
    return -1;
}

function premultiplyMembers(system: ParticleSystem): void {
    for (const index of [0, 1]) {
        const source = system.getMaterial(index);
        const params = source?.getProperty('unityParticleParams') as Vec4 | null | undefined;
        if (!source || !params) continue;
        const technique = premultipliedTechnique(source.technique, params.x);
        if (technique < 0) continue;
        const material = new Material();
        material.copy(source, { technique });
        material.setProperty('unityParticleParams', new Vec4(FORMULA_PREMULTIPLY_ALPHA, params.y, params.z, params.w));
        system.setMaterial(material, index);
    }
}

/**
 * Runtime bridge for a Unity Coffee UIParticle. Cocos 3D particles cannot join the UI batch order at
 * an arbitrary scale without changing their simulation (Local/Hierarchy scaling, world-space gravity
 * and speed), so the bridge keeps the Unity semantics: the UIParticle subtree is simulated unscaled in
 * a private layer far from the scene, a dedicated orthographic camera renders it into a RenderTexture,
 * and a Sprite that takes the UIParticle's place (same parent and sibling index, so the same canvas
 * draw order as the Unity CanvasRenderer) composites it premultiplied (One, OneMinusSrcAlpha), which
 * keeps additive particles additive over the UI. Activation follows the view node, as the Unity
 * systems follow their GameObject (playOnAwake systems restart on enable).
 */
@ccclass('UnityUIParticleBridge')
export class UnityUIParticleBridge extends Component {
    /** UIParticle.m_Scale3D (uniform x). */
    @property scale = 1;
    /** Canvas units covered by the view (normally the canvas design size). */
    @property viewWidth = 1080;
    @property viewHeight = 1920;
    /** Private render layer bit (must not be in any other camera's visibility). */
    @property layer = 1 << 27;
    /** Simulation anchor, far from the scene. */
    @property simulationOrigin = new Vec3(0, -100000, 0);
    /** RenderTexture pixels per canvas unit. */
    @property resolution = 0.5;
    /**
     * Member systems (node names) whose trails are not drawn. Coffee UIParticle bakes trails with the
     * renderer's trail material; list a system only with source evidence that its trails are not visible.
     */
    @property([String]) hiddenTrails: string[] = [];

    private _sim: Node | null = null;
    private _camera: Camera | null = null;
    private _texture: RenderTexture | null = null;
    private _source: Node | null = null;

    /**
     * Replaces the UIParticle node `source` by a view node at the same parent and sibling index and
     * moves `source` with its member systems into the bridge's simulation space.
     */
    static replace(source: Node, options: { scale: number; viewWidth: number; viewHeight: number; layer?: number; resolution?: number; hiddenTrails?: string[] }): UnityUIParticleBridge {
        const parent = source.parent;
        if (!parent) throw new Error(`UIParticle ${source.name} has no parent`);
        const view = new Node(`${source.name}-UIParticleView`);
        view.layer = parent.layer;
        view.active = false;
        parent.insertChild(view, source.getSiblingIndex());
        const bridge = view.addComponent(UnityUIParticleBridge);
        bridge.scale = options.scale;
        bridge.viewWidth = options.viewWidth;
        bridge.viewHeight = options.viewHeight;
        if (options.layer !== undefined) bridge.layer = options.layer;
        if (options.resolution !== undefined) bridge.resolution = options.resolution;
        if (options.hiddenTrails) bridge.hiddenTrails = options.hiddenTrails.slice();
        const active = source.active;
        bridge.bind(source);
        source.active = true;
        view.active = active;
        return bridge;
    }

    /** Moves `source` (the UIParticle node and its member systems) into the bridge's simulation space. */
    bind(source: Node): void {
        if (this._source) throw new Error('UnityUIParticleBridge is already bound');
        this._source = source;
        const view = this.node;
        const sim = this._sim = new Node(`${source.name}-UIParticleSim`);
        const root = view.scene;
        root.addChild(sim);
        sim.setWorldPosition(this.simulationOrigin);
        source.getPosition(_position);
        source.removeFromParent();
        sim.addChild(source);
        // Unity forces the UIParticle transform to scale 1 at runtime; members keep their local transforms.
        source.setPosition(0, 0, 0);
        source.setScale(1, 1, 1);
        const apply = (node: Node): void => { node.layer = this.layer; node.children.forEach(apply); };
        apply(source);
        // ModelRenderer caches its visibility from the layer it had when loaded; a layer change on an
        // inactive node does not reach the particle/trail models (visFlags stayed 0 in preview).
        // Coffee UIParticle bakes its members (particles and trails) itself, so the Unity renderers are
        // disabled in the source; the ported UnityParticleRendererVisibility would keep them hidden.
        for (const visibility of source.getComponentsInChildren('UnityParticleRendererVisibility') as unknown as { rendererVisible: boolean; trailsVisible: boolean; node: Node }[]) {
            visibility.rendererVisible = true;
            visibility.trailsVisible = this.hiddenTrails.indexOf(visibility.node.name) < 0;
        }
        for (const system of source.getComponentsInChildren(ParticleSystem)) premultiplyMembers(system);
        for (const system of source.getComponentsInChildren(ParticleSystem)) {
            const renderer = system as unknown as { processor: unknown; _visFlags: number };
            if (renderer.processor) system.visibility = this.layer; else renderer._visFlags = this.layer;
        }
        const camNode = new Node('UIParticleCamera');
        sim.addChild(camNode);
        camNode.setPosition(0, 0, 1000);
        const camera = this._camera = camNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.orthoHeight = uiParticleOrthoHeight(this.viewHeight, this.scale);
        camera.near = 1; camera.far = 2000;
        camera.visibility = this.layer;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(0, 0, 0, 0);
        camera.priority = -100;
        const texture = this._texture = new RenderTexture();
        texture.reset({ width: Math.max(2, Math.round(this.viewWidth * this.resolution)), height: Math.max(2, Math.round(this.viewHeight * this.resolution)) });
        camera.targetTexture = texture;
        const transform = view.getComponent(UITransform) || view.addComponent(UITransform);
        transform.setContentSize(this.viewWidth, this.viewHeight);
        view.setPosition(_position);
        const sprite = view.getComponent(Sprite) || view.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const frame = new SpriteFrame();
        frame.texture = texture;
        sprite.spriteFrame = frame;
        transform.setContentSize(this.viewWidth, this.viewHeight);
        // UIRenderer keeps these setters out of the public typings in 3.8.
        const blend = sprite as unknown as { srcBlendFactor: number; dstBlendFactor: number };
        blend.srcBlendFactor = gfx.BlendFactor.ONE;
        blend.dstBlendFactor = gfx.BlendFactor.ONE_MINUS_SRC_ALPHA;
        sim.active = false;
    }

    get simulationRoot(): Node | null { return this._sim; }
    get renderCamera(): Camera | null { return this._camera; }

    protected onEnable(): void {
        if (!this._sim) return;
        // Cocos plays playOnAwake systems when their node becomes active, like Unity OnEnable.
        this._sim.active = true;
    }

    protected onDisable(): void {
        if (!this._sim) return;
        for (const system of this._sim.getComponentsInChildren(ParticleSystem)) { system.stop(); system.clear(); }
        this._sim.active = false;
    }

    protected onDestroy(): void {
        this._sim?.destroy();
        this._texture?.destroy();
    }
}
