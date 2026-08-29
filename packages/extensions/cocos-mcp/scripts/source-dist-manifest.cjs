#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestFile = path.join(root, 'dist', '.source-manifest.json');
const sourceRoots = ['source'];
const fixedFiles = ['package.json', 'tsconfig.json', 'base.tsconfig.json'];
const requiredOutputs = ['dist/main.js', 'dist/mcp-server.js'];

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function collectFiles() {
  const files = [...fixedFiles];
  for (const relativeRoot of sourceRoots) {
    const stack = [path.join(root, relativeRoot)];
    while (stack.length) {
      const directory = stack.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in extension source: ${full}`);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && /\.(?:ts|json|vue)$/.test(entry.name)) {
          files.push(path.relative(root, full).replace(/\\/g, '/'));
        }
      }
    }
  }
  return [...new Set(files)].sort();
}

function snapshot() {
  const files = collectFiles();
  const hashes = {};
  for (const file of files) hashes[file] = sha(fs.readFileSync(path.join(root, file)));
  return {
    version: 1,
    aggregateSha256: sha(Buffer.from(files.map((file) => `${file}\0${hashes[file]}\n`).join(''))),
    files: hashes,
    requiredOutputs,
  };
}

function collectOutputs() {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) return [];
  const files = [];
  const stack = [dist];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in extension dist: ${full}`);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

function outputSnapshot() {
  const files = collectOutputs();
  const hashes = {};
  for (const file of files) hashes[file] = sha(fs.readFileSync(path.join(root, file)));
  return { files, hashes };
}

function clean() {
  const dist = path.resolve(root, 'dist');
  if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') {
    throw new Error(`Refusing unsafe extension dist clean: ${dist}`);
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log('[cocos-mcp] cleaned dist/');
}

function write() {
  for (const output of requiredOutputs) {
    if (!fs.existsSync(path.join(root, output))) throw new Error(`Compiled extension output is missing: ${output}`);
  }
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const outputs = outputSnapshot();
  // Keep the tracked receipt byte-for-byte deterministic. Source/output hashes
  // already identify the build; a timestamp made every no-op build dirty.
  const value = { ...snapshot(), outputs };
  fs.writeFileSync(manifestFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`[cocos-mcp] dist source manifest: ${value.aggregateSha256}`);
}

function verify() {
  if (!fs.existsSync(manifestFile)) throw new Error('dist/.source-manifest.json is missing; canonical extension dist may be stale.');
  const recorded = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const current = snapshot();
  if (recorded.aggregateSha256 !== current.aggregateSha256) {
    throw new Error(`Cocos MCP source/dist mismatch: recorded=${recorded.aggregateSha256}, current=${current.aggregateSha256}. Rebuild and publish dist before syncing.`);
  }
  for (const output of current.requiredOutputs) {
    if (!fs.existsSync(path.join(root, output))) throw new Error(`Compiled extension output is missing: ${output}`);
  }
  const outputs = outputSnapshot();
  if (!recorded.outputs || JSON.stringify(recorded.outputs.files) !== JSON.stringify(outputs.files)) {
    throw new Error('Cocos MCP dist output set differs from the clean compiled manifest. Rebuild before syncing.');
  }
  for (const file of outputs.files) {
    if (recorded.outputs.hashes?.[file] !== outputs.hashes[file]) {
      throw new Error(`Cocos MCP compiled output changed after build: ${file}`);
    }
  }
  console.log(`[cocos-mcp] source/dist verified: ${current.aggregateSha256}`);
}

const command = process.argv[2] || 'verify';
if (command === 'clean') clean();
else if (command === 'write') write();
else if (command === 'verify') verify();
else throw new Error(`Unknown command: ${command}`);
