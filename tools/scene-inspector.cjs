#!/usr/bin/env node
'use strict';

/**
 * Cocos Creator 3.8.x Scene & Prefab ASCII Tree Inspector
 *
 * Parses complex Cocos Creator .scene and .prefab JSON arrays and prints
 * a high-density, compact ASCII tree with node hierarchy, active status,
 * transform coordinates, and attached components/scripts.
 *
 * Saves 95%+ tokens for AI Agents when inspecting or debugging scenes!
 */

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
  ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
  : (findProjectRoot(process.cwd()) || process.cwd());

const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

function buildScriptUuidMap() {
  const map = new Map();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(full);
      } else if (e.isFile() && e.name.endsWith('.ts.meta')) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (meta.uuid) {
            const scriptName = path.basename(e.name, '.ts.meta');
            map.set(meta.uuid, scriptName);
          }
        } catch {}
      }
    }
  }
  walk(ASSETS_DIR);
  return map;
}

function resolveTargetFile(input) {
  if (!input) {
    // Default to first scene in assets
    const scenes = fs.readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.scene'));
    if (scenes.length > 0) return path.join(ASSETS_DIR, scenes[0]);
    return null;
  }

  let target = path.resolve(input);
  if (fs.existsSync(target)) return target;

  target = path.join(ASSETS_DIR, input);
  if (fs.existsSync(target)) return target;

  if (!input.endsWith('.scene') && !input.endsWith('.prefab')) {
    const scenePath = path.join(ASSETS_DIR, `${input}.scene`);
    if (fs.existsSync(scenePath)) return scenePath;

    const prefabPath = path.join(ASSETS_DIR, `${input}.prefab`);
    if (fs.existsSync(prefabPath)) return prefabPath;
  }

  return null;
}

function parseSceneGraph(filePath, scriptUuidMap) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Invalid scene/prefab JSON: Expected non-empty array');
  }

  // Find root entry
  let rootNodeId = 1;
  const header = raw[0];
  if (header.__type__ === 'cc.SceneAsset' && header.scene && header.scene.__id__ !== undefined) {
    rootNodeId = header.scene.__id__;
  } else if (header.__type__ === 'cc.Prefab' && header.data && header.data.__id__ !== undefined) {
    rootNodeId = header.data.__id__;
  }

  function resolveComponentType(comp) {
    if (!comp || !comp.__type__) return 'Unknown';
    let typeName = comp.__type__;
    if (scriptUuidMap.has(typeName)) {
      return scriptUuidMap.get(typeName);
    }
    // Clean cc. prefix for brevity
    return typeName.replace(/^cc\./, '');
  }

  function parseNode(nodeId) {
    const item = raw[nodeId];
    if (!item) return null;

    const name = item._name || `Node_${nodeId}`;
    const active = item._active !== false;

    // Components
    const components = [];
    if (Array.isArray(item._components)) {
      for (const compRef of item._components) {
        if (compRef && compRef.__id__ !== undefined) {
          const compData = raw[compRef.__id__];
          if (compData) {
            components.push(resolveComponentType(compData));
          }
        }
      }
    }

    // Position
    let posStr = '';
    if (item._lpos) {
      const x = Math.round((item._lpos.x || 0) * 10) / 10;
      const y = Math.round((item._lpos.y || 0) * 10) / 10;
      const z = Math.round((item._lpos.z || 0) * 10) / 10;
      if (x !== 0 || y !== 0 || z !== 0) {
        posStr = `pos: (${x}, ${y}, ${z})`;
      }
    }

    // Children
    const children = [];
    if (Array.isArray(item._children)) {
      for (const childRef of item._children) {
        if (childRef && childRef.__id__ !== undefined) {
          const childNode = parseNode(childRef.__id__);
          if (childNode) children.push(childNode);
        }
      }
    }

    return {
      name,
      active,
      components,
      posStr,
      children
    };
  }

  const root = parseNode(rootNodeId);
  return {
    file: path.relative(ROOT_DIR, filePath).replace(/\\/g, '/'),
    type: header.__type__ === 'cc.Prefab' ? 'Prefab' : 'Scene',
    root
  };
}

function renderAsciiTree(node, prefix = '', isLast = true) {
  let output = '';
  const branch = isLast ? '└── ' : '├── ';
  const statusStr = node.active ? '' : ' \x1b[90m(inactive)\x1b[0m';
  const compStr = node.components.length > 0 ? ` \x1b[36m[${node.components.join(', ')}]\x1b[0m` : '';
  const posStr = node.posStr ? ` \x1b[90m(${node.posStr})\x1b[0m` : '';

  output += `${prefix}${branch}\x1b[1m${node.name}\x1b[0m${statusStr}${compStr}${posStr}\n`;

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  if (node.children && node.children.length > 0) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const last = i === node.children.length - 1;
      output += renderAsciiTree(child, childPrefix, last);
    }
  }

  return output;
}

const USAGE = `Cocos Scene Inspector

Usage:
  node playable-shared-kit/tools/scene-inspector.cjs <sceneName> [options]
  npm run ai:scene -- <sceneName>

Arguments:
  <sceneName>   Scene or prefab name (không cần đuôi .scene), hoặc đường dẫn.

Options:
  --json    Emit the node graph as JSON instead of the ASCII tree.
  --help    Show this help and exit without reading any scene.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const isJson = args.includes('--json');
  const fileArg = args.find((a) => !a.startsWith('-'));

  const targetFile = resolveTargetFile(fileArg);
  if (!targetFile) {
    console.error(`[scene-inspector] ERROR: Could not find scene or prefab: ${fileArg || 'default'}`);
    process.exit(1);
  }

  const scriptMap = buildScriptUuidMap();
  const graph = parseSceneGraph(targetFile, scriptMap);

  if (isJson) {
    console.log(JSON.stringify(graph, null, 2));
  } else {
    console.log(`\n======================================================`);
    console.log(` Cocos Scene Inspector: ${graph.file} (${graph.type}) `);
    console.log(`======================================================\n`);
    if (graph.root) {
      console.log(renderAsciiTree(graph.root));
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseSceneGraph, renderAsciiTree };
