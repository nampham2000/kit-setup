#!/usr/bin/env node
'use strict';

// Bỏ escape ANSI khi output bị pipe (tiết kiệm token cho AI agent).
require('./lib/auto-strip-ansi.cjs');

/**
 * Unity Scene -> Cocos Placeholder Scene.
 *
 * Kit đã port được prefab nhưng KHÔNG có đường nào cho file .unity. Tool này lấp
 * chỗ đó theo mô hình placeholder-then-wire:
 *
 *   1. Tool sinh phần KHÔNG cần UUID: cây node, transform, trạng thái active,
 *      và các component Cocos có sẵn tương đương (Camera, Label, Sprite rỗng...).
 *   2. Tool KHÔNG tự đoán asset. Mọi tham chiếu (sprite, material, font, script,
 *      animation, particle) để trống và được liệt kê trong file wiring.
 *   3. AI agent đọc wiring rồi nối dữ liệu qua cocos-mcp hoặc sửa scene trực tiếp.
 *
 * Vì sao tách đôi: nối UUID là chỗ port prefab dễ vỡ nhất (`port.prefab` phải yêu
 * cầu Cocos Creator đang mở mới nối được UUID sub-asset). Sinh hình học trước rồi
 * để agent nối sau thì bước sinh không phụ thuộc editor, còn bước nối thì có toàn
 * bộ ngữ cảnh Unity nằm sẵn trong wiring.
 *
 * Usage:
 *   node playable-shared-kit/tools/unity-scene-port.cjs \
 *     --scene <Scene.unity> --unity-root <UnityAssetsFolder> \
 *     --out assets/Ported.scene [--manifest <path>] [--template assets/Boilerplate.scene]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseUnityFile } = require('./lib/unity-yaml.cjs');

const USAGE = `Unity Scene -> Cocos Placeholder Scene

Usage:
  node playable-shared-kit/tools/unity-scene-port.cjs --scene <file.unity> --unity-root <Assets> --out <file.scene>
  npm run port:scene -- --scene <file.unity> --unity-root <Assets> --out assets/Ported.scene

Options:
  --scene <file>       Scene Unity cần port (.unity). BẮT BUỘC.
  --unity-root <dir>   Thư mục Assets của Unity, để giải guid -> tên asset. BẮT BUỘC.
  --out <file>         Đường dẫn .scene sinh ra. BẮT BUỘC.
  --manifest <file>    Nơi ghi wiring JSON. Default: cạnh --out, đuôi .wiring.json
  --template <file>    Scene lấy render settings (globals). Default: tự tìm trong assets/.
  --json               Xuất tóm tắt dạng JSON.
  --help               Hiện trợ giúp và thoát.

Sinh ra HÌNH HỌC (node, transform, component không cần asset). KHÔNG nối asset —
mọi tham chiếu nằm trong file wiring để agent xử lý tiếp.`;

// ─────────────────────────────────────────────────────────── helpers ──

function findProjectRoot (startDir) {
    let current = path.resolve(startDir);
    for (;;) {
        if (fs.existsSync(path.join(current, 'package.json'))
            && (fs.existsSync(path.join(current, 'assets')) || fs.existsSync(path.join(current, 'configs')))) return current;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
    ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
    : (findProjectRoot(process.cwd()) || process.cwd());

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const vec3 = (o, d = 0) => ({ x: num(o && o.x, d), y: num(o && o.y, d), z: num(o && o.z, d) });

/**
 * Unity thuận tay trái, camera nhìn theo +Z; Cocos thuận tay phải, camera nhìn
 * theo -Z. Lật Z ở vị trí và đảo dấu X/Y của quaternion cho ra ảnh giống hệt.
 */
const mirrorPos = (o) => ({ __type__: 'cc.Vec3', x: num(o && o.x), y: num(o && o.y), z: -num(o && o.z) });
const mirrorRot = (o) => ({
    __type__: 'cc.Quat',
    x: -num(o && o.x), y: -num(o && o.y), z: num(o && o.z), w: num(o && o.w, 1),
});

/** Unity đóng gói màu TextMesh thành một uint32 RGBA little-endian. */
function rgbaUint (o) {
    const n = (o && typeof o.rgba === 'number') ? o.rgba >>> 0 : 0xffffffff;
    return { r: n & 0xff, g: (n >>> 8) & 0xff, b: (n >>> 16) & 0xff, a: (n >>> 24) & 0xff };
}
const color255 = (o, a = 255) => ({
    __type__: 'cc.Color',
    r: Math.round(num(o && o.r, 1) * 255),
    g: Math.round(num(o && o.g, 1) * 255),
    b: Math.round(num(o && o.b, 1) * 255),
    a: Math.round(num(o && o.a, 1) * a),
});

/** Quét project Unity một lần, map guid -> đường dẫn asset. */
function buildGuidIndex (root) {
    const byGuid = new Map();
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { stack.push(full); continue; }
            if (!entry.name.endsWith('.meta')) continue;
            let head;
            try { head = fs.readFileSync(full, 'utf8').slice(0, 4096); } catch (err) { continue; }
            const m = /^guid:\s*([0-9a-f]+)/m.exec(head);
            if (m) byGuid.set(m[1], full.slice(0, -5));
        }
    }
    return byGuid;
}

const LAYER_DEFAULT = 1073741824;   // cc.Layers.Enum.DEFAULT
const LAYER_UI_2D = 33554432;       // cc.Layers.Enum.UI_2D

// ────────────────────────────────────────────────────── scene builder ──

/** Bộ dựng mảng tuần tự hoá của Cocos: mọi phần tử tham chiếu nhau bằng __id__. */
class SceneWriter {
    constructor (name) {
        this.items = [];
        this.items.push({
            __type__: 'cc.SceneAsset',
            _name: name,
            _objFlags: 0,
            __editorExtras__: {},
            _native: '',
            scene: { __id__: 1 },
        });
        this.scene = {
            __type__: 'cc.Scene',
            _name: name,
            _objFlags: 0,
            __editorExtras__: {},
            _parent: null,
            _children: [],
            _active: true,
            _components: [],
            _prefab: null,
            _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
            _mobility: 0,
            _layer: LAYER_DEFAULT,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            autoReleaseAssets: false,
            _globals: null,
            _id: crypto.randomUUID(),
        };
        this.items.push(this.scene);
    }

    push (obj) { this.items.push(obj); return this.items.length - 1; }

    /**
     * Sao chép nguyên vẹn cụm object mà `rootId` trỏ tới, đánh số lại __id__.
     * Dùng cho `_globals`: hình dạng cc.SceneGlobals thay đổi theo phiên bản
     * engine, nên chép từ scene có sẵn an toàn hơn là tự dựng.
     */
    copySubgraph (sourceItems, rootId) {
        const remap = new Map();
        const visit = (id) => {
            if (remap.has(id)) return remap.get(id);
            const newId = this.items.length;
            remap.set(id, newId);
            this.items.push(null);                       // giữ chỗ trước khi đệ quy
            const copy = JSON.parse(JSON.stringify(sourceItems[id]));
            rewrite(copy);
            this.items[newId] = copy;
            return newId;
        };
        const rewrite = (value) => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) { value.forEach(rewrite); return; }
            if (typeof value.__id__ === 'number' && Object.keys(value).length === 1) {
                value.__id__ = visit(value.__id__);
                return;
            }
            for (const k of Object.keys(value)) rewrite(value[k]);
        };
        return visit(rootId);
    }
}

/** Tìm một scene có sẵn để mượn render settings. */
function findTemplateScene (explicit) {
    if (explicit) return path.resolve(ROOT_DIR, explicit);
    const assets = path.join(ROOT_DIR, 'assets');
    let found = null;
    const stack = [assets];
    while (stack.length && !found) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { stack.push(full); continue; }
            if (entry.name.endsWith('.scene')) { found = full; break; }
        }
    }
    return found;
}

// ──────────────────────────────────────────────────────────── porting ──

const UI_COMPONENT_GUIDS = {
    fe87c0e1cc204ed48ad3b37840f39efc: 'Image',
    '5f7201a12d95ffc409449d95f23cf332': 'Text',
    '0cd44c1031e13a943bb63640046fad76': 'CanvasScaler',
    dc42784cf147c0c48a680349fa168899: 'GraphicRaycaster',
    '76c392e42b5098c458856cdf6ecaaaa1': 'EventSystem',
    '4f231c4fb786f3946a6b90b886c48677': 'StandaloneInputModule',
};

/**
 * Component uGUI/EventSystem nằm ngoài Assets/ nên không có .cs để lập chỉ mục,
 * và guid của chúng khác nhau giữa các phiên bản package. Nhận diện bằng chữ ký
 * field khi bảng guid không khớp — thà đoán đúng tên còn hơn để `<guid:...>`.
 */
function guessComponentType (fields) {
    if ('m_Text' in fields && 'm_FontData' in fields) return 'Text';
    if ('m_Sprite' in fields && 'm_Type' in fields) return 'Image';
    if ('m_UiScaleMode' in fields) return 'CanvasScaler';
    if ('m_IgnoreReversedGraphics' in fields) return 'GraphicRaycaster';
    if ('m_FirstSelected' in fields) return 'EventSystem';
    if ('m_HorizontalAxis' in fields) return 'StandaloneInputModule';
    if ('sharedProfile' in fields && 'blendDistance' in fields) return 'PostProcessVolume';
    if ('volumeTrigger' in fields && 'antialiasingMode' in fields) return 'PostProcessLayer';
    return null;
}

const MB_INTERNAL = new Set([
    'm_ObjectHideFlags', 'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
    'm_GameObject', 'm_Enabled', 'm_EditorHideFlags', 'm_Script', 'm_Name', 'm_EditorClassIdentifier',
]);

function portScene (options) {
    const guidIndex = buildGuidIndex(path.resolve(options.unityRoot));
    const scriptNames = new Map();
    for (const [guid, file] of guidIndex) {
        if (file.endsWith('.cs')) scriptNames.set(guid, path.basename(file, '.cs'));
    }

    const docs = parseUnityFile(fs.readFileSync(options.scene, 'utf8'));
    const byId = new Map(docs.map((d) => [d.fileID, d]));
    const compsOf = new Map();
    for (const d of docs) {
        const go = d.data && d.data.m_GameObject;
        if (!go || !go.fileID) continue;
        const key = String(go.fileID);
        if (!compsOf.has(key)) compsOf.set(key, []);
        compsOf.get(key).push(d);
    }

    const sceneName = path.basename(options.out, '.scene');
    const writer = new SceneWriter(sceneName);

    // Render settings: mượn từ scene có sẵn của project.
    const templatePath = findTemplateScene(options.template);
    if (templatePath && fs.existsSync(templatePath)) {
        try {
            const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
            const tScene = template.find((it) => it && it.__type__ === 'cc.Scene');
            if (tScene && tScene._globals && typeof tScene._globals.__id__ === 'number') {
                writer.scene._globals = { __id__: writer.copySubgraph(template, tScene._globals.__id__) };
            }
        } catch (e) { /* scene vẫn hợp lệ khi thiếu globals */ }
    }

    const wiring = {
        _meta: {
            tool: 'unity-scene-port',
            unityScene: path.basename(options.scene),
            cocosScene: path.relative(ROOT_DIR, path.resolve(options.out)).replace(/\\/g, '/'),
            generatedFor: 'AI agent — nối asset theo danh sách bên dưới rồi lưu scene lại.',
            howToWire: [
                'Node được địa chỉ bằng `path` (đường dẫn tên trong cây) hoặc `sceneItemId` (__id__ trong mảng .scene).',
                'Dùng cocos-mcp: node_find_node_by_name -> component_add_component -> component_set_component_property.',
                'Hoặc sửa thẳng .scene rồi để Cocos Creator import lại.',
            ],
        },
        stats: {},
        nodes: [],
        unresolved: { scripts: [], sprites: [], materials: [], fonts: [], animators: [], particles: [], other: [] },
    };

    const stats = {
        gameObjects: 0, cameras: 0, labels: 0, sprites: 0, canvases: 0,
        monoBehaviours: 0, animators: 0, particles: 0,
    };

    /** Giải `{fileID, guid}` thành mô tả asset cho wiring. */
    function describeAsset (ref) {
        if (!ref || !ref.guid) return null;
        const file = guidIndex.get(ref.guid);
        return {
            guid: ref.guid,
            fileID: String(ref.fileID),
            unityPath: file ? path.relative(path.resolve(options.unityRoot), file).replace(/\\/g, '/') : null,
            name: file ? path.basename(file, path.extname(file)) : null,
        };
    }

    function emitNode (trDoc, parentSceneId, parentPath) {
        const goRef = trDoc.data.m_GameObject;
        const go = byId.get(String(goRef.fileID));
        if (!go) return;
        stats.gameObjects += 1;

        const name = String(go.data.m_Name === null || go.data.m_Name === undefined ? 'Node' : go.data.m_Name);
        const nodePath = parentPath ? `${parentPath}/${name}` : name;
        const isRect = trDoc.classId === 224;

        const node = {
            __type__: 'cc.Node',
            _name: name,
            _objFlags: 0,
            __editorExtras__: {},
            _parent: { __id__: parentSceneId },
            _children: [],
            _active: num(go.data.m_IsActive, 1) !== 0,
            _components: [],
            _prefab: null,
            _lpos: mirrorPos(trDoc.data.m_LocalPosition),
            _lrot: mirrorRot(trDoc.data.m_LocalRotation),
            _lscale: { __type__: 'cc.Vec3', ...vec3(trDoc.data.m_LocalScale, 1) },
            _mobility: 0,
            _layer: isRect ? LAYER_UI_2D : LAYER_DEFAULT,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _id: crypto.randomUUID(),
        };
        const nodeId = writer.push(node);

        const record = { path: nodePath, sceneItemId: nodeId, components: [] };

        for (const c of (compsOf.get(String(goRef.fileID)) || [])) {
            switch (c.classId) {
                case 20: {  // Camera — Cocos có tương đương đầy đủ, sinh luôn.
                    const cam = c.data;
                    node._components.push({ __id__: writer.push({
                        __type__: 'cc.Camera',
                        _name: '', _objFlags: 0, __editorExtras__: {}, node: { __id__: nodeId }, _enabled: true, __prefab: null,
                        _projection: num(cam.orthographic, 0) !== 0 ? 0 : 1,
                        _priority: 0,
                        _fov: num(cam['field of view'], 45),
                        _fovAxis: 0,
                        _orthoHeight: num(cam['orthographic size'], 10),
                        _near: num(cam['near clip plane'], 1),
                        _far: num(cam['far clip plane'], 1000),
                        _color: color255(cam.m_BackGroundColor),
                        _depth: 1,
                        _stencil: 0,
                        _clearFlags: 7,
                        _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 },
                        _aperture: 19, _shutter: 7, _iso: 0,
                        _screenScale: 1,
                        _visibility: LAYER_DEFAULT | LAYER_UI_2D,
                        _targetTexture: null,
                        _postProcess: null,
                        _usePostProcess: false,
                        _cameraType: -1,
                        _trackingType: 0,
                        _id: crypto.randomUUID(),
                    }) });
                    stats.cameras += 1;
                    record.components.push('cc.Camera');
                    break;
                }
                case 223: {  // Canvas
                    node._components.push({ __id__: writer.push({
                        __type__: 'cc.UITransform',
                        _name: '', _objFlags: 0, __editorExtras__: {}, node: { __id__: nodeId }, _enabled: true, __prefab: null,
                        _contentSize: { __type__: 'cc.Size', width: 960, height: 640 },
                        _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
                        _id: crypto.randomUUID(),
                    }) });
                    stats.canvases += 1;
                    record.components.push('cc.UITransform (Canvas — cần agent gắn cc.Canvas + camera)');
                    wiring.unresolved.other.push({
                        path: nodePath, sceneItemId: nodeId, unityComponent: 'Canvas',
                        todo: 'Gắn cc.Canvas và trỏ cameraComponent tới một Camera UI. Cocos không suy ra được render mode của Unity.',
                    });
                    break;
                }
                case 212: {  // SpriteRenderer -> Sprite rỗng + UITransform
                    const sprite = describeAsset(c.data.m_Sprite);
                    node._components.push({ __id__: writer.push(makeUITransform(nodeId, 100, 100)) });
                    node._components.push({ __id__: writer.push({
                        __type__: 'cc.Sprite',
                        _name: '', _objFlags: 0, __editorExtras__: {}, node: { __id__: nodeId }, _enabled: true, __prefab: null,
                        _customMaterial: null,
                        _srcBlendFactor: 2, _dstBlendFactor: 4,
                        _color: color255(c.data.m_Color),
                        _spriteFrame: null,                       // <- agent nối
                        _type: 0, _fillType: 0,
                        _sizeMode: 1,
                        _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
                        _fillStart: 0, _fillRange: 0, _isTrimmedMode: true,
                        _useGrayscale: false, _atlas: null,
                        _id: crypto.randomUUID(),
                    }) });
                    stats.sprites += 1;
                    record.components.push('cc.Sprite (spriteFrame = null)');
                    wiring.unresolved.sprites.push({
                        path: nodePath, sceneItemId: nodeId,
                        sprite,
                        material: describeAsset(Array.isArray(c.data.m_Materials) ? c.data.m_Materials[0] : null),
                        flipX: num(c.data.m_FlipX, 0) !== 0,
                        flipY: num(c.data.m_FlipY, 0) !== 0,
                        sortingOrder: num(c.data.m_SortingOrder, 0),
                        maskInteraction: num(c.data.m_MaskInteraction, 0),
                        todo: 'Import texture vào assets/, gán _spriteFrame. Nếu material Unity dùng shader tuỳ biến thì port shader rồi gán customMaterial.',
                    });
                    break;
                }
                case 102: {  // TextMesh -> Label
                    const t = c.data;
                    const col = rgbaUint(t.m_Color);
                    node._components.push({ __id__: writer.push(makeUITransform(nodeId, 200, 60)) });
                    node._components.push({ __id__: writer.push({
                        __type__: 'cc.Label',
                        _name: '', _objFlags: 0, __editorExtras__: {}, node: { __id__: nodeId }, _enabled: true, __prefab: null,
                        _customMaterial: null,
                        _srcBlendFactor: 2, _dstBlendFactor: 4,
                        _color: { __type__: 'cc.Color', r: col.r, g: col.g, b: col.b, a: col.a },
                        _string: String(t.m_Text === null || t.m_Text === undefined ? '' : t.m_Text),
                        _horizontalAlign: [0, 2, 1][num(t.m_Alignment, 0)] ?? 0,
                        _verticalAlign: 1,
                        _actualFontSize: num(t.m_FontSize, 40) || 40,
                        _fontSize: num(t.m_FontSize, 40) || 40,
                        _fontFamily: 'Arial',
                        _lineHeight: (num(t.m_FontSize, 40) || 40) * num(t.m_LineSpacing, 1),
                        _overflow: 0, _enableWrapText: false,
                        _font: null,                              // <- agent nối nếu cần font tuỳ biến
                        _isSystemFontUsed: true,
                        _spacingX: 0, _isItalic: false, _isBold: false, _isUnderline: false, _underlineHeight: 2,
                        _cacheMode: 0, _enableOutline: false,
                        _outlineColor: { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 255 }, _outlineWidth: 2,
                        _enableShadow: false,
                        _shadowColor: { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 255 },
                        _shadowOffset: { __type__: 'cc.Vec2', x: 2, y: 2 }, _shadowBlur: 2,
                        _id: crypto.randomUUID(),
                    }) });
                    stats.labels += 1;
                    record.components.push('cc.Label');
                    // TextMesh của Unity đo theo world unit; Cocos đo theo pixel.
                    const font = describeAsset(t.m_Font);
                    if (font && font.name && font.name !== 'Arial') {
                        wiring.unresolved.fonts.push({
                            path: nodePath, sceneItemId: nodeId, font,
                            todo: `Copy ${font.unityPath || font.name} vào assets/, gán _font và đặt _isSystemFontUsed=false.`,
                        });
                    }
                    wiring.unresolved.other.push({
                        path: nodePath, sceneItemId: nodeId, unityComponent: 'TextMesh',
                        characterSize: num(t.m_CharacterSize, 1),
                        anchor: num(t.m_Anchor, 0),
                        todo: 'TextMesh đo bằng world unit: chiều cao dòng = fontSize * characterSize * 0.1. Đặt scale node = characterSize*0.1 và anchorPoint theo m_Anchor (0..8: 0-2 trên, 3-5 giữa, 6-8 dưới).',
                    });
                    break;
                }
                case 95: {  // Animator
                    stats.animators += 1;
                    wiring.unresolved.animators.push({
                        path: nodePath, sceneItemId: nodeId,
                        controller: describeAsset(c.data.m_Controller),
                        speed: num(c.data.m_Speed, 1),
                        todo: 'Cocos không đọc AnimatorController. Trích clip từ .controller -> .anim rồi dựng lại bằng cc.Animation hoặc tween.',
                    });
                    break;
                }
                case 198: {  // ParticleSystem
                    stats.particles += 1;
                    wiring.unresolved.particles.push({
                        path: nodePath, sceneItemId: nodeId,
                        duration: num(c.data.lengthInSec, 5),
                        looping: num(c.data.looping, 1) !== 0,
                        todo: 'Dựng lại bằng cc.ParticleSystem (3D) hoặc cc.ParticleSystem2D. Module over-lifetime của Unity không có ánh xạ trực tiếp.',
                    });
                    break;
                }
                case 114: {  // MonoBehaviour
                    stats.monoBehaviours += 1;
                    const guid = c.data.m_Script && c.data.m_Script.guid;
                    const fields = {};
                    for (const [k, v] of Object.entries(c.data)) {
                        if (MB_INTERNAL.has(k)) continue;
                        fields[k] = v;
                    }
                    const type = scriptNames.get(guid) || UI_COMPONENT_GUIDS[guid] || guessComponentType(c.data);
                    wiring.unresolved.scripts.push({
                        path: nodePath, sceneItemId: nodeId,
                        type: type || `<guid:${guid}>`,
                        resolved: !!type,
                        csFile: guid && guidIndex.get(guid)
                            ? path.relative(path.resolve(options.unityRoot), guidIndex.get(guid)).replace(/\\/g, '/')
                            : null,
                        enabled: num(c.data.m_Enabled, 1) !== 0,
                        fields,
                        todo: type
                            ? `Port ${type}.cs sang TypeScript (npm run port:compile), gắn component rồi set các field ở trên.`
                            : 'Script nằm ngoài Assets/ (package hoặc DLL) — không có .cs để port, phải viết lại bằng TypeScript.',
                    });
                    break;
                }
                default: break;
            }
        }

        wiring.nodes.push(record);

        for (const ch of (Array.isArray(trDoc.data.m_Children) ? trDoc.data.m_Children : [])) {
            const chDoc = byId.get(String(ch.fileID));
            if (chDoc) {
                const childId = writer.items.length;
                emitNode(chDoc, nodeId, nodePath);
                if (writer.items[childId]) node._children.push({ __id__: childId });
            }
        }
    }

    function makeUITransform (nodeId, w, h) {
        return {
            __type__: 'cc.UITransform',
            _name: '', _objFlags: 0, __editorExtras__: {}, node: { __id__: nodeId }, _enabled: true, __prefab: null,
            _contentSize: { __type__: 'cc.Size', width: w, height: h },
            _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
            _id: crypto.randomUUID(),
        };
    }

    // Gốc = Transform/RectTransform không có cha. Phải tính cả 224, nếu không
    // toàn bộ cây Canvas biến mất.
    const roots = docs.filter((d) => (d.classId === 4 || d.classId === 224)
        && (!d.data.m_Father || !d.data.m_Father.fileID));
    for (const rootTr of roots) {
        const childId = writer.items.length;
        emitNode(rootTr, 1, '');
        if (writer.items[childId]) writer.scene._children.push({ __id__: childId });
    }

    wiring.stats = stats;
    wiring.stats.unresolvedTotal = Object.values(wiring.unresolved).reduce((a, x) => a + x.length, 0);
    wiring.todo = summariseWork(wiring.unresolved);
    wiring.stats.distinctTasks = wiring.todo.length;
    return { items: writer.items, wiring, templatePath };
}

/**
 * Gom danh sách per-node thành danh sách việc theo ASSET.
 *
 * Bản per-node cần thiết để set property, nhưng đọc thẳng nó thì 171 label dùng
 * chung một font hiện thành 168 việc. Agent cần biết "import 1 font", không phải
 * "làm 168 task". Mỗi mục ở đây là một đơn vị công việc thật, kèm danh sách node
 * bị ảnh hưởng.
 */
function summariseWork (unresolved) {
    const groups = new Map();

    const add = (kind, key, label, sample, nodePath) => {
        const id = `${kind}::${key}`;
        if (!groups.has(id)) {
            groups.set(id, { kind, key, label, ...sample, nodeCount: 0, nodes: [] });
        }
        const g = groups.get(id);
        g.nodeCount += 1;
        if (g.nodes.length < 8) g.nodes.push(nodePath);
        return g;
    };

    for (const s of unresolved.scripts) {
        add('script', s.type, s.type, { csFile: s.csFile, resolved: s.resolved, todo: s.todo }, s.path);
    }
    for (const s of unresolved.sprites) {
        const key = (s.sprite && s.sprite.guid) || 'none';
        add('texture', key, (s.sprite && s.sprite.name) || '(không có sprite)',
            { unityPath: s.sprite && s.sprite.unityPath, todo: s.todo }, s.path);
        if (s.material && s.material.guid) {
            add('material', s.material.guid, s.material.name || s.material.guid,
                { unityPath: s.material.unityPath, todo: 'Port material Unity (và shader của nó) sang .mtl/.effect rồi gán customMaterial.' }, s.path);
        }
    }
    for (const f of unresolved.fonts) {
        add('font', f.font.guid, f.font.name || f.font.guid, { unityPath: f.font.unityPath, todo: f.todo }, f.path);
    }
    for (const a of unresolved.animators) {
        const key = (a.controller && a.controller.guid) || 'none';
        add('animator', key, (a.controller && a.controller.name) || '(không có controller)',
            { unityPath: a.controller && a.controller.unityPath, todo: a.todo }, a.path);
    }
    for (const p of unresolved.particles) {
        add('particle', p.path, 'ParticleSystem', { todo: p.todo }, p.path);
    }
    for (const o of unresolved.other) {
        add('note', o.unityComponent, o.unityComponent, { todo: o.todo }, o.path);
    }

    // Việc chạm nhiều node nhất lên trước: đó là việc trả lại nhiều nhất.
    return [...groups.values()].sort((a, b) => b.nodeCount - a.nodeCount);
}

// ─────────────────────────────────────────────────────────────── CLI ──

function parseArgs (argv) {
    const o = { json: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') { o.help = true; continue; }
        if (a === '--json') { o.json = true; continue; }
        if (a === '--scene') { o.scene = argv[++i]; continue; }
        if (a === '--unity-root') { o.unityRoot = argv[++i]; continue; }
        if (a === '--out') { o.out = argv[++i]; continue; }
        if (a === '--manifest') { o.manifest = argv[++i]; continue; }
        if (a === '--template') { o.template = argv[++i]; continue; }
    }
    return o;
}

function main () {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }

    const missing = ['scene', 'unityRoot', 'out'].filter((k) => !options[k]);
    if (missing.length) {
        console.error(`[scene-port] Thiếu tham số bắt buộc: --${missing.join(', --').replace('unityRoot', 'unity-root')}`);
        console.error(USAGE);
        process.exit(2);
    }
    if (!fs.existsSync(options.scene)) {
        console.error(`[scene-port] Không tìm thấy scene: ${options.scene}`);
        process.exit(1);
    }

    const outPath = path.resolve(ROOT_DIR, options.out);
    const manifestPath = options.manifest
        ? path.resolve(ROOT_DIR, options.manifest)
        : outPath.replace(/\.scene$/, '') + '.wiring.json';

    const { items, wiring, templatePath } = portScene(options);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(wiring, null, 2));

    const summary = {
        scene: path.relative(ROOT_DIR, outPath).replace(/\\/g, '/'),
        manifest: path.relative(ROOT_DIR, manifestPath).replace(/\\/g, '/'),
        template: templatePath ? path.relative(ROOT_DIR, templatePath).replace(/\\/g, '/') : null,
        sceneItems: items.length,
        ...wiring.stats,
        unresolved: Object.fromEntries(Object.entries(wiring.unresolved).map(([k, v]) => [k, v.length])),
    };

    if (options.json) { console.log(JSON.stringify(summary, null, 2)); return; }

    console.log('');
    console.log('======================================================');
    console.log(' Unity Scene -> Cocos Placeholder ');
    console.log('======================================================');
    console.log(`scene     ${summary.scene}  (${summary.sceneItems} item)`);
    console.log(`wiring    ${summary.manifest}`);
    console.log(`globals   ${summary.template || '(không mượn được — scene sẽ dùng mặc định)'}`);
    console.log('');
    console.log(`Đã sinh:  ${summary.gameObjects} node, ${summary.cameras} camera, ${summary.sprites} sprite, ${summary.labels} label`);
    console.log(`Cần nối:  ${wiring.stats.distinctTasks} việc (chạm ${wiring.stats.unresolvedTotal} node)`);
    console.log('');
    for (const t of wiring.todo.slice(0, 12)) {
        console.log(`  [${t.kind}] ${t.label}  — ${t.nodeCount} node`);
    }
    if (wiring.todo.length > 12) console.log(`  ... còn ${wiring.todo.length - 12} việc nữa trong wiring JSON`);
    console.log('');
    console.log('Tiếp theo: đọc `todo` trong wiring JSON, nối asset qua cocos-mcp, rồi `npm run ai:verify:assets`.');
    console.log('======================================================');
}

if (require.main === module) main();

module.exports = { portScene };
