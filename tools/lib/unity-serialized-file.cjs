'use strict';

/**
 * Unity **binary** SerializedFile reader (type-tree driven).
 *
 * Vì sao cần: `lib/unity-yaml.cjs` chỉ đọc được asset dạng text (`%YAML`). Rất
 * nhiều package Asset Store được ship với Asset Serialization = Force Binary
 * (hoặc Mixed), nên `.mat` / `.asset` / `.prefab` là SerializedFile nhị phân.
 * Trước khi có file này, mọi tool trong kit đều báo "could not be parsed" và
 * lặng lẽ rơi về material mặc định — port trông như thành công nhưng mất texture.
 *
 * Cách hoạt động: file nhị phân của Unity mang theo TYPE TREE (khi
 * `enableTypeTree`), tức là mô tả đầy đủ layout của từng field. Nên đây KHÔNG
 * phải heuristic quét byte: ta đọc type tree rồi giải tuần tự đúng theo nó, ra
 * đúng cấu trúc mà YAML sẽ cho.
 *
 * Giới hạn đã biết:
 *   - `enableTypeTree = 0` (asset đã strip type tree, thường gặp trong bundle
 *     của bản build) thì KHÔNG giải được — hàm trả về `null` kèm lý do.
 *   - PPtr chỉ giải được `guid` khi `m_FileID > 0` (external). `m_FileID = 0`
 *     nghĩa là tham chiếu nội bộ trong cùng file, trả về `fileID/pathID` thô.
 *   - Không đọc được asset nén trong `.unity3d` / AssetBundle.
 */

const fs = require('fs');

/**
 * Bảng chuỗi dùng chung của Unity. Type tree lưu offset vào bảng này khi bit
 * 0x80000000 được set, thay vì vào string buffer riêng của file. Thứ tự phải
 * giữ NGUYÊN VĂN — offset được tính bằng cách nối chuỗi với '\0', nên chỉ cần
 * chèn/xoá một phần tử là mọi tên field sau đó lệch hết.
 */
const COMMON_STRINGS = [
    'AABB', 'AnimationClip', 'AnimationCurve', 'AnimationState', 'Array', 'Base',
    'BitField', 'bitset', 'bool', 'char', 'ColorRGBA', 'Component', 'data',
    'deque', 'double', 'dynamic_array', 'FastPropertyName', 'first', 'float',
    'Font', 'GameObject', 'Generic Mono', 'GradientNEW', 'GUID', 'GUIStyle',
    'int', 'list', 'long long', 'map', 'Matrix4x4f', 'MdFour', 'MonoBehaviour',
    'MonoScript', 'm_ByteSize', 'm_Curve', 'm_EditorClassIdentifier',
    'm_EditorHideFlags', 'm_Enabled', 'm_ExtensionPtr', 'm_GameObject',
    'm_Index', 'm_IsArray', 'm_IsStatic', 'm_MetaFlag', 'm_Name',
    'm_ObjectHideFlags', 'm_PrefabInternal', 'm_PrefabParentObject', 'm_Script',
    'm_StaticEditorFlags', 'm_Type', 'm_Version', 'Object', 'pair',
    'PPtr<Component>', 'PPtr<GameObject>', 'PPtr<Material>',
    'PPtr<MonoBehaviour>', 'PPtr<MonoScript>', 'PPtr<Object>', 'PPtr<Prefab>',
    'PPtr<Sprite>', 'PPtr<TextAsset>', 'PPtr<Texture>', 'PPtr<Texture2D>',
    'PPtr<Transform>', 'Prefab', 'Quaternionf', 'Rectf', 'RectInt',
    'RectOffset', 'second', 'set', 'short', 'size', 'SInt16', 'SInt32',
    'SInt64', 'SInt8', 'staticvector', 'string', 'TextAsset', 'TextMesh',
    'Texture', 'Texture2D', 'Transform', 'TypelessData', 'UInt16', 'UInt32',
    'UInt64', 'UInt8', 'unsigned int', 'unsigned long long', 'unsigned short',
    'vector', 'Vector2f', 'Vector3f', 'Vector4f', 'm_ScriptingClassIdentifier',
    'Gradient', 'Type*', 'int2_storage', 'int3_storage', 'BoundsInt',
    'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
    'FileSize', 'Hash128',
];
const COMMON_BLOB = Buffer.from(COMMON_STRINGS.join('\0') + '\0', 'utf8');

/**
 * Nhận biết SerializedFile nhị phân.
 *
 * KHÔNG dùng "không phải %YAML thì là nhị phân": `.cs`, `.shader`, `.txt` cũng
 * rơi vào đó và sẽ bị báo lỗi parse nhiễu. Kiểm tra đúng chữ ký header: 4 field
 * u32 big-endian đầu tiên, trong đó `version` nằm trong khoảng hợp lệ.
 */
function isBinarySerializedFile (filePath) {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const head = Buffer.alloc(20);
        const read = fs.readSync(fd, head, 0, 20, 0);
        if (read < 20) return false;
        if (head.toString('latin1', 0, 5) === '%YAML') return false;
        const version = head.readUInt32BE(8);
        if (version < 9 || version > 30) return false;
        if (version >= 22) {
            // v22+: ba field legacy đầu phải = 0, kích thước thật nằm sau.
            return head.readUInt32BE(0) === 0 && head.readUInt32BE(4) === 0 && head.readUInt32BE(12) === 0;
        }
        const metadataSize = head.readUInt32BE(0);
        const fileSize = head.readUInt32BE(4);
        const dataOffset = head.readUInt32BE(12);
        const actual = fs.fstatSync(fd).size;
        return metadataSize > 0 && dataOffset > 0 && dataOffset <= actual && fileSize === actual;
    } catch (e) {
        return false;
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
    }
}

class Reader {
    constructor (buf, offset = 0) { this.buf = buf; this.p = offset; }
    u8 () { return this.buf[this.p++]; }
    i8 () { return this.buf.readInt8(this.p++); }
    u16 () { const v = this.buf.readUInt16LE(this.p); this.p += 2; return v; }
    i16 () { const v = this.buf.readInt16LE(this.p); this.p += 2; return v; }
    u32 () { const v = this.buf.readUInt32LE(this.p); this.p += 4; return v; }
    i32 () { const v = this.buf.readInt32LE(this.p); this.p += 4; return v; }
    i64 () { const v = this.buf.readBigInt64LE(this.p); this.p += 8; return Number(v); }
    u64 () { const v = this.buf.readBigUInt64LE(this.p); this.p += 8; return Number(v); }
    f32 () { const v = this.buf.readFloatLE(this.p); this.p += 4; return v; }
    f64 () { const v = this.buf.readDoubleLE(this.p); this.p += 8; return v; }
    bytes (n) { const v = this.buf.subarray(this.p, this.p + n); this.p += n; return v; }
    cstr () {
        const s = this.p;
        while (this.p < this.buf.length && this.buf[this.p] !== 0) this.p += 1;
        const v = this.buf.toString('utf8', s, this.p);
        this.p += 1;
        return v;
    }
    align (n = 4) { const r = this.p % n; if (r) this.p += n - r; }
}

function readNullTerminated (buf, offset) {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) end += 1;
    return buf.toString('utf8', offset, end);
}

/** Offset có bit 0x80000000 -> bảng chung; ngược lại -> string buffer của file. */
function resolveString (offset, localBuf) {
    if (offset & 0x80000000) return readNullTerminated(COMMON_BLOB, offset & 0x7fffffff);
    return readNullTerminated(localBuf, offset);
}

/** Đọc phần header + metadata (types, objects, externals). Không giải data. */
function readMetadata (buf) {
    let p = 0;
    const u32be = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
    /* eslint-disable no-unused-vars */
    const legacyMetadataSize = u32be();
    const legacyFileSize = u32be();
    const version = u32be();
    const legacyDataOffset = u32be();
    /* eslint-enable no-unused-vars */
    if (version < 9 || version > 30) {
        return { error: `unsupported SerializedFile version ${version}` };
    }
    const bigEndianData = buf[p] !== 0;
    p += 4;                                          // endianness + 3 reserved

    let metadataSize = legacyMetadataSize;
    let fileSize = legacyFileSize;
    let dataOffset = legacyDataOffset;
    if (version >= 22) {
        metadataSize = buf.readUInt32BE(p); p += 4;
        fileSize = Number(buf.readBigInt64BE(p)); p += 8;
        dataOffset = Number(buf.readBigInt64BE(p)); p += 8;
        p += 8;                                      // unknown / reserved
    }
    if (bigEndianData) return { error: 'big-endian data section is not supported' };

    const r = new Reader(buf, p);
    const unityVersion = r.cstr();
    const targetPlatform = r.i32();
    const enableTypeTree = version >= 13 ? r.u8() !== 0 : true;

    const typeCount = r.i32();
    const types = [];
    for (let i = 0; i < typeCount; i += 1) types.push(readSerializedType(r, version, enableTypeTree, false));

    const objectCount = r.i32();
    const objects = [];
    for (let i = 0; i < objectCount; i += 1) {
        r.align(4);
        const pathID = r.i64();
        const byteStart = version >= 22 ? r.i64() : r.u32();
        const byteSize = r.u32();
        const typeID = r.i32();
        objects.push({ pathID, byteStart, byteSize, typeID });
    }

    if (version >= 11) {                             // script types (v>=11)
        const scriptCount = r.i32();
        for (let i = 0; i < scriptCount; i += 1) { r.align(4); r.i32(); r.i64(); }
    }

    const externalCount = r.i32();
    const externals = [];
    for (let i = 0; i < externalCount; i += 1) {
        if (version >= 6) r.cstr();                  // tempEmpty
        let guid = null;
        let type = 0;
        if (version >= 5) {
            guid = Buffer.from(r.bytes(16)).toString('hex');
            type = r.i32();
        }
        const pathName = r.cstr();
        externals.push({ guid: normaliseGuid(guid), type, pathName });
    }

    return {
        version, unityVersion, targetPlatform, enableTypeTree,
        metadataSize, fileSize, dataOffset, types, objects, externals,
    };
}

/**
 * GUID trong SerializedFile là 16 byte little-endian theo từng nhóm 4 byte, còn
 * `.meta` ghi guid dạng hex đọc theo nibble. Không hoán vị thì guid không bao
 * giờ khớp bảng index -> texture im lặng không nối được.
 */
function normaliseGuid (hex) {
    if (!hex || hex.length !== 32) return hex;
    let out = '';
    for (let i = 0; i < 32; i += 2) {
        out += hex[i + 1] + hex[i];                  // đảo nibble trong từng byte
    }
    return out;
}

function readSerializedType (r, version, enableTypeTree, isRefType) {
    const classID = r.i32();
    let isStrippedType = false;
    let scriptTypeIndex = -1;
    if (version >= 16) isStrippedType = r.u8() !== 0;
    if (version >= 17) scriptTypeIndex = r.i16();
    if (version >= 13) {
        if ((isRefType && scriptTypeIndex >= 0)
            || (version < 16 && classID < 0)
            || (version >= 16 && classID === 114)) r.bytes(16);   // script hash
        r.bytes(16);                                              // old type hash
    }
    const type = { classID, isStrippedType, scriptTypeIndex, nodes: [], stringBuf: null };
    if (!enableTypeTree) return type;

    if (version >= 12 || version === 10) readTypeTreeBlob(r, version, type);
    else readTypeTreeLegacy(r, type, 0);
    return type;
}

function readTypeTreeBlob (r, version, type) {
    const nodeCount = r.i32();
    const stringBufSize = r.i32();
    const nodeSize = version >= 19 ? 32 : 24;
    const nodeBytes = Buffer.from(r.bytes(nodeCount * nodeSize));
    const stringBuf = Buffer.from(r.bytes(stringBufSize));
    type.stringBuf = stringBuf;
    for (let i = 0; i < nodeCount; i += 1) {
        const o = i * nodeSize;
        type.nodes.push({
            version: nodeBytes.readUInt16LE(o),
            level: nodeBytes.readUInt8(o + 2),
            typeFlags: nodeBytes.readUInt8(o + 3),
            type: resolveString(nodeBytes.readUInt32LE(o + 4), stringBuf),
            name: resolveString(nodeBytes.readUInt32LE(o + 8), stringBuf),
            byteSize: nodeBytes.readInt32LE(o + 12),
            index: nodeBytes.readInt32LE(o + 16),
            metaFlag: nodeBytes.readInt32LE(o + 20),
        });
    }
    if (version >= 21) r.i32();                      // ref type dependencies
}

function readTypeTreeLegacy (r, type, level) {
    const typeName = r.cstr();
    const name = r.cstr();
    const byteSize = r.i32();
    if (type.nodes.length === 0 && false) { /* placeholder to keep shape */ }
    r.i32();                                          // index (varies)
    const typeFlags = r.i32();
    const nodeVersion = r.i32();
    const metaFlag = r.i32();
    type.nodes.push({ version: nodeVersion, level, typeFlags, type: typeName, name, byteSize, index: type.nodes.length, metaFlag });
    const childCount = r.i32();
    for (let i = 0; i < childCount; i += 1) readTypeTreeLegacy(r, type, level + 1);
}

// ─────────────────────────────────────────────────── deserialisation ──

const PRIMITIVES = new Set([
    'SInt8', 'UInt8', 'char', 'SInt16', 'UInt16', 'short', 'unsigned short',
    'SInt32', 'UInt32', 'int', 'unsigned int', 'Type*',
    'SInt64', 'UInt64', 'long long', 'unsigned long long', 'FileSize',
    'float', 'double', 'bool',
]);

function readPrimitive (r, typeName) {
    switch (typeName) {
        case 'SInt8': return r.i8();
        case 'UInt8': case 'char': return r.u8();
        case 'SInt16': case 'short': return r.i16();
        case 'UInt16': case 'unsigned short': return r.u16();
        case 'SInt32': case 'int': return r.i32();
        case 'UInt32': case 'unsigned int': case 'Type*': return r.u32();
        case 'SInt64': case 'long long': return r.i64();
        case 'UInt64': case 'unsigned long long': case 'FileSize': return r.u64();
        case 'float': return r.f32();
        case 'double': return r.f64();
        case 'bool': return r.u8() !== 0;
        default: throw new Error(`not a primitive: ${typeName}`);
    }
}

/**
 * Giải một node của type tree. `cursor` là {i} để con trỏ node đi tiếp được
 * qua các lần đệ quy (nodes là danh sách phẳng có `level`).
 */
function readValue (r, nodes, cursor, externals) {
    const node = nodes[cursor.i];
    cursor.i += 1;
    const align = (node.metaFlag & 0x4000) !== 0;
    let value;

    if (node.type === 'string') {
        skipChildren(nodes, cursor, node.level);
        const len = r.i32();
        value = Buffer.from(r.bytes(len)).toString('utf8');
        r.align(4);
        if (align) r.align(4);
        return { key: node.name, value };
    }

    if ((node.typeFlags & 1) !== 0) {                // node này LÀ array
        // children: [0] size (int), [1] data
        const sizeNode = nodes[cursor.i]; cursor.i += 1;
        const sizeAlign = (sizeNode.metaFlag & 0x4000) !== 0;
        const count = r.i32();
        if (sizeAlign) r.align(4);
        const dataStart = cursor.i;
        const out = [];
        for (let i = 0; i < count; i += 1) {
            cursor.i = dataStart;
            out.push(readValue(r, nodes, cursor, externals).value);
        }
        if (count === 0) { cursor.i = dataStart; skipNode(nodes, cursor); }
        if (align) r.align(4);
        return { key: node.name, value: out };
    }

    if (PRIMITIVES.has(node.type)) {
        value = readPrimitive(r, node.type);
        if (align) r.align(4);
        return { key: node.name, value };
    }

    // class/struct: đọc hết node con có level > level hiện tại
    const obj = {};
    while (cursor.i < nodes.length && nodes[cursor.i].level > node.level) {
        const child = readValue(r, nodes, cursor, externals);
        obj[child.key] = child.value;
    }
    if (align) r.align(4);

    // Đường tắt cho các shape hay dùng, để output giống YAML.
    if (node.type.startsWith('PPtr<')) {
        const fileID = obj.m_FileID;
        const pathID = obj.m_PathID;
        const ext = fileID > 0 && externals ? externals[fileID - 1] : null;
        value = ext
            ? { fileID: pathID, guid: ext.guid, type: 3 }
            : { fileID: pathID };
        return { key: node.name, value };
    }
    if (node.type === 'map') {
        // map -> { Array: [ {first, second}, ... ] }; dựng object khi key là string
        const arr = obj.Array || [];
        const asObj = {};
        let allString = arr.length > 0;
        for (const pair of arr) {
            if (!pair || typeof pair.first !== 'string') { allString = false; break; }
            asObj[pair.first] = pair.second;
        }
        return { key: node.name, value: allString ? asObj : arr };
    }
    if (node.type === 'vector' || node.type === 'staticvector' || node.type === 'set') {
        return { key: node.name, value: obj.Array !== undefined ? obj.Array : obj };
    }

    return { key: node.name, value: obj };
}

function skipChildren (nodes, cursor, level) {
    while (cursor.i < nodes.length && nodes[cursor.i].level > level) cursor.i += 1;
}
function skipNode (nodes, cursor) {
    const level = nodes[cursor.i].level;
    cursor.i += 1;
    skipChildren(nodes, cursor, level);
}

/**
 * Đọc một file `.mat` / `.asset` / `.prefab` nhị phân của Unity.
 *
 * @returns {{ok:true, docs:Array, unityVersion:string, externals:Array}
 *          |{ok:false, reason:string}}
 *   `docs` cùng shape với `parseUnityFile` của lib YAML:
 *   `[{ classId, fileID, typeName, data }]`.
 */
function parseBinaryUnityFile (input) {
    const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
    let meta;
    try { meta = readMetadata(buf); } catch (e) {
        return { ok: false, reason: `header parse failed: ${e.message}` };
    }
    if (meta.error) return { ok: false, reason: meta.error };
    if (!meta.enableTypeTree) {
        return { ok: false, reason: 'type tree stripped (built AssetBundle) — không thể giải' };
    }

    const docs = [];
    for (const obj of meta.objects) {
        const type = meta.types[obj.typeID];
        if (!type || !type.nodes.length) continue;
        const r = new Reader(buf, meta.dataOffset + obj.byteStart);
        const cursor = { i: 0 };
        let data;
        try {
            data = readValue(r, type.nodes, cursor, meta.externals).value;
        } catch (e) {
            return { ok: false, reason: `object ${obj.pathID} (class ${type.classID}) failed: ${e.message}` };
        }
        docs.push({
            classId: type.classID,
            fileID: String(obj.pathID),
            typeName: type.nodes[0] ? type.nodes[0].type : String(type.classID),
            data,
        });
    }
    return { ok: true, docs, unityVersion: meta.unityVersion, externals: meta.externals };
}

/**
 * Đọc file Unity bất kể text hay nhị phân. Trả `docs` cùng shape để tool gọi
 * không phải phân nhánh.
 */
function parseUnityFileAny (filePath, parseYaml) {
    if (!isBinarySerializedFile(filePath)) {
        return { ok: true, format: 'yaml', docs: parseYaml(fs.readFileSync(filePath, 'utf8')) };
    }
    const res = parseBinaryUnityFile(filePath);
    if (!res.ok) return { ok: false, format: 'binary', reason: res.reason };
    return { ok: true, format: 'binary', docs: res.docs, externals: res.externals };
}

// ─────────────────────────────────────────────── binary -> YAML text ──

const UNITY_CLASS_NAMES = {
    1: 'GameObject', 4: 'Transform', 20: 'Camera', 21: 'Material', 23: 'MeshRenderer',
    28: 'Texture2D', 33: 'MeshFilter', 43: 'Mesh', 48: 'Shader', 54: 'Rigidbody',
    64: 'MeshCollider', 65: 'BoxCollider', 74: 'AnimationClip', 82: 'AudioSource',
    91: 'AnimatorController', 95: 'Animator', 108: 'Light', 114: 'MonoBehaviour',
    115: 'MonoScript', 128: 'Font', 135: 'SphereCollider', 136: 'CapsuleCollider',
    198: 'ParticleSystem', 199: 'ParticleSystemRenderer', 212: 'SpriteRenderer',
    213: 'Sprite', 222: 'CanvasRenderer', 223: 'Canvas', 224: 'RectTransform',
    1001: 'PrefabInstance',
};

function yamlNumber (n) {
    if (!isFinite(n)) return n > 0 ? '.inf' : (n < 0 ? '-.inf' : '.nan');
    if (Number.isInteger(n)) return String(n);
    // Unity ghi float ~7 chữ số có nghĩa; giữ nguyên độ chính xác đọc được.
    return String(Number(n.toPrecision(9)));
}

function yamlScalar (v, key) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') return yamlNumber(v);
    const s = String(v);
    // guid là hex 32 ký tự bắt đầu bằng số -> quy tắc quote chung sẽ bọc nháy,
    // và mọi bảng index guid của kit so sánh chuỗi thô nên sẽ trượt.
    if (key === 'guid' && /^[0-9a-f]{32}$/i.test(s)) return s;
    if (s === '') return "''";
    if (/^[-\d.]/.test(s) || /[:#{}[\],&*?|<>=!%@`'"]/.test(s) || /^\s|\s$/.test(s)) {
        return `'${s.replace(/'/g, "''")}'`;
    }
    return s;
}

/** Object nhỏ toàn scalar -> viết inline `{x: 1, y: 2}` như Unity vẫn ghi. */
function isInlineObject (v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = Object.keys(v);
    if (keys.length === 0 || keys.length > 4) return false;
    return keys.every((k) => v[k] === null || ['number', 'boolean', 'string'].includes(typeof v[k]));
}

function inlineObject (v) {
    return `{${Object.keys(v).map((k) => `${k}: ${yamlScalar(v[k], k)}`).join(', ')}}`;
}

function emitValue (key, value, indent, out) {
    const pad = ' '.repeat(indent);
    if (value === null || value === undefined) { out.push(`${pad}${key}: `); return; }
    if (Array.isArray(value)) {
        if (value.length === 0) { out.push(`${pad}${key}: []`); return; }
        out.push(`${pad}${key}:`);
        for (const item of value) {
            if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                if (isInlineObject(item)) { out.push(`${pad}- ${inlineObject(item)}`); continue; }
                const keys = Object.keys(item);
                out.push(`${pad}- ${keys[0]}: ${scalarOrBlank(item[keys[0]], keys[0])}`);
                if (!isScalar(item[keys[0]])) emitInto(item[keys[0]], indent + 2, out);
                for (const k of keys.slice(1)) emitValue(k, item[k], indent + 2, out);
            } else {
                out.push(`${pad}- ${yamlScalar(item)}`);
            }
        }
        return;
    }
    if (typeof value === 'object') {
        if (isInlineObject(value)) { out.push(`${pad}${key}: ${inlineObject(value)}`); return; }
        out.push(`${pad}${key}:`);
        emitInto(value, indent + 2, out);
        return;
    }
    out.push(`${pad}${key}: ${yamlScalar(value, key)}`);
}

const isScalar = (v) => v === null || v === undefined || typeof v !== 'object';
const scalarOrBlank = (v, k) => (isScalar(v) ? yamlScalar(v, k) : (isInlineObject(v) ? inlineObject(v) : ''));

function emitInto (obj, indent, out) {
    if (isInlineObject(obj)) { out.push(`${' '.repeat(indent)}${inlineObject(obj).slice(1, -1)}`); return; }
    for (const [k, v] of Object.entries(obj)) emitValue(k, v, indent, out);
}

/**
 * Dựng lại text Unity YAML từ object đã giải nhị phân.
 *
 * Vì sao không trả object thẳng: mọi helper trong `unity-cocos-port` đọc asset
 * qua REGEX trên `doc.lines`. Sinh lại text cho phép asset nhị phân đi qua đúng
 * đường code đã được kiểm chứng của asset text, thay vì phải nhân đôi mọi
 * nhánh đọc field.
 */
function binaryDocsToUnityYaml (docs) {
    const out = ['%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:'];
    for (const doc of docs) {
        const typeName = doc.typeName && doc.typeName !== 'Base'
            ? doc.typeName
            : (UNITY_CLASS_NAMES[doc.classId] || `UnityClass${doc.classId}`);
        out.push(`--- !u!${doc.classId} &${doc.fileID}`);
        out.push(`${typeName}:`);
        emitInto(doc.data, 2, out);
    }
    return out.join('\n');
}

module.exports = {
    isBinarySerializedFile,
    parseBinaryUnityFile,
    parseUnityFileAny,
    binaryDocsToUnityYaml,
    COMMON_STRINGS,
};
