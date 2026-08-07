#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'binary');
const STRIPPED_OBJECT_TYPES = new Set(['Texture', 'Video']);
const STRIPPED_META_IMPORTERS = new Set(['gltf-embeded-image', 'texture']);

function fail(message) {
  console.error(`[strip-fbx-textures] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { files: [], write: false, updateMeta: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--no-meta') options.updateMeta = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) fail(`Unknown argument: ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`
Cocos FBX Texture Link Stripper

Removes FBX Texture/Video objects and their connections while preserving the
Material object, mesh material slots, animation data, and existing Cocos UUIDs.
Also removes generated image/texture sub-assets from the companion .fbx.meta.

Usage:
  node playable-shared-kit/tools/strip-fbx-textures.cjs [options] <fbx...>

Options:
  --write     Write FBX and .fbx.meta changes. Default: dry-run.
  --no-meta   Do not inspect or update the companion .fbx.meta file.
  --help, -h  Show help.

Examples:
  node playable-shared-kit/tools/strip-fbx-textures.cjs assets/models/table.fbx
  node playable-shared-kit/tools/strip-fbx-textures.cjs --write assets/models/table.fbx assets/models/wood.fbx
`);
}

function assertSafeNumber(value, label) {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} exceeds Node Buffer limits: ${value}`);
  }
  return number;
}

function isZeroRecord(buffer, offset, size) {
  if (offset + size > buffer.length) return false;
  for (let index = offset; index < offset + size; index += 1) {
    if (buffer[index] !== 0) return false;
  }
  return true;
}

class BinaryFbx {
  constructor(buffer) {
    if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a binary FBX file');
    this.buffer = buffer;
    this.version = buffer.readUInt32LE(MAGIC.length);
    this.wide = this.version >= 7500;
    this.headerSize = this.wide ? 25 : 13;
    this.nullRecord = Buffer.alloc(this.headerSize);
    this.nodes = [];

    let offset = MAGIC.length + 4;
    while (!isZeroRecord(buffer, offset, this.headerSize)) {
      const parsed = this.readNode(offset);
      this.nodes.push(parsed.node);
      offset = parsed.offset;
    }
    offset += this.headerSize;
    this.footer = buffer.subarray(offset);
  }

  readHeader(offset) {
    if (this.wide) {
      return {
        end: assertSafeNumber(this.buffer.readBigUInt64LE(offset), 'node end offset'),
        count: assertSafeNumber(this.buffer.readBigUInt64LE(offset + 8), 'property count'),
        propLength: assertSafeNumber(this.buffer.readBigUInt64LE(offset + 16), 'property length'),
        nameLength: this.buffer[offset + 24],
      };
    }
    return {
      end: this.buffer.readUInt32LE(offset),
      count: this.buffer.readUInt32LE(offset + 4),
      propLength: this.buffer.readUInt32LE(offset + 8),
      nameLength: this.buffer[offset + 12],
    };
  }

  readProperty(offset) {
    const start = offset;
    const code = String.fromCharCode(this.buffer[offset]);
    offset += 1;
    let value = null;

    if (code === 'Y') {
      value = this.buffer.readInt16LE(offset);
      offset += 2;
    } else if (code === 'C') {
      value = this.buffer[offset] !== 0;
      offset += 1;
    } else if (code === 'I') {
      value = this.buffer.readInt32LE(offset);
      offset += 4;
    } else if (code === 'F') {
      value = this.buffer.readFloatLE(offset);
      offset += 4;
    } else if (code === 'D') {
      value = this.buffer.readDoubleLE(offset);
      offset += 8;
    } else if (code === 'L') {
      value = this.buffer.readBigInt64LE(offset);
      offset += 8;
    } else if (code === 'S' || code === 'R') {
      const size = this.buffer.readUInt32LE(offset);
      offset += 4;
      const payload = this.buffer.subarray(offset, offset + size);
      offset += size;
      value = code === 'S' ? payload.toString('utf8') : payload;
    } else if ('fdlibc'.includes(code)) {
      const compressedLength = this.buffer.readUInt32LE(offset + 8);
      offset += 12 + compressedLength;
    } else {
      throw new Error(`Unsupported FBX property code ${JSON.stringify(code)} at ${start}`);
    }

    return { property: { code, value, raw: this.buffer.subarray(start, offset) }, offset };
  }

  readNode(offset) {
    const header = this.readHeader(offset);
    let cursor = offset + this.headerSize;
    const name = this.buffer.subarray(cursor, cursor + header.nameLength).toString('utf8');
    cursor += header.nameLength;
    const propertyEnd = cursor + header.propLength;
    const properties = [];

    for (let index = 0; index < header.count; index += 1) {
      const parsed = this.readProperty(cursor);
      properties.push(parsed.property);
      cursor = parsed.offset;
    }
    if (cursor !== propertyEnd) throw new Error(`Property length mismatch in ${name}`);

    const children = [];
    let hasNull = false;
    while (cursor < header.end) {
      if (isZeroRecord(this.buffer, cursor, this.headerSize)) {
        cursor += this.headerSize;
        hasNull = true;
        break;
      }
      const parsed = this.readNode(cursor);
      children.push(parsed.node);
      cursor = parsed.offset;
    }
    if (cursor !== header.end) throw new Error(`Node length mismatch in ${name}`);
    return { node: { name, properties, children, hasNull }, offset: cursor };
  }

  encodeNode(node, start) {
    const name = Buffer.from(node.name, 'utf8');
    if (name.length > 255) throw new Error(`FBX node name is too long: ${node.name}`);
    const properties = Buffer.concat(node.properties.map((property) => property.raw));
    let cursor = start + this.headerSize + name.length + properties.length;
    const children = node.children.map((child) => {
      const encoded = this.encodeNode(child, cursor);
      cursor += encoded.length;
      return encoded;
    });
    const nullRecord = node.hasNull ? this.nullRecord : Buffer.alloc(0);
    const end = cursor + nullRecord.length;
    const header = Buffer.alloc(this.headerSize);

    if (this.wide) {
      header.writeBigUInt64LE(BigInt(end), 0);
      header.writeBigUInt64LE(BigInt(node.properties.length), 8);
      header.writeBigUInt64LE(BigInt(properties.length), 16);
      header[24] = name.length;
    } else {
      for (const [value, label] of [[end, 'node end'], [node.properties.length, 'property count'], [properties.length, 'property length']]) {
        if (value > 0xffffffff) throw new Error(`${label} exceeds FBX 7400 limit: ${value}`);
      }
      header.writeUInt32LE(end, 0);
      header.writeUInt32LE(node.properties.length, 4);
      header.writeUInt32LE(properties.length, 8);
      header[12] = name.length;
    }
    return Buffer.concat([header, name, properties, ...children, nullRecord]);
  }

  encode() {
    const version = Buffer.alloc(4);
    version.writeUInt32LE(this.version);
    const chunks = [MAGIC, version];
    let cursor = MAGIC.length + version.length;
    for (const node of this.nodes) {
      const encoded = this.encodeNode(node, cursor);
      chunks.push(encoded);
      cursor += encoded.length;
    }
    chunks.push(this.nullRecord, this.footer);
    return Buffer.concat(chunks);
  }
}

function firstValue(node, index = 0) {
  return node.properties[index]?.value;
}

function replaceInteger(property, value) {
  if (property.code === 'I') {
    const raw = Buffer.alloc(5);
    raw[0] = 'I'.charCodeAt(0);
    raw.writeInt32LE(value, 1);
    Object.assign(property, { value, raw });
  } else if (property.code === 'L') {
    const raw = Buffer.alloc(9);
    raw[0] = 'L'.charCodeAt(0);
    raw.writeBigInt64LE(BigInt(value), 1);
    Object.assign(property, { value: BigInt(value), raw });
  } else {
    throw new Error(`Expected integer property, got ${property.code}`);
  }
}

function stripFbx(filePath, write) {
  const source = fs.readFileSync(filePath);
  const fbx = new BinaryFbx(source);
  const objects = fbx.nodes.find((node) => node.name === 'Objects');
  const connections = fbx.nodes.find((node) => node.name === 'Connections');
  if (!objects || !connections) throw new Error('FBX is missing Objects or Connections');

  const removedObjects = objects.children.filter((node) => STRIPPED_OBJECT_TYPES.has(node.name));
  const removedIds = new Set(removedObjects.map((node) => firstValue(node)));
  if (removedObjects.length && (removedIds.has(undefined) || removedIds.size !== removedObjects.length)) {
    throw new Error('Texture/Video object IDs are missing or duplicated');
  }
  const removedSet = new Set(removedObjects);
  objects.children = objects.children.filter((node) => !removedSet.has(node));

  const oldConnectionCount = connections.children.length;
  connections.children = connections.children.filter((node) => {
    if (node.name !== 'C') return true;
    return !removedIds.has(firstValue(node, 1)) && !removedIds.has(firstValue(node, 2));
  });

  const definitions = fbx.nodes.find((node) => node.name === 'Definitions');
  let removedTypes = [];
  if (definitions) {
    removedTypes = definitions.children.filter(
      (node) => node.name === 'ObjectType' && STRIPPED_OBJECT_TYPES.has(firstValue(node)),
    );
    const removedTypeSet = new Set(removedTypes);
    definitions.children = definitions.children.filter((node) => !removedTypeSet.has(node));
    const count = definitions.children.find((node) => node.name === 'Count');
    if (count?.properties.length) {
      const oldValue = firstValue(count);
      const numericValue = typeof oldValue === 'bigint' ? Number(oldValue) : oldValue;
      replaceInteger(count.properties[0], numericValue - removedTypes.length);
    }
  }

  const encoded = fbx.encode();
  const reparsed = new BinaryFbx(encoded);
  const remaining = reparsed.nodes
    .find((node) => node.name === 'Objects')
    .children.filter((node) => STRIPPED_OBJECT_TYPES.has(node.name));
  if (remaining.length) throw new Error('Texture/Video objects remain after rewrite');
  const fbxChanged = !encoded.equals(source);
  if (write && fbxChanged) fs.writeFileSync(filePath, encoded);

  return {
    fbxChanged,
    objects: removedObjects.map((node) => node.name),
    ids: [...removedIds].map(String).sort(),
    connections: oldConnectionCount - connections.children.length,
    definitionTypes: removedTypes.map((node) => firstValue(node)),
    bytesBefore: source.length,
    bytesAfter: encoded.length,
  };
}

function stripMeta(filePath, write) {
  const metaPath = `${filePath}.meta`;
  if (!fs.existsSync(metaPath)) throw new Error(`Companion metadata not found: ${metaPath}`);
  const original = fs.readFileSync(metaPath, 'utf8');
  const meta = JSON.parse(original);
  const originalSemantic = JSON.stringify(meta);
  const subMetas = meta.subMetas || {};
  const removedSubMetas = {};
  for (const [id, subMeta] of Object.entries(subMetas)) {
    if (!STRIPPED_META_IMPORTERS.has(subMeta.importer)) continue;
    removedSubMetas[id] = subMeta.importer;
    delete subMetas[id];
  }
  meta.subMetas = subMetas;
  meta.userData ||= {};
  meta.userData.imageMetas = [];
  meta.userData.assetFinder ||= {};
  meta.userData.assetFinder.textures = [];

  const encoded = `${JSON.stringify(meta, null, 2)}\n`;
  const metaChanged = JSON.stringify(meta) !== originalSemantic;
  if (write && metaChanged) fs.writeFileSync(metaPath, encoded, 'utf8');
  return { metaChanged, removedSubMetas };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.files.length) return fail('Pass at least one .fbx file. Use --help for usage.');

  let changedFiles = 0;
  for (const input of options.files) {
    const filePath = path.resolve(input);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`File not found: ${input}`);
    if (path.extname(filePath).toLowerCase() !== '.fbx') fail(`Expected an .fbx file: ${input}`);
    try {
      const report = stripFbx(filePath, options.write);
      if (options.updateMeta) Object.assign(report, stripMeta(filePath, options.write));
      const changed = report.fbxChanged || report.metaChanged === true;
      if (changed) changedFiles += 1;
      console.log(JSON.stringify({ file: path.relative(process.cwd(), filePath).replace(/\\/g, '/'), changed, ...report }));
    } catch (error) {
      fail(`${input}: ${error.message}`);
    }
  }
  console.log(`[strip-fbx-textures] ${options.write ? 'wrote' : 'dry-run'}: ${changedFiles}/${options.files.length} file(s) need changes`);
}

main();
