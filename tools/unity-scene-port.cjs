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
const { isBinarySerializedFile, parseBinaryUnityFile, binaryDocsToUnityYaml } = require('./lib/unity-serialized-file.cjs');

/** Đọc asset Unity dù là text YAML hay SerializedFile nhị phân. */
function readUnityDocs (file) {
    if (!isBinarySerializedFile(file)) return parseUnityFile(fs.readFileSync(file, 'utf8'));
    const parsed = parseBinaryUnityFile(file);
    if (!parsed.ok) return [];
    return parseUnityFile(binaryDocsToUnityYaml(parsed.docs));
}

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
 * Component uGUI/EventSystem nằm ngoài Assets/ nên không có .cs để lập chỉ mục.
 *
 * Từ khi uGUI thành package có asmdef, MỌI component uGUI dùng CHUNG một guid
 * (`f70555f1…` = UnityEngine.UI.dll) và chỉ khác nhau ở `fileID`. Bảng
 * UI_COMPONENT_GUIDS theo guid vì thế luôn trượt trên project Unity hiện đại —
 * Button/Shadow/Outline đều hiện thành `<guid:f70555f1…>`. Nhận diện bằng chữ
 * ký field là cách duy nhất còn đúng qua các phiên bản.
 */
function guessComponentType (fields) {
    if ('m_Text' in fields && 'm_FontData' in fields) return 'Text';
    if ('m_Sprite' in fields && 'm_Type' in fields) return 'Image';
    if ('m_UiScaleMode' in fields) return 'CanvasScaler';
    if ('m_IgnoreReversedGraphics' in fields) return 'GraphicRaycaster';
    if ('m_FirstSelected' in fields) return 'EventSystem';
    if ('m_HorizontalAxis' in fields) return 'StandaloneInputModule';
    if ('m_OnClick' in fields && 'm_Navigation' in fields) return 'Button';
    if ('m_OnValueChanged' in fields && 'm_IsOn' in fields) return 'Toggle';
    if ('m_OnValueChanged' in fields && 'm_FillRect' in fields) return 'Slider';
    if ('m_Navigation' in fields && 'm_Transition' in fields) return 'Selectable';
    // Outline kế thừa Shadow và serialize y hệt — không phân biệt được, báo cả hai.
    if ('m_EffectColor' in fields && 'm_EffectDistance' in fields) return 'Shadow|Outline';
    if ('m_Padding' in fields && 'm_ChildAlignment' in fields) return 'LayoutGroup';
    if ('m_HorizontalFit' in fields || 'm_VerticalFit' in fields) return 'ContentSizeFitter';
    if ('sharedProfile' in fields && 'blendDistance' in fields) return 'PostProcessVolume';
    if ('volumeTrigger' in fields && 'antialiasingMode' in fields) return 'PostProcessLayer';
    return null;
}

/** Lấy các lời gọi UnityEvent đã lưu (`m_PersistentCalls`) ra dạng phẳng. */
function readPersistentCalls (unityEvent) {
    const calls = unityEvent && unityEvent.m_PersistentCalls && unityEvent.m_PersistentCalls.m_Calls;
    if (!Array.isArray(calls)) return [];
    return calls
        .filter((c) => c && c.m_MethodName)
        .map((c) => ({
            targetFileID: c.m_Target && c.m_Target.fileID != null ? String(c.m_Target.fileID) : '0',
            method: String(c.m_MethodName),
            argument: c.m_Arguments || null,
        }));
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

    const docs = readUnityDocs(options.scene);
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
        unresolved: {
            scripts: [], sprites: [], materials: [], fonts: [], animators: [],
            particles: [], prefabInstances: [], other: [],
        },
    };

    const stats = {
        gameObjects: 0, cameras: 0, labels: 0, sprites: 0, canvases: 0,
        monoBehaviours: 0, animators: 0, particles: 0, prefabInstances: 0,
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

    // ─────────────────────────────────────────── prefab instances ──
    //
    // Prefab được instantiate trong scene KHÔNG có GameObject/Transform đầy đủ
    // trong file .unity. Unity chỉ ghi:
    //   * một doc `PrefabInstance` (classId 1001) chứa m_SourcePrefab + danh
    //     sách m_Modifications (chỉ những field khác prefab gốc), và
    //   * các doc Transform/GameObject "stripped" — RỖNG, chỉ trỏ ngược về
    //     PrefabInstance — để node khác trong scene tham chiếu tới được.
    //
    // Code cũ coi stripped Transform như transform thường (`m_GameObject` là
    // undefined -> crash), và bỏ qua hoàn toàn 1001. Kết quả: mọi scene có
    // prefab instance đều không port được. Ở đây ta dựng lại node từ prefab gốc
    // + modification, rồi ghi vào wiring để agent nối .prefab đã port.

    const prefabInstances = new Map();               // fileID -> doc 1001
    for (const d of docs) if (d.classId === 1001) prefabInstances.set(String(d.fileID), d);

    const emittedPrefabInstances = new Set();
    /** PrefabInstance fileID -> path/sceneItemId, để giải PPtr trong script. */
    const nodePathByStrippedGo = new Map();
    const sceneIdByStrippedGo = new Map();
    /** fileID bất kỳ (GameObject/Transform/Component) -> path của node chứa nó. */
    const objectOwner = new Map();

    /** stripped transform/GameObject fileID -> PrefabInstance fileID */
    const strippedOwner = new Map();
    for (const d of docs) {
        const owner = d.data && d.data.m_PrefabInstance && d.data.m_PrefabInstance.fileID;
        if (owner && String(owner) !== '0') strippedOwner.set(String(d.fileID), String(owner));
    }

    /** Cache prefab gốc đã đọc: guid -> { rootGo, rootTr, name } */
    const prefabRootCache = new Map();
    function readPrefabRoot (guid) {
        if (prefabRootCache.has(guid)) return prefabRootCache.get(guid);
        let info = null;
        const file = guidIndex.get(guid);
        if (file && fs.existsSync(file)) {
            try {
                const pdocs = readUnityDocs(file);
                const pById = new Map(pdocs.map((d) => [String(d.fileID), d]));
                const rootTr = pdocs.find((d) => (d.classId === 4 || d.classId === 224)
                    && d.data.m_GameObject && (!d.data.m_Father || !d.data.m_Father.fileID));
                const rootGo = rootTr ? pById.get(String(rootTr.data.m_GameObject.fileID)) : null;
                if (rootTr) {
                    info = {
                        name: rootGo && rootGo.data.m_Name != null ? String(rootGo.data.m_Name) : path.basename(file, '.prefab'),
                        active: rootGo ? num(rootGo.data.m_IsActive, 1) !== 0 : true,
                        lpos: vec3(rootTr.data.m_LocalPosition),
                        lrot: {
                            x: num(rootTr.data.m_LocalRotation && rootTr.data.m_LocalRotation.x),
                            y: num(rootTr.data.m_LocalRotation && rootTr.data.m_LocalRotation.y),
                            z: num(rootTr.data.m_LocalRotation && rootTr.data.m_LocalRotation.z),
                            w: num(rootTr.data.m_LocalRotation && rootTr.data.m_LocalRotation.w, 1),
                        },
                        lscale: vec3(rootTr.data.m_LocalScale, 1),
                        rootTrId: String(rootTr.fileID),
                        rootGoId: rootGo ? String(rootGo.fileID) : null,
                    };
                }
            } catch (e) { /* prefab hỏng -> coi như không đọc được */ }
        }
        prefabRootCache.set(guid, info);
        return info;
    }

    /**
     * m_Modifications là danh sách phẳng `{target, propertyPath, value,
     * objectReference}`. Chỉ những field trỏ tới ROOT transform / root
     * GameObject mới ảnh hưởng node gốc của instance; phần còn lại là override
     * bên trong prefab, ghi lại nguyên văn cho agent.
     */
    function applyModifications (pi, base) {
        const mods = (pi.data.m_Modification && pi.data.m_Modification.m_Modifications) || [];
        const out = {
            name: base ? base.name : null,
            active: base ? base.active : true,
            lpos: base ? { ...base.lpos } : { x: 0, y: 0, z: 0 },
            lrot: base ? { ...base.lrot } : { x: 0, y: 0, z: 0, w: 1 },
            lscale: base ? { ...base.lscale } : { x: 1, y: 1, z: 1 },
            rootOrder: 0,
            inner: [],
        };
        const rootTargets = new Set([base && base.rootTrId, base && base.rootGoId].filter(Boolean));
        for (const m of Array.isArray(mods) ? mods : []) {
            if (!m || typeof m.propertyPath !== 'string') continue;
            const target = m.target && m.target.fileID != null ? String(m.target.fileID) : '';
            const raw = m.value;
            const n = typeof raw === 'number' ? raw : Number(raw);
            const isRoot = rootTargets.size === 0 || rootTargets.has(target);
            switch (isRoot ? m.propertyPath : '') {
                case 'm_Name': out.name = String(raw); continue;
                case 'm_IsActive': out.active = n !== 0; continue;
                case 'm_LocalPosition.x': out.lpos.x = n; continue;
                case 'm_LocalPosition.y': out.lpos.y = n; continue;
                case 'm_LocalPosition.z': out.lpos.z = n; continue;
                case 'm_LocalRotation.x': out.lrot.x = n; continue;
                case 'm_LocalRotation.y': out.lrot.y = n; continue;
                case 'm_LocalRotation.z': out.lrot.z = n; continue;
                case 'm_LocalRotation.w': out.lrot.w = n; continue;
                case 'm_LocalScale.x': out.lscale.x = n; continue;
                case 'm_LocalScale.y': out.lscale.y = n; continue;
                case 'm_LocalScale.z': out.lscale.z = n; continue;
                case 'm_RootOrder': out.rootOrder = n; continue;
                default: break;
            }
            // Override sâu bên trong prefab: giữ nguyên để agent quyết định.
            if (!/^m_(LocalPosition|LocalRotation|LocalScale|RootOrder|LocalEulerAnglesHint)\./.test(m.propertyPath)) {
                out.inner.push({
                    target,
                    propertyPath: m.propertyPath,
                    value: raw,
                    objectReference: m.objectReference && m.objectReference.fileID
                        ? describeAsset(m.objectReference) : null,
                });
            }
        }
        return out;
    }

    /** Node gốc của một PrefabInstance. Trả về sceneItemId hoặc null. */
    function emitPrefabInstance (pi, parentSceneId, parentPath) {
        const srcRef = pi.data.m_SourcePrefab || pi.data.m_ParentPrefab;
        const guid = srcRef && srcRef.guid;
        const srcFile = guid ? guidIndex.get(guid) : null;
        const base = guid ? readPrefabRoot(guid) : null;
        const mod = applyModifications(pi, base);
        const name = mod.name
            || (srcFile ? path.basename(srcFile, path.extname(srcFile)) : `PrefabInstance_${pi.fileID}`);
        const nodePath = parentPath ? `${parentPath}/${name}` : name;

        const node = {
            __type__: 'cc.Node',
            _name: name,
            _objFlags: 0,
            __editorExtras__: {},
            _parent: { __id__: parentSceneId },
            _children: [],
            _active: mod.active,
            _components: [],
            _prefab: null,                            // <- agent nối cc.PrefabInfo hoặc instantiate runtime
            _lpos: mirrorPos(mod.lpos),
            _lrot: mirrorRot(mod.lrot),
            _lscale: { __type__: 'cc.Vec3', ...mod.lscale },
            _mobility: 0,
            _layer: LAYER_DEFAULT,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _id: crypto.randomUUID(),
        };
        const nodeId = writer.push(node);
        stats.prefabInstances += 1;
        stats.gameObjects += 1;

        nodePathByStrippedGo.set(String(pi.fileID), nodePath);
        sceneIdByStrippedGo.set(String(pi.fileID), nodeId);

        wiring.nodes.push({ path: nodePath, sceneItemId: nodeId, components: ['(prefab instance — chưa nối)'] });
        wiring.unresolved.prefabInstances.push({
            path: nodePath,
            sceneItemId: nodeId,
            active: mod.active,
            sourcePrefab: guid ? describeAsset(srcRef) : null,
            unityPath: srcFile ? path.relative(path.resolve(options.unityRoot), srcFile).replace(/\\/g, '/') : null,
            sourceResolved: !!base,
            rootOrder: mod.rootOrder,
            innerOverrides: mod.inner,
            todo: base
                ? 'Port prefab nguồn (port.prefab) rồi instantiate vào node này — bằng cc.PrefabInfo trong .scene hoặc instantiate lúc runtime.'
                : 'Không đọc được prefab nguồn từ --unity-root. Kiểm tra guid có nằm ngoài thư mục Assets đã truyền không.',
        });
        return nodeId;
    }

    function emitNode (trDoc, parentSceneId, parentPath) {
        const goRef = trDoc.data.m_GameObject;
        if (!goRef || !goRef.fileID) {
            // Transform stripped: node thật thuộc về PrefabInstance sở hữu nó.
            const owner = strippedOwner.get(String(trDoc.fileID));
            const pi = owner ? prefabInstances.get(owner) : null;
            if (pi && !emittedPrefabInstances.has(owner)) {
                emittedPrefabInstances.add(owner);
                return emitPrefabInstance(pi, parentSceneId, parentPath);
            }
            return;
        }
        const go = byId.get(String(goRef.fileID));
        if (!go) return;
        stats.gameObjects += 1;

        const name = String(go.data.m_Name === null || go.data.m_Name === undefined ? 'Node' : go.data.m_Name);
        const nodePath = parentPath ? `${parentPath}/${name}` : name;
        const isRect = trDoc.classId === 224;
        objectOwner.set(String(go.fileID), nodePath);
        objectOwner.set(String(trDoc.fileID), nodePath);
        for (const c of (compsOf.get(String(goRef.fileID)) || [])) objectOwner.set(String(c.fileID), nodePath);

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
                    const record114 = {
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
                    };
                    // UnityEvent đã lưu (onClick của Button...) là thứ nối UI vào
                    // gameplay. Không trích ra thì agent phải tự dò fileID trong .unity.
                    for (const [fieldName, value] of Object.entries(fields)) {
                        const calls = readPersistentCalls(value);
                        if (!calls.length) continue;
                        record114.events = record114.events || {};
                        record114.events[fieldName] = calls;
                    }
                    wiring.unresolved.scripts.push(record114);
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

    /**
     * Giải `{fileID: N}` trong field của MonoBehaviour thành đường dẫn node.
     *
     * Không có bước này, `Demo.FXList` chỉ là 42 con số vô nghĩa và agent phải
     * tự dò tay trong .unity. Tham chiếu tới prefab instance đặc biệt khó: nó
     * trỏ vào GameObject "stripped", phải đi qua m_PrefabInstance mới ra node.
     */
    function resolveSceneObjectRefs () {
        const resolveOne = (v) => {
            if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
            if (v.guid) return null;                  // tham chiếu asset, không phải node
            const id = v.fileID != null ? String(v.fileID) : null;
            if (!id || id === '0') return null;
            if (objectOwner.has(id)) return objectOwner.get(id);
            const owner = strippedOwner.get(id);
            if (owner && nodePathByStrippedGo.has(owner)) return nodePathByStrippedGo.get(owner);
            return null;
        };
        for (const s of wiring.unresolved.scripts) {
            const refs = {};
            for (const [key, value] of Object.entries(s.fields || {})) {
                if (Array.isArray(value)) {
                    const list = value.map(resolveOne);
                    if (list.some(Boolean)) refs[key] = list;
                } else {
                    const one = resolveOne(value);
                    if (one) refs[key] = one;
                }
            }
            if (Object.keys(refs).length) s.nodeRefs = refs;
            for (const calls of Object.values(s.events || {})) {
                for (const call of calls) {
                    const target = resolveOne({ fileID: call.targetFileID });
                    if (target) call.targetPath = target;
                }
            }
        }
    }

    // Gốc = Transform/RectTransform không có cha. Phải tính cả 224, nếu không
    // toàn bộ cây Canvas biến mất. Stripped transform bị loại ở đây: nó KHÔNG
    // có m_Father nên trông như root, nhưng node thật do PrefabInstance sở hữu
    // dựng ra — nếu để lọt thì mọi instance bị nhân đôi ở gốc scene.
    const roots = docs.filter((d) => (d.classId === 4 || d.classId === 224)
        && d.data.m_GameObject && d.data.m_GameObject.fileID
        && (!d.data.m_Father || !d.data.m_Father.fileID));
    for (const rootTr of roots) {
        const childId = writer.items.length;
        emitNode(rootTr, 1, '');
        if (writer.items[childId]) writer.scene._children.push({ __id__: childId });
    }

    // PrefabInstance đặt thẳng ở gốc scene (m_TransformParent = 0) không được
    // transform nào tham chiếu, nên phải duyệt riêng.
    const rootInstances = [...prefabInstances.entries()]
        .filter(([id, pi]) => {
            if (emittedPrefabInstances.has(id)) return false;
            const parent = pi.data.m_Modification && pi.data.m_Modification.m_TransformParent;
            return !parent || !parent.fileID || String(parent.fileID) === '0';
        })
        .sort((a, b) => {
            const order = (pi) => {
                const mods = (pi.data.m_Modification && pi.data.m_Modification.m_Modifications) || [];
                const hit = (Array.isArray(mods) ? mods : []).find((m) => m && m.propertyPath === 'm_RootOrder');
                return hit ? Number(hit.value) : 0;
            };
            return order(a[1]) - order(b[1]);
        });
    for (const [id, pi] of rootInstances) {
        emittedPrefabInstances.add(id);
        const childId = writer.items.length;
        const emitted = emitPrefabInstance(pi, 1, '');
        if (emitted != null && writer.items[childId]) writer.scene._children.push({ __id__: childId });
    }

    resolveSceneObjectRefs();

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
    for (const pi of unresolved.prefabInstances) {
        const key = (pi.sourcePrefab && pi.sourcePrefab.guid) || pi.path;
        add('prefab', key, (pi.sourcePrefab && pi.sourcePrefab.name) || '(prefab nguon khong doc duoc)',
            { unityPath: pi.unityPath, todo: pi.todo }, pi.path);
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
