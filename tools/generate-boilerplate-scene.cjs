const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function randomUuid() {
  return crypto.randomUUID();
}

function compressUuid(uuid) {
  const compact = String(uuid || '').replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return uuid;
  const head = compact.slice(0, 5);
  const rest = compact.slice(5);
  const evenRest = rest.length % 2 === 0 ? rest : (rest + '0');
  let b64 = Buffer.from(evenRest, 'hex').toString('base64').replace(/=+$/g, '');
  if (rest.length % 2 !== 0) b64 = b64.slice(0, -1);
  return head + b64;
}

// Scene Object Array Builder
class SceneBuilder {
  constructor(sceneName) {
    this.name = sceneName;
    this.items = [];
    this.sceneAsset = {
      __type__: "cc.SceneAsset",
      _name: sceneName,
      _objFlags: 0,
      __editorExtras__: {},
      _native: "",
      scene: { __id__: 1 }
    };
    this.items.push(this.sceneAsset);

    this.scene = {
      __type__: "cc.Scene",
      _name: sceneName,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: null,
      _children: [],
      _active: true,
      _components: [],
      _prefab: null,
      _lpos: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
      _lrot: { __type__: "cc.Quat", x: 0, y: 0, z: 0, w: 1 },
      _lscale: { __type__: "cc.Vec3", x: 1, y: 1, z: 1 },
      _mobility: 0,
      _layer: 1073741824,
      _euler: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
      autoReleaseAssets: false,
      _globals: null,
      _id: randomUuid()
    };
    this.items.push(this.scene);
  }

  addItem(item) {
    const id = this.items.length;
    this.items.push(item);
    return id;
  }

  addGlobals() {
    const ambientId = this.addItem({
      __type__: "cc.AmbientInfo",
      _skyColorHDR: { __type__: "cc.Vec4", x: 0.2, y: 0.5, z: 0.8, w: 0.520833125 },
      _skyColor: { __type__: "cc.Vec4", x: 0.2, y: 0.5, z: 0.8, w: 0.520833125 },
      _skyIllumHDR: 20000,
      _skyIllum: 20000,
      _skyIllumLDR: 0.520833125,
      _groundAlbedoHDR: { __type__: "cc.Vec4", x: 0.2, y: 0.2, z: 0.2, w: 1 },
      _groundAlbedo: { __type__: "cc.Vec4", x: 0.2, y: 0.2, z: 0.2, w: 1 },
      _skyColorLDR: { __type__: "cc.Color", r: 51, g: 128, b: 204, a: 255 },
      _groundAlbedoLDR: { __type__: "cc.Color", r: 51, g: 51, b: 51, a: 255 }
    });

    const shadowsId = this.addItem({
      __type__: "cc.ShadowsInfo",
      _enabled: false,
      _type: 0,
      _normal: { __type__: "cc.Vec3", x: 0, y: 1, z: 0 },
      _distance: 0,
      _planeBias: 1,
      _shadowColor: { __type__: "cc.Color", r: 76, g: 76, b: 76, a: 255 },
      _maxReceived: 4,
      _size: { __type__: "cc.Vec2", x: 1024, y: 1024 }
    });

    const skyboxId = this.addItem({
      __type__: "cc.SkyboxInfo",
      _applyDiffuse: false,
      _envLightingType: 0,
      _envmapHDR: null,
      _envmap: null,
      _envmapLDR: null,
      _diffuseMapHDR: null,
      _diffuseMapLDR: null,
      _enabled: false,
      _useHDR: true,
      _editableMaterial: null,
      _rotationAngle: 0
    });

    const fogId = this.addItem({
      __type__: "cc.FogInfo",
      _type: 0,
      _fogColor: { __type__: "cc.Color", r: 200, g: 200, b: 200, a: 255 },
      _enabled: false,
      _fogDensity: 0.3,
      _fogStart: 0.5,
      _fogEnd: 300,
      _fogAtten: 5,
      _fogTop: 1.5,
      _fogRange: 1.2
    });

    const octreeId = this.addItem({
      __type__: "cc.OctreeInfo",
      _enabled: false,
      _minPos: { __type__: "cc.Vec3", x: -1024, y: -1024, z: -1024 },
      _maxPos: { __type__: "cc.Vec3", x: 1024, y: 1024, z: 1024 },
      _depth: 8
    });

    const skinId = this.addItem({
      __type__: "cc.SkinInfo",
      _enabled: true,
      _blurRadius: 0.01,
      _sssIntensity: 3
    });

    const lightProbeId = this.addItem({
      __type__: "cc.LightProbeInfo",
      _giMultiplier: 1,
      _giScale: 1,
      _bounceIntensity: 1,
      _occupancy: 0.05,
      _maxNumReflBlk: 100,
      _reflBlkCellSize: 5
    });

    const postSettingsId = this.addItem({
      __type__: "cc.PostSettingsInfo",
      _toneMappingType: 0
    });

    const globalsId = this.addItem({
      __type__: "cc.SceneGlobals",
      ambient: { __id__: ambientId },
      shadows: { __id__: shadowsId },
      _skybox: { __id__: skyboxId },
      fog: { __id__: fogId },
      octree: { __id__: octreeId },
      skin: { __id__: skinId },
      lightProbeInfo: { __id__: lightProbeId },
      postSettings: { __id__: postSettingsId },
      bakedWithStationaryMainLight: false,
      bakedWithHighpLightmap: false
    });

    this.scene._globals = { __id__: globalsId };
    return globalsId;
  }

  createNode(name, parentId, options = {}) {
    const nodeObj = {
      __type__: "cc.Node",
      _name: name,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: parentId ? { __id__: parentId } : null,
      _children: [],
      _active: options.active !== undefined ? options.active : true,
      _components: [],
      _prefab: null,
      _lpos: {
        __type__: "cc.Vec3",
        x: options.pos ? options.pos[0] : 0,
        y: options.pos ? options.pos[1] : 0,
        z: options.pos ? options.pos[2] : 0
      },
      _lrot: options.quat ? {
        __type__: "cc.Quat",
        x: options.quat[0],
        y: options.quat[1],
        z: options.quat[2],
        w: options.quat[3]
      } : {
        __type__: "cc.Quat",
        x: 0,
        y: 0,
        z: 0,
        w: 1
      },
      _lscale: {
        __type__: "cc.Vec3",
        x: options.scale ? options.scale[0] : 1,
        y: options.scale ? options.scale[1] : 1,
        z: options.scale ? options.scale[2] : 1
      },
      _mobility: 0,
      _layer: options.layer !== undefined ? options.layer : 1073741824,
      _euler: {
        __type__: "cc.Vec3",
        x: options.euler ? options.euler[0] : 0,
        y: options.euler ? options.euler[1] : 0,
        z: options.euler ? options.euler[2] : 0
      },
      _id: randomUuid()
    };

    const nodeId = this.addItem(nodeObj);
    if (parentId && this.items[parentId]) {
      this.items[parentId]._children.push({ __id__: nodeId });
    }
    return nodeId;
  }

  addComponent(nodeId, compData) {
    compData.node = { __id__: nodeId };
    compData._id = compData._id || randomUuid();
    const compId = this.addItem(compData);
    this.items[nodeId]._components.push({ __id__: compId });
    return compId;
  }
}

// Build Scene
const builder = new SceneBuilder("Boilerplate");
builder.addGlobals();

// Root Scene children list will be populated automatically
const sceneId = 1;

// 1. Main Light (Directional)
const lightNodeId = builder.createNode("Main Light", sceneId, {
  pos: [1.2, 3.0, 0.2],
  euler: [-135, -180, 0],
  quat: [-5.657e-17, -0.38268, -0.92388, 2.343e-17]
});
const staticLightSettingsId = builder.addItem({
  __type__: "cc.StaticLightSettings",
  _baked: false,
  _editorOnly: false,
  _castShadow: false
});
builder.addComponent(lightNodeId, {
  __type__: "cc.DirectionalLight",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _color: { __type__: "cc.Color", r: 255, g: 245, b: 220, a: 255 },
  _useColorTemperature: true,
  _colorTemperature: 6550,
  _staticSettings: { __id__: staticLightSettingsId },
  _visibility: 1073741824,
  _illuminanceHDR: 97500,
  _illuminance: 97500,
  _illuminanceLDR: 1.69
});

// 2. Camera 1: Main Camera 3D (Perspective)
const mainCamNodeId = builder.createNode("Main Camera 3D", sceneId, {
  pos: [0, 5.5, 7.5],
  euler: [-32, 0, 0],
  quat: [-0.275637, 0, 0, 0.961262]
});
const mainCamCompId = builder.addComponent(mainCamNodeId, {
  __type__: "cc.Camera",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _projection: 1, // Perspective
  _priority: 1,
  _fov: 45,
  _fovAxis: 0,
  _orthoHeight: 10,
  _near: 0.1,
  _far: 1000,
  _color: { __type__: "cc.Color", r: 35, g: 45, b: 65, a: 255 },
  _depth: 1,
  _stencil: 0,
  _clearFlags: 6, // Color & Depth
  _rect: { __type__: "cc.Rect", x: 0, y: 0, width: 1, height: 1 },
  _visibility: 1073741824 // DEFAULT layer
});

// 3. Camera 2: Top-Down / Action Camera 3D (Perspective / Overhead)
const topDownCamNodeId = builder.createNode("TopDown Camera 3D", sceneId, {
  pos: [0, 9.5, 1.2],
  euler: [-80, 0, 0],
  quat: [-0.642788, 0, 0, 0.766044],
  active: true
});
const topDownCamCompId = builder.addComponent(topDownCamNodeId, {
  __type__: "cc.Camera",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: false, // Inactive by default, toggled via CameraController
  __prefab: null,
  _projection: 1,
  _priority: 2,
  _fov: 50,
  _fovAxis: 0,
  _orthoHeight: 10,
  _near: 0.1,
  _far: 1000,
  _color: { __type__: "cc.Color", r: 35, g: 45, b: 65, a: 255 },
  _depth: 1,
  _stencil: 0,
  _clearFlags: 6,
  _rect: { __type__: "cc.Rect", x: 0, y: 0, width: 1, height: 1 },
  _visibility: 1073741824
});

// 4. 3D World Root
const world3dNodeId = builder.createNode("3D_World", sceneId, { pos: [0, 0, 0] });

// Ground Node
const groundNodeId = builder.createNode("Ground", world3dNodeId, {
  pos: [0, -0.6, 0],
  scale: [8, 0.2, 8]
});
const bakeSettingsGroundId = builder.addItem({
  __type__: "cc.ModelBakeSettings",
  texture: null,
  uvParam: { __type__: "cc.Vec4", x: 0, y: 0, z: 0, w: 0 },
  bakeLightString: "",
  _castShadow: false,
  _receiveShadow: false
});
builder.addComponent(groundNodeId, {
  __type__: "cc.MeshRenderer",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _materials: [
    { __uuid__: "43efc57c-b260-41e5-a6fa-fda738cc362b", __expectedType__: "cc.Material" } // Board1.mtl
  ],
  _visFlags: 0,
  bakeSettings: { __id__: bakeSettingsGroundId },
  _mesh: { __uuid__: "7359eb87-1a1d-4897-8110-3295f5e86f76@321f6", __expectedType__: "cc.Mesh" },
  _shadowCastingMode: 0,
  _shadowReceivingMode: 1
});

// Interactive Hero 3D Object
const heroNodeId = builder.createNode("InteractiveHero", world3dNodeId, {
  pos: [0, 0.6, 0],
  scale: [1.2, 1.2, 1.2]
});
const bakeSettingsHeroId = builder.addItem({
  __type__: "cc.ModelBakeSettings",
  texture: null,
  uvParam: { __type__: "cc.Vec4", x: 0, y: 0, z: 0, w: 0 },
  bakeLightString: "",
  _castShadow: false,
  _receiveShadow: false
});
builder.addComponent(heroNodeId, {
  __type__: "cc.MeshRenderer",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _materials: [
    { __uuid__: "51b009a7-fd0a-40b8-8277-ead59deadff1", __expectedType__: "cc.Material" } // Blue.mtl
  ],
  _visFlags: 0,
  bakeSettings: { __id__: bakeSettingsHeroId },
  _mesh: { __uuid__: "7359eb87-1a1d-4897-8110-3295f5e86f76@321f6", __expectedType__: "cc.Mesh" },
  _shadowCastingMode: 0,
  _shadowReceivingMode: 1
});
// Interactive3DHero script component
const heroCompId = builder.addComponent(heroNodeId, {
  __type__: compressUuid("9efed29f-4345-4b03-b95f-25e1eebe27f4"), // Interactive3DHero
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  enableIdleAnimation: true,
  floatHeight: 0.35,
  floatDuration: 1.4,
  raycastCamera: { __id__: mainCamCompId }
});

// Decorations Root
const decoNodeId = builder.createNode("Decorations", world3dNodeId, { pos: [0, 0, 0] });
const deco1NodeId = builder.createNode("Deco_Orange", decoNodeId, { pos: [-2.5, 0.4, -1], scale: [0.6, 0.6, 0.6] });
builder.addComponent(deco1NodeId, {
  __type__: "cc.MeshRenderer",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _materials: [{ __uuid__: "ad0b6870-43f6-4bd9-9a27-aea9beef36a8", __expectedType__: "cc.Material" }],
  _visFlags: 0,
  bakeSettings: { __id__: bakeSettingsHeroId },
  _mesh: { __uuid__: "7359eb87-1a1d-4897-8110-3295f5e86f76@321f6", __expectedType__: "cc.Mesh" }
});
const deco2NodeId = builder.createNode("Deco_Pink", decoNodeId, { pos: [2.5, 0.4, 1], scale: [0.6, 0.6, 0.6] });
builder.addComponent(deco2NodeId, {
  __type__: "cc.MeshRenderer",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _materials: [{ __uuid__: "9f36a1d8-66c4-45bb-85d8-328a3d4d7c2e", __expectedType__: "cc.Material" }],
  _visFlags: 0,
  bakeSettings: { __id__: bakeSettingsHeroId },
  _mesh: { __uuid__: "7359eb87-1a1d-4897-8110-3295f5e86f76@321f6", __expectedType__: "cc.Mesh" }
});

// 5. 2D UI Canvas
const canvasNodeId = builder.createNode("Canvas", sceneId, {
  layer: 33554432 // UI_2D
});
const canvasTransformCompId = builder.addComponent(canvasNodeId, {
  __type__: "cc.UITransform",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _contentSize: { __type__: "cc.Size", width: 720, height: 1280 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});

// Camera 3: UI Camera 2D (Orthographic inside Canvas)
const uiCamNodeId = builder.createNode("UI Camera 2D", canvasNodeId, {
  layer: 33554432,
  pos: [0, 0, 1000]
});
const uiCamCompId = builder.addComponent(uiCamNodeId, {
  __type__: "cc.Camera",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _projection: 0, // Orthographic
  _priority: 10,
  _fov: 45,
  _fovAxis: 0,
  _orthoHeight: 640,
  _near: 1,
  _far: 2000,
  _color: { __type__: "cc.Color", r: 0, g: 0, b: 0, a: 0 },
  _depth: 1,
  _stencil: 0,
  _clearFlags: 0, // Nothing (renders over 3D)
  _rect: { __type__: "cc.Rect", x: 0, y: 0, width: 1, height: 1 },
  _visibility: 33554432 // UI_2D
});

const canvasCompId = builder.addComponent(canvasNodeId, {
  __type__: "cc.Canvas",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _cameraComponent: { __id__: uiCamCompId },
  _alignCanvasWithScreen: true
});
builder.addComponent(canvasNodeId, {
  __type__: "cc.Widget",
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  _alignFlags: 45, // Top + Bottom + Left + Right
  _target: null,
  _left: 0,
  _right: 0,
  _top: 0,
  _bottom: 0,
  _isAbsLeft: true,
  _isAbsRight: true,
  _isAbsTop: true,
  _isAbsBottom: true,
  _originalWidth: 720,
  _originalHeight: 1280
});

// UI: Header Group
const headerNodeId = builder.createNode("HeaderGroup", canvasNodeId, {
  layer: 33554432,
  pos: [0, 520, 0]
});
builder.addComponent(headerNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 700, height: 120 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(headerNodeId, {
  __type__: "cc.Widget",
  _alignFlags: 1, // Top
  _top: 40,
  _isAbsTop: true
});

// UI: Title Label
const titleNodeId = builder.createNode("TitleText", headerNodeId, {
  layer: 33554432,
  pos: [0, 25, 0]
});
builder.addComponent(titleNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 600, height: 50 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
const titleLabelCompId = builder.addComponent(titleNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "PLAYABLE AD DEMO",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 36,
  _fontSize: 36,
  _lineHeight: 44,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _isBold: true,
  _enableOutline: true,
  _outlineColor: { __type__: "cc.Color", r: 20, g: 30, b: 50, a: 255 },
  _outlineWidth: 3
});

// UI: Subtitle Label
const subtitleNodeId = builder.createNode("SubtitleText", headerNodeId, {
  layer: 33554432,
  pos: [0, -25, 0]
});
builder.addComponent(subtitleNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 600, height: 35 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
const subtitleLabelCompId = builder.addComponent(subtitleNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "Tap the 3D Box or Screen to Play!",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 22,
  _fontSize: 22,
  _lineHeight: 28,
  _color: { __type__: "cc.Color", r: 255, g: 220, b: 80, a: 255 },
  _enableOutline: true,
  _outlineColor: { __type__: "cc.Color", r: 10, g: 15, b: 25, a: 255 },
  _outlineWidth: 2
});

// UI: HUD Controls Group (Counter + Camera Switch + Audio Toggle)
const hudNodeId = builder.createNode("HUDGroup", canvasNodeId, {
  layer: 33554432,
  pos: [0, 400, 0]
});
builder.addComponent(hudNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 700, height: 100 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});

// Tap Counter Label
const tapCounterNodeId = builder.createNode("TapCounter", hudNodeId, {
  layer: 33554432,
  pos: [0, 30, 0]
});
builder.addComponent(tapCounterNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 300, height: 50 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
const tapCounterLabelCompId = builder.addComponent(tapCounterNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "Taps: 0 / 3",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 34,
  _fontSize: 34,
  _lineHeight: 40,
  _color: { __type__: "cc.Color", r: 100, g: 255, b: 180, a: 255 },
  _isBold: true,
  _enableOutline: true,
  _outlineColor: { __type__: "cc.Color", r: 10, g: 30, b: 20, a: 255 },
  _outlineWidth: 3
});

// Camera Switch Button
const camBtnNodeId = builder.createNode("CameraSwitchBtn", hudNodeId, {
  layer: 33554432,
  pos: [-170, -35, 0]
});
builder.addComponent(camBtnNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 240, height: 55 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(camBtnNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 40, g: 120, b: 220, a: 220 },
  _spriteFrame: { __uuid__: "4ee02e49-05bb-4fee-ab83-c37087c80ffb@f9941", __expectedType__: "cc.SpriteFrame" },
  _type: 1 // Sliced
});
builder.addComponent(camBtnNodeId, {
  __type__: "cc.Button",
  _enabled: true,
  _transition: 1,
  _zoomScale: 1.1,
  _target: { __id__: camBtnNodeId }
});
const camBtnLabelNodeId = builder.createNode("Label", camBtnNodeId, { layer: 33554432, pos: [0, 0, 0] });
builder.addComponent(camBtnLabelNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 220, height: 40 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
const camBtnLabelCompId = builder.addComponent(camBtnLabelNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "Cam: Perspective 3D",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 17,
  _fontSize: 17,
  _lineHeight: 22,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _isBold: true
});

// Audio Toggle Button
const audioBtnNodeId = builder.createNode("AudioToggleBtn", hudNodeId, {
  layer: 33554432,
  pos: [170, -35, 0]
});
builder.addComponent(audioBtnNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 180, height: 55 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(audioBtnNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 60, g: 160, b: 90, a: 220 },
  _spriteFrame: { __uuid__: "4ee02e49-05bb-4fee-ab83-c37087c80ffb@f9941", __expectedType__: "cc.SpriteFrame" },
  _type: 1
});
builder.addComponent(audioBtnNodeId, {
  __type__: "cc.Button",
  _enabled: true,
  _transition: 1,
  _zoomScale: 1.1,
  _target: { __id__: audioBtnNodeId }
});
const audioBtnLabelNodeId = builder.createNode("Label", audioBtnNodeId, { layer: 33554432, pos: [0, 0, 0] });
builder.addComponent(audioBtnLabelNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 160, height: 40 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
const audioBtnLabelCompId = builder.addComponent(audioBtnLabelNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "Sound: ON 🔊",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 17,
  _fontSize: 17,
  _lineHeight: 22,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _isBold: true
});

// UI: Tutorial Hand Pointer
const handNodeId = builder.createNode("TutorialHand", canvasNodeId, {
  layer: 33554432,
  pos: [70, -60, 0],
  scale: [0.85, 0.85, 0.85]
});
builder.addComponent(handNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 90, height: 90 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(handNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _spriteFrame: { __uuid__: "8813b2bf-0349-450a-8013-41b3d7d9a7de@f9941", __expectedType__: "cc.SpriteFrame" } // icon
});
builder.addComponent(handNodeId, {
  __type__: "cc.UIOpacity",
  _enabled: true,
  _opacity: 255
});

// UI: Primary CTA Button (Floating at bottom)
const ctaBtnNodeId = builder.createNode("CTAButton", canvasNodeId, {
  layer: 33554432,
  pos: [0, -480, 0]
});
builder.addComponent(ctaBtnNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 340, height: 90 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(ctaBtnNodeId, {
  __type__: "cc.Widget",
  _alignFlags: 4, // Bottom
  _bottom: 60,
  _isAbsBottom: true
});
builder.addComponent(ctaBtnNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 35, g: 195, b: 90, a: 255 },
  _spriteFrame: { __uuid__: "4ee02e49-05bb-4fee-ab83-c37087c80ffb@f9941", __expectedType__: "cc.SpriteFrame" },
  _type: 1
});
builder.addComponent(ctaBtnNodeId, {
  __type__: "cc.Button",
  _enabled: true,
  _transition: 1,
  _zoomScale: 1.1,
  _target: { __id__: ctaBtnNodeId }
});
const ctaBtnLabelNodeId = builder.createNode("Label", ctaBtnNodeId, { layer: 33554432, pos: [0, 0, 0] });
builder.addComponent(ctaBtnLabelNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 320, height: 60 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(ctaBtnLabelNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "INSTALL NOW ➔",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 30,
  _fontSize: 30,
  _lineHeight: 38,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _isBold: true,
  _enableOutline: true,
  _outlineColor: { __type__: "cc.Color", r: 10, g: 60, b: 25, a: 255 },
  _outlineWidth: 2
});

// UI: Result Screen (End Card Popup)
const resultNodeId = builder.createNode("ResultScreen", canvasNodeId, {
  layer: 33554432,
  pos: [0, 0, 0],
  active: false
});
builder.addComponent(resultNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 720, height: 1280 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resultNodeId, {
  __type__: "cc.Widget",
  _alignFlags: 45,
  _left: 0, _right: 0, _top: 0, _bottom: 0
});
builder.addComponent(resultNodeId, {
  __type__: "cc.BlockInputEvents",
  _enabled: true
});
builder.addComponent(resultNodeId, {
  __type__: "cc.UIOpacity",
  _enabled: true,
  _opacity: 255
});

// Result Dark Backdrop
const resultBgNodeId = builder.createNode("Backdrop", resultNodeId, { layer: 33554432, pos: [0, 0, 0] });
builder.addComponent(resultBgNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 720, height: 1280 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resultBgNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 10, g: 15, b: 25, a: 220 },
  _spriteFrame: { __uuid__: "944ba824-abf8-404c-a182-e349dfc819b4@f9941", __expectedType__: "cc.SpriteFrame" } // BlackSquare
});

// Result Content Card
const resultCardNodeId = builder.createNode("Card", resultNodeId, { layer: 33554432, pos: [0, 50, 0] });
builder.addComponent(resultCardNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 560, height: 500 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resultCardNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 25, g: 35, b: 55, a: 250 },
  _spriteFrame: { __uuid__: "4ee02e49-05bb-4fee-ab83-c37087c80ffb@f9941", __expectedType__: "cc.SpriteFrame" },
  _type: 1
});

// Result Title
const resTitleNodeId = builder.createNode("Title", resultCardNodeId, { layer: 33554432, pos: [0, 160, 0] });
builder.addComponent(resTitleNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 500, height: 70 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
const resTitleCompId = builder.addComponent(resTitleNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "🎉 VICTORY! 🎉",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 44,
  _fontSize: 44,
  _lineHeight: 52,
  _color: { __type__: "cc.Color", r: 255, g: 225, b: 80, a: 255 },
  _isBold: true,
  _enableOutline: true,
  _outlineColor: { __type__: "cc.Color", r: 20, g: 30, b: 40, a: 255 },
  _outlineWidth: 3
});

// Result Subtitle
const resSubtitleNodeId = builder.createNode("Subtitle", resultCardNodeId, { layer: 33554432, pos: [0, 75, 0] });
builder.addComponent(resSubtitleNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 480, height: 60 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resSubtitleNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "Stage Cleared!\nDownload now to experience 100+ levels!",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 20,
  _fontSize: 20,
  _lineHeight: 26,
  _color: { __type__: "cc.Color", r: 230, g: 240, b: 255, a: 255 }
});

// Result Replay Button
const resReplayBtnNodeId = builder.createNode("ReplayBtn", resultCardNodeId, { layer: 33554432, pos: [-130, -80, 0] });
builder.addComponent(resReplayBtnNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 210, height: 65 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resReplayBtnNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 70, g: 85, b: 110, a: 255 },
  _spriteFrame: { __uuid__: "4ee02e49-05bb-4fee-ab83-c37087c80ffb@f9941", __expectedType__: "cc.SpriteFrame" },
  _type: 1
});
builder.addComponent(resReplayBtnNodeId, {
  __type__: "cc.Button",
  _enabled: true,
  _transition: 1,
  _zoomScale: 1.1,
  _target: { __id__: resReplayBtnNodeId }
});
const resReplayLabelNodeId = builder.createNode("Label", resReplayBtnNodeId, { layer: 33554432, pos: [0, 0, 0] });
builder.addComponent(resReplayLabelNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 190, height: 40 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resReplayLabelNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "PLAY AGAIN 🔄",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 19,
  _fontSize: 19,
  _lineHeight: 24,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _isBold: true
});

// Result Install Button
const resInstallBtnNodeId = builder.createNode("InstallBtn", resultCardNodeId, { layer: 33554432, pos: [130, -80, 0] });
builder.addComponent(resInstallBtnNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 230, height: 75 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resInstallBtnNodeId, {
  __type__: "cc.Sprite",
  _enabled: true,
  _color: { __type__: "cc.Color", r: 35, g: 195, b: 90, a: 255 },
  _spriteFrame: { __uuid__: "4ee02e49-05bb-4fee-ab83-c37087c80ffb@f9941", __expectedType__: "cc.SpriteFrame" },
  _type: 1
});
builder.addComponent(resInstallBtnNodeId, {
  __type__: "cc.Button",
  _enabled: true,
  _transition: 1,
  _zoomScale: 1.1,
  _target: { __id__: resInstallBtnNodeId }
});
const resInstallLabelNodeId = builder.createNode("Label", resInstallBtnNodeId, { layer: 33554432, pos: [0, 0, 0] });
builder.addComponent(resInstallLabelNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 210, height: 50 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 }
});
builder.addComponent(resInstallLabelNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "DOWNLOAD ➔",
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 22,
  _fontSize: 22,
  _lineHeight: 28,
  _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
  _isBold: true
});

// UI: Tracking Debug Label
const debugNodeId = builder.createNode("DebugTrackingHUD", canvasNodeId, {
  layer: 33554432,
  pos: [-220, -590, 0]
});
builder.addComponent(debugNodeId, {
  __type__: "cc.UITransform",
  _contentSize: { __type__: "cc.Size", width: 260, height: 60 },
  _anchorPoint: { __type__: "cc.Vec2", x: 0, y: 0 }
});
builder.addComponent(debugNodeId, {
  __type__: "cc.Widget",
  _alignFlags: 12, // Bottom-Left
  _bottom: 10,
  _left: 10,
  _isAbsBottom: true,
  _isAbsLeft: true
});
const debugLabelCompId = builder.addComponent(debugNodeId, {
  __type__: "cc.Label",
  _enabled: true,
  _string: "[TRACK] READY",
  _horizontalAlign: 0,
  _verticalAlign: 0,
  _actualFontSize: 12,
  _fontSize: 12,
  _lineHeight: 15,
  _color: { __type__: "cc.Color", r: 180, g: 190, b: 210, a: 180 }
});

// 6. Controllers Node & Wired Components
const ctrlNodeId = builder.createNode("PlayableControllers", sceneId, { pos: [0, 0, 0] });

// PlayableCTAController
const ctaCtrlCompId = builder.addComponent(ctrlNodeId, {
  __type__: compressUuid("739f152b-492a-4e52-be70-9a58cea6bf9a"),
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  googlePlayUrl: "https://play.google.com/store/apps/details?id=com.playable.ad",
  appStoreUrl: "https://apps.apple.com/app/id123456789",
  ctaButtonNode: { __id__: ctaBtnNodeId },
  enableButtonPulse: true,
  autoRedirectDelay: 0
});

// PlayableAudioController
const audioCtrlCompId = builder.addComponent(ctrlNodeId, {
  __type__: compressUuid("8926f415-292c-44e3-8f87-7d1ee0629544"),
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  bgmClip: { __uuid__: "c0629030-c2e8-4253-98a0-3ffce5119898", __expectedType__: "cc.AudioClip" },
  clickSfx: { __uuid__: "4e5a32ed-8449-41b8-892e-b757dba1aebf", __expectedType__: "cc.AudioClip" },
  successSfx: { __uuid__: "957515fa-ac1b-4c37-8dc7-8ef5a8a1fe98", __expectedType__: "cc.AudioClip" },
  winSfx: { __uuid__: "0d000ca7-a220-4b72-9300-4053963d5464", __expectedType__: "cc.AudioClip" },
  autoPlayBgm: true,
  bgmVolume: 0.6,
  sfxVolume: 1.0
});

// PlayableTrackingController
const trackCtrlCompId = builder.addComponent(ctrlNodeId, {
  __type__: compressUuid("4a6aaafe-910b-4cac-aa3d-5acfeb885055"),
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  debugEventLabel: { __id__: debugLabelCompId },
  enableHeartbeat: true,
  heartbeatInterval: 5
});

// CameraController
const camCtrlCompId = builder.addComponent(ctrlNodeId, {
  __type__: compressUuid("a421f7f7-4c1a-4644-9004-c40d0f935a4b"),
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  mainCamera: { __id__: mainCamCompId },
  subCamera: { __id__: topDownCamCompId },
  uiCamera: { __id__: uiCamCompId },
  transitionDuration: 0.5
});

// PlayableUIHUD
const hudCompId = builder.addComponent(ctrlNodeId, {
  __type__: compressUuid("afd5ce14-9bdf-4b2a-a60b-86783d9175f3"),
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  titleLabel: { __id__: titleLabelCompId },
  subtitleLabel: { __id__: subtitleLabelCompId },
  tapCounterLabel: { __id__: tapCounterLabelCompId },
  cameraSwitchBtn: { __id__: camBtnNodeId },
  cameraSwitchLabel: { __id__: camBtnLabelCompId },
  audioToggleBtn: { __id__: audioBtnNodeId },
  audioToggleLabel: { __id__: audioBtnLabelCompId },
  tutorialHandNode: { __id__: handNodeId },
  resultScreenNode: { __id__: resultNodeId },
  resultTitleLabel: { __id__: resTitleCompId },
  resultInstallBtn: { __id__: resInstallBtnNodeId },
  resultReplayBtn: { __id__: resReplayBtnNodeId }
});

// PlayableEntry (Master Controller)
builder.addComponent(ctrlNodeId, {
  __type__: compressUuid("225b9665-e883-419b-b872-c2956c6e8094"),
  _name: "",
  _objFlags: 0,
  __editorExtras__: {},
  _enabled: true,
  __prefab: null,
  ctaController: { __id__: ctaCtrlCompId },
  audioController: { __id__: audioCtrlCompId },
  trackingController: { __id__: trackCtrlCompId },
  cameraController: { __id__: camCtrlCompId },
  hud: { __id__: hudCompId },
  hero: { __id__: heroCompId },
  targetTaps: 3
});

// Save Boilerplate.scene
const sceneJson = JSON.stringify(builder.items, null, 2);
fs.writeFileSync(path.join(__dirname, '../../assets/Boilerplate.scene'), sceneJson, 'utf8');
console.log('Boilerplate.scene successfully generated with ' + builder.items.length + ' entities.');
