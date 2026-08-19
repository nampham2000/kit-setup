'use strict';

/**
 * Exporter script for PictureBlock and TileFood
 * - Copies Unity source shaders and materials to test/unity/
 * - Transpiles to Cocos Creator .effect and .mtl in test/cocos/
 */

const fs = require('fs');
const path = require('path');
const { transpileShaderFile } = require('./unity-shader-compiler.cjs');
const { convertMatFile } = require('./unity-material-converter.cjs');

const TARGET_PROJECTS = [
  { name: 'PictureBlock', srcDir: 'E:\\Working\\Unity\\Puzzle\\PictureBlock' },
  { name: 'TileFood', srcDir: 'E:\\Working\\Unity\\Puzzle\\TileFood' },
];

const OUT_UNITY_BASE = path.resolve('test', 'unity');
const OUT_COCOS_BASE = path.resolve('test', 'cocos');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function findFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['Library', 'Temp', 'obj', 'Logs', '.git', 'Build', 'Builds'].includes(entry.name)) {
        continue;
      }
      results.push(...findFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function exportProject(project) {
  console.log(`\n=================================================================`);
  console.log(`📦 Exporting Project: ${project.name}`);
  console.log(`=================================================================`);

  const unityOutDir = path.join(OUT_UNITY_BASE, project.name);
  const cocosOutDir = path.join(OUT_COCOS_BASE, project.name);

  ensureDir(unityOutDir);
  ensureDir(cocosOutDir);

  const shaders = findFiles(project.srcDir, ['.shader']);
  const materials = findFiles(project.srcDir, ['.mat']);

  console.log(`Found ${shaders.length} shaders and ${materials.length} materials in ${project.srcDir}`);

  let shaderSuccess = 0;
  let matSuccess = 0;

  // 1. Process Shaders
  for (const sPath of shaders) {
    const relPath = path.relative(project.srcDir, sPath);
    const unityDest = path.join(unityOutDir, relPath);
    const cocosDest = path.join(cocosOutDir, relPath.replace(/\.shader$/i, '.effect'));

    ensureDir(path.dirname(unityDest));
    ensureDir(path.dirname(cocosDest));

    // Copy Unity source file
    fs.copyFileSync(sPath, unityDest);

    // Transpile to Cocos .effect
    try {
      transpileShaderFile(sPath, cocosDest, {
        generateMaterial: true,
        report: true,
        dryRun: false,
      });
      shaderSuccess++;
      console.log(`  [✓ SHADER] ${relPath} -> ${path.relative(process.cwd(), cocosDest)}`);
    } catch (e) {
      console.error(`  [✗ SHADER] Failed ${relPath}: ${e.message}`);
    }
  }

  // 2. Process Materials
  for (const mPath of materials) {
    const relPath = path.relative(project.srcDir, mPath);
    const unityDest = path.join(unityOutDir, relPath);
    const cocosDest = path.join(cocosOutDir, relPath.replace(/\.mat$/i, '.mtl'));

    ensureDir(path.dirname(unityDest));
    ensureDir(path.dirname(cocosDest));

    // Copy Unity source material
    fs.copyFileSync(mPath, unityDest);

    // Convert to Cocos .mtl
    try {
      convertMatFile(mPath, cocosDest);
      matSuccess++;
    } catch (e) {
      console.error(`  [✗ MAT] Failed ${relPath}: ${e.message}`);
    }
  }

  console.log(`\nExported ${project.name}:`);
  console.log(`- Shaders:   ${shaderSuccess}/${shaders.length} transpiled to ${path.relative(process.cwd(), cocosOutDir)}`);
  console.log(`- Materials: ${matSuccess}/${materials.length} converted to ${path.relative(process.cwd(), cocosOutDir)}`);
  console.log(`- Unity src: ${shaders.length + materials.length} files copied to ${path.relative(process.cwd(), unityOutDir)}`);
}

function main() {
  console.log(`🚀 Starting Export of PictureBlock & TileFood to test/cocos and test/unity...\n`);
  for (const proj of TARGET_PROJECTS) {
    exportProject(proj);
  }
  console.log(`\n=================================================================`);
  console.log(`✅ All exports completed successfully!`);
  console.log(`=================================================================\n`);
}

main();
