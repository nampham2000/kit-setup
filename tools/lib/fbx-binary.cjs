'use strict';
const zlib = require('node:zlib');

// Read-only parser for binary FBX (7.x) node records, including typed arrays.
// ASCII FBX is not supported: callers must treat a throw as "no evidence".
const MAGIC = Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'binary');
const ARRAY_WIDTH = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };

function parseFbxBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a binary FBX file');
  const version = buffer.readUInt32LE(MAGIC.length);
  const wide = version >= 7500;
  const headerSize = wide ? 25 : 13;
  const isNull = (offset) => {
    if (offset + headerSize > buffer.length) return false;
    for (let index = offset; index < offset + headerSize; index += 1) if (buffer[index] !== 0) return false;
    return true;
  };
  const readArray = (code, offset) => {
    const length = buffer.readUInt32LE(offset);
    const encoding = buffer.readUInt32LE(offset + 4);
    const compressed = buffer.readUInt32LE(offset + 8);
    let data = buffer.subarray(offset + 12, offset + 12 + compressed);
    if (encoding === 1) data = zlib.inflateSync(data);
    const width = ARRAY_WIDTH[code];
    if (data.length < length * width) throw new Error('FBX array is truncated');
    const values = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const at = index * width;
      if (code === 'i') values[index] = data.readInt32LE(at);
      else if (code === 'f') values[index] = data.readFloatLE(at);
      else if (code === 'd') values[index] = data.readDoubleLE(at);
      else if (code === 'l') values[index] = data.readBigInt64LE(at);
      else values[index] = data[at];
    }
    return [values, offset + 12 + compressed];
  };
  const readProperty = (offset) => {
    const code = String.fromCharCode(buffer[offset]);
    const at = offset + 1;
    switch (code) {
      case 'Y': return [buffer.readInt16LE(at), at + 2];
      case 'C': return [buffer[at] !== 0, at + 1];
      case 'I': return [buffer.readInt32LE(at), at + 4];
      case 'F': return [buffer.readFloatLE(at), at + 4];
      case 'D': return [buffer.readDoubleLE(at), at + 8];
      case 'L': return [buffer.readBigInt64LE(at), at + 8];
      case 'S':
      case 'R': {
        const size = buffer.readUInt32LE(at);
        const payload = buffer.subarray(at + 4, at + 4 + size);
        return [code === 'S' ? payload.toString('utf8') : payload, at + 4 + size];
      }
      default:
        if (ARRAY_WIDTH[code]) return readArray(code, at);
        throw new Error(`Unsupported FBX property code ${JSON.stringify(code)} at ${offset}`);
    }
  };
  const readNode = (offset) => {
    const end = wide ? Number(buffer.readBigUInt64LE(offset)) : buffer.readUInt32LE(offset);
    const count = wide ? Number(buffer.readBigUInt64LE(offset + 8)) : buffer.readUInt32LE(offset + 4);
    const nameLength = buffer[offset + (wide ? 24 : 12)];
    let cursor = offset + headerSize;
    const name = buffer.subarray(cursor, cursor + nameLength).toString('utf8');
    cursor += nameLength;
    const properties = [];
    for (let index = 0; index < count; index += 1) {
      const [value, next] = readProperty(cursor);
      properties.push(value);
      cursor = next;
    }
    const children = [];
    while (cursor < end) {
      if (isNull(cursor)) { cursor += headerSize; break; }
      const [child, next] = readNode(cursor);
      children.push(child);
      cursor = next;
    }
    if (cursor !== end) throw new Error(`FBX node length mismatch in ${name}`);
    return [{ name, properties, children }, end];
  };
  const nodes = [];
  let offset = MAGIC.length + 4;
  while (offset < buffer.length && !isNull(offset)) {
    const [node, next] = readNode(offset);
    nodes.push(node);
    offset = next;
  }
  return { version, nodes };
}

module.exports = { FBX_BINARY_MAGIC: MAGIC, parseFbxBinary };
