'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeFbxName(value, fallback = 'UnityMesh') {
  const clean = String(value || '').trim().replace(/[":]/g, '_');
  return clean || fallback;
}

function yamlValue(source, pattern, fallback = '') {
  const match = pattern.exec(source);
  return match ? match[1] : fallback;
}

function parseUnityMeshChannels(source) {
  const block = yamlValue(source, /m_Channels:\s*\n([\s\S]*?)\n\s*m_DataSize:/, '');
  const channels = [];
  const re = /-\s*stream:\s*(\d+)\s*\n\s*offset:\s*(\d+)\s*\n\s*format:\s*(\d+)\s*\n\s*dimension:\s*(\d+)/g;
  let match;
  while ((match = re.exec(block))) {
    channels.push({
      stream: Number(match[1]),
      offset: Number(match[2]),
      format: Number(match[3]),
      dimension: Number(match[4]),
    });
  }
  return channels;
}

// Byte size of each UnityEngine.Rendering.VertexAttributeFormat.
const FORMAT_SIZES = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 2, 9: 2, 10: 4, 11: 4 };

function readHalf(buffer, offset) {
  const bits = buffer.readUInt16LE(offset);
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function readComponent(buffer, offset, format) {
  if (offset < 0 || offset + (FORMAT_SIZES[format] || 4) > buffer.length) return 0;
  switch (format) {
    case 0: return buffer.readFloatLE(offset);
    case 1: return readHalf(buffer, offset);
    case 2: return buffer.readUInt8(offset) / 255;
    case 3: return Math.max(-1, buffer.readInt8(offset) / 127);
    case 4: return buffer.readUInt16LE(offset) / 65535;
    case 5: return Math.max(-1, buffer.readInt16LE(offset) / 32767);
    case 6: return buffer.readUInt8(offset);
    case 7: return buffer.readInt8(offset);
    case 8: return buffer.readUInt16LE(offset);
    case 9: return buffer.readInt16LE(offset);
    case 10: return buffer.readUInt32LE(offset);
    case 11: return buffer.readInt32LE(offset);
    default: return 0;
  }
}

/**
 * Unity packs vertex streams one after another, each starting 16-byte aligned, with a stride covering
 * its channels (4-byte aligned). Returns [{ start, stride }] per stream index, or null when inconsistent.
 */
function unityVertexStreamLayout(channels, vertexCount) {
  const streams = [];
  for (const c of channels) {
    if (!c.dimension || !FORMAT_SIZES[c.format]) continue;
    const end = c.offset + FORMAT_SIZES[c.format] * c.dimension;
    streams[c.stream] = Math.max(streams[c.stream] || 0, end);
  }
  if (!streams.length) return null;
  const layout = [];
  let start = 0;
  for (let s = 0; s < streams.length; s += 1) {
    const stride = streams[s] ? Math.ceil(streams[s] / 4) * 4 : 0;
    layout[s] = { start, stride };
    start = Math.ceil((start + stride * vertexCount) / 16) * 16;
  }
  return layout;
}

function readFloat(buffer, offset, fallback = 0) {
  if (offset < 0 || offset + 4 > buffer.length) return fallback;
  return buffer.readFloatLE(offset);
}

// Unity PackedBitVector (m_CompressedMesh fields): m_NumItems values of m_BitSize bits, packed
// little-endian from the low bit of each byte. Float vectors map an integer x to
// m_Start + x * m_Range / (2^m_BitSize - 1).
function readPackedBitVector(block, name) {
  const re = new RegExp(`\\n(\\s*)${name}:\\s*\\n((?:\\1\\s+.*\\n?)*)`);
  const match = re.exec(block);
  if (!match) return null;
  const body = match[2];
  const field = (key) => yamlValue(body, new RegExp(`\\n?\\s*${key}:\\s*([^\\n]*)`), '').trim();
  return {
    numItems: Number(field('m_NumItems')) || 0,
    range: Number(field('m_Range')) || 0,
    start: Number(field('m_Start')) || 0,
    data: Buffer.from(field('m_Data'), 'hex'),
    bitSize: Number(field('m_BitSize')) || 0,
  };
}

function unpackBitInts(vector, count, startItem = 0) {
  const out = [];
  if (!vector || !vector.bitSize) return out;
  let bitPos = vector.bitSize * startItem;
  let indexPos = Math.floor(bitPos / 8);
  bitPos %= 8;
  const mask = vector.bitSize >= 32 ? 0xffffffff : (2 ** vector.bitSize) - 1;
  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let bits = 0;
    while (bits < vector.bitSize) {
      const byte = indexPos < vector.data.length ? vector.data[indexPos] : 0;
      x += ((byte >> bitPos) * (2 ** bits));
      const num = Math.min(vector.bitSize - bits, 8 - bitPos);
      bitPos += num;
      bits += num;
      if (bitPos === 8) { indexPos += 1; bitPos = 0; }
    }
    out.push(x % (mask + 1));
  }
  return out;
}

function unpackBitFloats(vector, count, startItem = 0) {
  const maxValue = (2 ** vector.bitSize) - 1;
  return unpackBitInts(vector, count, startItem).map(x => vector.start + (x * vector.range) / maxValue);
}

// m_MeshCompression > 0 (typical of meshes extracted from a built player): the vertex stream is
// empty and positions, UV channels (m_UVInfo: 4 bits per channel, bit 2 = present, bits 0-1 =
// dimension - 1), two-component normals (z from the unit length, sign in m_NormalSigns) and the
// triangle list live in m_CompressedMesh.
function parseUnityCompressedMesh(source, meshName) {
  const block = yamlValue(source, /\n(\s*m_CompressedMesh:\s*\n[\s\S]*?)\n\s*m_LocalAABB:/, '');
  if (!block) return null;
  const verticesVec = readPackedBitVector(block, 'm_Vertices');
  const trianglesVec = readPackedBitVector(block, 'm_Triangles');
  if (!verticesVec || !verticesVec.numItems || !trianglesVec || !trianglesVec.numItems) return null;
  const vertexCount = Math.floor(verticesVec.numItems / 3);
  const flat = unpackBitFloats(verticesVec, vertexCount * 3);
  const positions = [];
  for (let i = 0; i < vertexCount; i += 1) positions.push([flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]]);

  let uvs = positions.map(() => [0, 0]);
  const uvVec = readPackedBitVector(block, 'm_UV');
  const uvInfo = Number(yamlValue(block, /\n\s*m_UVInfo:\s*(\d+)/, 0));
  if (uvVec && uvVec.numItems) {
    const bits = uvInfo & 0xf;
    const dimension = uvInfo ? ((bits & 4) ? 1 + (bits & 3) : 0) : 2;
    if (dimension >= 2) {
      const values = unpackBitFloats(uvVec, vertexCount * dimension);
      uvs = positions.map((_, i) => [values[i * dimension], values[i * dimension + 1]]);
    }
  }

  let normals = positions.map(() => [0, 0, 1]);
  const normalVec = readPackedBitVector(block, 'm_Normals');
  if (normalVec && normalVec.numItems >= vertexCount * 2) {
    const values = unpackBitFloats(normalVec, vertexCount * 2);
    const signs = unpackBitInts(readPackedBitVector(block, 'm_NormalSigns'), vertexCount);
    normals = positions.map((_, i) => {
      let x = values[i * 2];
      let y = values[i * 2 + 1];
      const zsqr = 1 - x * x - y * y;
      let z = 0;
      if (zsqr >= 0) z = Math.sqrt(zsqr);
      else {
        const length = Math.hypot(x, y) || 1;
        x /= length;
        y /= length;
      }
      if (signs[i] === 0) z = -z;
      return [x, y, z];
    });
  }

  const indices = unpackBitInts(trianglesVec, trianglesVec.numItems);
  if (indices.length < 3 || indices.some(index => index >= vertexCount)) return null;
  // m_Triangles holds the sub-meshes back to back in m_SubMeshes order.
  const counts = parseUnitySubMeshes(source, indices.length).map((sub) => Math.floor(sub.indexCount / 3));
  const subMeshTriangles = counts.reduce((a, b) => a + b, 0) === indices.length / 3 ? counts : [indices.length / 3];
  return { meshName, positions, normals, uvs, indices, subMeshTriangles, compressed: true };
}

function parseUnityMeshAsset(meshFile) {
  // Unity writes CRLF on Windows checkouts; every field regex below is line based.
  const source = fs.readFileSync(meshFile, 'utf8').replace(/\r\n?/g, '\n');
  if (!/--- !u!43\b/.test(source) || !/\bMesh:\s*\n/.test(source)) return null;

  const meshName = sanitizeFbxName(yamlValue(source, /\n\s*m_Name:\s*(.+)\n/, path.basename(meshFile, path.extname(meshFile))));
  if (Number(yamlValue(source, /\n\s*m_MeshCompression:\s*(\d+)/, 0)) > 0) {
    const compressed = parseUnityCompressedMesh(source, meshName);
    if (compressed) return compressed;
  }
  const vertexCount = Number(yamlValue(source, /\n\s*m_VertexCount:\s*(\d+)/, 0));
  const dataSize = Number(yamlValue(source, /\n\s*m_DataSize:\s*(\d+)/, 0));
  const vertexHex = yamlValue(source, /\n\s*_typelessdata:\s*([0-9a-fA-F]+)/, '');
  const indexHex = yamlValue(source, /\n\s*m_IndexBuffer:\s*([0-9a-fA-F]+)/, '');
  if (!vertexCount || !dataSize || !vertexHex || !indexHex) return null;

  const vertexBuffer = Buffer.from(vertexHex, 'hex');
  const indexBuffer = Buffer.from(indexHex, 'hex');
  if (vertexBuffer.length < dataSize) return null;

  // Unity VertexAttributeFormat per channel; the serialized dimension byte keeps flags in its high bits.
  // Blast Shooter's conveyor tray meshes store normals as Float16 x4 ("format: 1, dimension: 52"): a
  // Float32-only reader dropped them and every exported normal became (0, 0, 1).
  const channels = parseUnityMeshChannels(source).map((c) => ({ ...c, dimension: c.dimension & 0x0f }));
  const layout = unityVertexStreamLayout(channels, vertexCount);
  if (!layout) return null;
  const channel = (index) => {
    const candidate = channels[index];
    return candidate && candidate.dimension > 0 && FORMAT_SIZES[candidate.format] ? candidate : null;
  };
  const positionChannel = channel(0);
  const normalChannel = channel(1);
  const uvChannel = channel(4);
  if (!positionChannel || positionChannel.dimension < 3) return null;
  const read = (c, i, component) => {
    const stream = layout[c.stream];
    return readComponent(vertexBuffer, stream.start + i * stream.stride + c.offset + component * FORMAT_SIZES[c.format], c.format);
  };

  const positions = [];
  const normals = [];
  const uvs = [];
  for (let i = 0; i < vertexCount; i += 1) {
    positions.push([read(positionChannel, i, 0), read(positionChannel, i, 1), read(positionChannel, i, 2)]);
    normals.push(normalChannel && normalChannel.dimension >= 3
      ? [read(normalChannel, i, 0), read(normalChannel, i, 1), read(normalChannel, i, 2)]
      : [0, 0, 1]);
    uvs.push(uvChannel && uvChannel.dimension >= 2 ? [read(uvChannel, i, 0), read(uvChannel, i, 1)] : [0, 0]);
  }

  const indexFormat = Number(yamlValue(source, /\n\s*m_IndexFormat:\s*(\d+)/, 0));
  const bytesPerIndex = indexFormat === 1 ? 4 : 2;
  // Every sub-mesh (Blast Shooter's trays: sub-mesh 0 the belt, sub-mesh 1 the walls); only the first
  // was exported before, so the tray walls never reached Cocos.
  const subMeshes = parseUnitySubMeshes(source, Math.floor(indexBuffer.length / bytesPerIndex));
  const indices = [];
  const subMeshTriangles = [];
  for (const sub of subMeshes) {
    if (sub.topology !== 0) continue; // triangles only
    const start = indices.length;
    for (let i = 0; i < sub.indexCount; i += 1) {
      const offset = sub.firstByte + i * bytesPerIndex;
      if (offset + bytesPerIndex > indexBuffer.length) break;
      indices.push(sub.baseVertex + (bytesPerIndex === 4 ? indexBuffer.readUInt32LE(offset) : indexBuffer.readUInt16LE(offset)));
    }
    indices.length = start + Math.floor((indices.length - start) / 3) * 3;
    subMeshTriangles.push((indices.length - start) / 3);
  }
  if (indices.length < 3) return null;

  return { meshName, positions, normals, uvs, indices, subMeshTriangles };
}

/** m_SubMeshes entries in serialized order (one whole-buffer sub-mesh when absent). */
function parseUnitySubMeshes(source, totalIndices) {
  const block = yamlValue(source, /\n\s*m_SubMeshes:\s*\n([\s\S]*?)\n {2}(?!-)\S/, '');
  const subMeshes = [...block.matchAll(/firstByte:\s*(\d+)\s*\n\s*indexCount:\s*(\d+)\s*\n\s*topology:\s*(\d+)(?:\s*\n\s*baseVertex:\s*(\d+))?/g)]
    .map((m) => ({ firstByte: Number(m[1]), indexCount: Number(m[2]), topology: Number(m[3]), baseVertex: Number(m[4] || 0) }));
  return subMeshes.length ? subMeshes : [{ firstByte: 0, indexCount: totalIndices, topology: 0, baseVertex: 0 }];
}

function fbxArray(values) {
  return values.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(7)).toString() : '0';
  }).join(',');
}

// The FBX SDK's ASCII reader (Cocos FBX-glTF-conv) ignores single-line blocks such as
// `ObjectType: "Model" { Count: 1 }`: with no object definitions it drops every Geometry/Model and
// the import yields an empty scene. Every block must open and close on its own lines.
// Unity mesh data is left-handed with clockwise front faces; the file declares a right-handed Y-up
// basis that Cocos imports verbatim, and the porter converts every Unity transform by reflecting Z.
// So the vertices are written as Unity draws them in the ported frame: Z (and normal Z) negated and
// each triangle reversed to keep its front face. Written raw, Blast Shooter's conveyor trays came out
// mirrored in Z around their pivot (the tray sat on the shooter board instead of the conveyor).
function writeUnityMeshAssetAsFbx(mesh, destFile) {
  const geometryId = 100000;
  const modelId = 100001;
  const vertices = mesh.positions.flatMap(([x, y, z]) => [x, y, -z]);
  const normals = mesh.normals.flatMap(([x, y, z]) => [x, y, -z]);
  const uvs = mesh.uvs.flat();
  const polygonIndices = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    polygonIndices.push(mesh.indices[i], mesh.indices[i + 2], -(mesh.indices[i + 1] + 1));
  }
  const name = sanitizeFbxName(mesh.meshName);
  // Several Unity sub-meshes: one FBX material per sub-mesh and a per-polygon material index, so the
  // Cocos importer emits one primitive per sub-mesh in Unity's order (material slot i draws sub-mesh i).
  const subMeshTriangles = (mesh.subMeshTriangles || []).filter((count) => count > 0);
  const multi = subMeshTriangles.length > 1;
  const materialIds = multi ? subMeshTriangles.map((_, i) => 100100 + i) : [];
  const polygonMaterials = multi ? subMeshTriangles.flatMap((count, i) => Array(count).fill(i)) : [];
  const materialLayer = multi ? `
    LayerElementMaterial: 0 {
      Version: 101
      Name: ""
      MappingInformationType: "ByPolygon"
      ReferenceInformationType: "IndexToDirect"
      Materials: *${polygonMaterials.length} {
        a: ${polygonMaterials.join(',')}
      }
    }` : '';
  const materialLayerRef = multi ? `
      LayerElement:  {
        Type: "LayerElementMaterial"
        TypedIndex: 0
      }` : '';
  const materialDefinition = multi ? `
  ObjectType: "Material" {
    Count: ${materialIds.length}
  }` : '';
  const materialObjects = materialIds.map((id, i) => `
  Material: ${id}, "Material::${name}_${i}", "" {
    Version: 102
    ShadingModel: "lambert"
    MultiLayer: 0
    Properties70:  {
      P: "DiffuseColor", "Color", "", "A",${(i + 1) / materialIds.length},0.5,0.5
    }
  }`).join('');
  // Without DefaultAttributeIndex the FBX SDK's SplitMeshesPerMaterial finds no mesh on the node and
  // FBX-glTF-conv emits one primitive bound to polygon 0's material (Blast Shooter tray walls got the belt).
  const defaultAttribute = multi ? `
      P: "DefaultAttributeIndex", "int", "Integer", "",0` : '';
  const materialConnections = materialIds.map((id) => `
  C: "OO",${id},${modelId}`).join('');
  const content = `; FBX 7.4.0 project file generated by unity-cocos-port
FBXHeaderExtension:  {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
  Creator: "unity-cocos-port"
}
GlobalSettings:  {
  Version: 1000
  Properties70:  {
    P: "UpAxis", "int", "Integer", "",1
    P: "UpAxisSign", "int", "Integer", "",1
    P: "FrontAxis", "int", "Integer", "",2
    P: "FrontAxisSign", "int", "Integer", "",1
    P: "CoordAxis", "int", "Integer", "",0
    P: "CoordAxisSign", "int", "Integer", "",1
    P: "UnitScaleFactor", "double", "Number", "",100
  }
}
Documents:  {
  Count: 1
  Document: 1234567890, "Scene", "Scene" {
    RootNode: 0
  }
}
References:  {
}
Definitions:  {
  Version: 100
  Count: ${multi ? 3 : 2}
  ObjectType: "Geometry" {
    Count: 1
  }
  ObjectType: "Model" {
    Count: 1
  }${materialDefinition}
}
Objects:  {
  Geometry: ${geometryId}, "Geometry::${name}", "Mesh" {
    Vertices: *${vertices.length} {
      a: ${fbxArray(vertices)}
    }
    PolygonVertexIndex: *${polygonIndices.length} {
      a: ${polygonIndices.join(',')}
    }
    GeometryVersion: 124
    LayerElementNormal: 0 {
      Version: 101
      Name: ""
      MappingInformationType: "ByVertice"
      ReferenceInformationType: "Direct"
      Normals: *${normals.length} {
        a: ${fbxArray(normals)}
      }
    }
    LayerElementUV: 0 {
      Version: 101
      Name: "UVChannel_1"
      MappingInformationType: "ByVertice"
      ReferenceInformationType: "Direct"
      UV: *${uvs.length} {
        a: ${fbxArray(uvs)}
      }
    }${materialLayer}
    Layer: 0 {
      Version: 100
      LayerElement:  {
        Type: "LayerElementNormal"
        TypedIndex: 0
      }
      LayerElement:  {
        Type: "LayerElementUV"
        TypedIndex: 0
      }${materialLayerRef}
    }
  }
  Model: ${modelId}, "Model::${name}", "Mesh" {
    Version: 232
    Properties70:  {
      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
      P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
      P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1${defaultAttribute}
    }
    Shading: T
    Culling: "CullingOff"
  }${materialObjects}
}
Connections:  {
  C: "OO",${geometryId},${modelId}
  C: "OO",${modelId},0${materialConnections}
}
`;
  // Identical bytes are left alone so repeated ports never touch the file or trigger a reimport.
  if (fs.existsSync(destFile) && fs.readFileSync(destFile, 'utf8') === content) return { changed: false };
  fs.writeFileSync(destFile, content, 'utf8');
  return { changed: true };
}

function exportUnityMeshAssetToFbx(meshFile, destFile) {
  const mesh = parseUnityMeshAsset(meshFile);
  if (!mesh) return null;
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const { changed } = writeUnityMeshAssetAsFbx(mesh, destFile);
  return {
    destFile,
    changed,
    meshName: mesh.meshName,
    vertexCount: mesh.positions.length,
    indexCount: mesh.indices.length,
  };
}

module.exports = {
  exportUnityMeshAssetToFbx,
  parseUnityMeshAsset,
  writeUnityMeshAssetAsFbx,
};
