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
  return { meshName, positions, normals, uvs, indices, compressed: true };
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
  const stride = Math.floor(dataSize / vertexCount);
  if (!stride || vertexBuffer.length < dataSize) return null;

  const channels = parseUnityMeshChannels(source);
  const channel = (index) => {
    const candidate = channels[index];
    return candidate && candidate.dimension > 0 && candidate.format === 0 ? candidate : null;
  };
  const positionChannel = channel(0);
  const normalChannel = channel(1);
  const uvChannel = channel(4);
  if (!positionChannel) return null;

  const positions = [];
  const normals = [];
  const uvs = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const base = i * stride;
    positions.push([
      readFloat(vertexBuffer, base + positionChannel.offset),
      readFloat(vertexBuffer, base + positionChannel.offset + 4),
      readFloat(vertexBuffer, base + positionChannel.offset + 8),
    ]);
    normals.push(normalChannel ? [
      readFloat(vertexBuffer, base + normalChannel.offset),
      readFloat(vertexBuffer, base + normalChannel.offset + 4),
      readFloat(vertexBuffer, base + normalChannel.offset + 8),
    ] : [0, 0, 1]);
    uvs.push(uvChannel ? [
      readFloat(vertexBuffer, base + uvChannel.offset),
      readFloat(vertexBuffer, base + uvChannel.offset + 4),
    ] : [0, 0]);
  }

  const indexFormat = Number(yamlValue(source, /\n\s*m_IndexFormat:\s*(\d+)/, 0));
  const bytesPerIndex = indexFormat === 1 ? 4 : 2;
  const firstByte = Number(yamlValue(source, /\n\s*firstByte:\s*(\d+)/, 0));
  const indexCount = Number(yamlValue(source, /\n\s*indexCount:\s*(\d+)/, Math.floor((indexBuffer.length - firstByte) / bytesPerIndex)));
  const indices = [];
  for (let i = 0; i < indexCount; i += 1) {
    const offset = firstByte + i * bytesPerIndex;
    if (offset + bytesPerIndex > indexBuffer.length) break;
    indices.push(bytesPerIndex === 4 ? indexBuffer.readUInt32LE(offset) : indexBuffer.readUInt16LE(offset));
  }
  if (indices.length < 3) return null;

  return { meshName, positions, normals, uvs, indices };
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
function writeUnityMeshAssetAsFbx(mesh, destFile) {
  const geometryId = 100000;
  const modelId = 100001;
  const vertices = mesh.positions.flat();
  const normals = mesh.normals.flat();
  const uvs = mesh.uvs.flat();
  const polygonIndices = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    polygonIndices.push(mesh.indices[i], mesh.indices[i + 1], -(mesh.indices[i + 2] + 1));
  }
  const name = sanitizeFbxName(mesh.meshName);
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
  Count: 2
  ObjectType: "Geometry" {
    Count: 1
  }
  ObjectType: "Model" {
    Count: 1
  }
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
    }
    Layer: 0 {
      Version: 100
      LayerElement:  {
        Type: "LayerElementNormal"
        TypedIndex: 0
      }
      LayerElement:  {
        Type: "LayerElementUV"
        TypedIndex: 0
      }
    }
  }
  Model: ${modelId}, "Model::${name}", "Mesh" {
    Version: 232
    Properties70:  {
      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
      P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
      P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
    }
    Shading: T
    Culling: "CullingOff"
  }
}
Connections:  {
  C: "OO",${geometryId},${modelId}
  C: "OO",${modelId},0
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
