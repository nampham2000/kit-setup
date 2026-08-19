'use strict';

const fs = require('fs');
const path = require('path');
const { parseCSharpSource } = require('./compiler/csharp-parser.cjs');
const { compileFile } = require('./compiler/unity-cs-compiler.cjs');

const TARGET_PROJECTS = [
  'E:/Working/Unity/Puzzle/BlashShooter',
  'E:/Working/Unity/Puzzle/BlossomQuest',
  'E:/Working/Unity/Puzzle/BounceMerge',
  'E:/Working/Unity/Puzzle/CandyPopSort',
  'E:/Working/Unity/Puzzle/CatBlockSlidePuzzle',
  'E:/Working/Unity/Puzzle/DominoHoleDropPuzzle'
];

// Ensure temp/tsconfig.cocos.json and declarations are valid
const tempDir = path.resolve(__dirname, '../../temp');
const declDir = path.join(tempDir, 'declarations');
if (!fs.existsSync(declDir)) fs.mkdirSync(declDir, { recursive: true });

const dtsPath = path.join(declDir, 'cc.d.ts');
const dtsContent = '/// <reference path="../../extensions/cocos-mcp/node_modules/@cocos/creator-types/engine/cc.d.ts" />\n';
fs.writeFileSync(dtsPath, dtsContent);

const cocosTsConfigPath = path.join(tempDir, 'tsconfig.cocos.json');
const cocosTsConfig = {
  compilerOptions: {
    target: 'ES2015',
    module: 'ES2015',
    moduleResolution: 'node',
    experimentalDecorators: true,
    allowSyntheticDefaultImports: true,
    isolatedModules: false,
    skipLibCheck: true,
    lib: ['es2015', 'dom']
  },
  include: [
    '../assets/**/*',
    './declarations/**/*'
  ],
  exclude: [
    '../node_modules',
    './test_out'
  ]
};
fs.writeFileSync(cocosTsConfigPath, JSON.stringify(cocosTsConfig, null, 2));

function findCsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip Library, Temp, obj, Logs if present
        if (['Library', 'Temp', 'obj', 'Logs', '.git'].includes(entry.name)) continue;
        results.push(...findCsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.cs')) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error scanning ${dir}: ${err.message}`);
  }
  return results;
}

console.log('=== Scanning 3 Target Unity Projects for C# Scripts ===\n');

const projectStats = {};
let allFiles = [];

for (const p of TARGET_PROJECTS) {
  const pName = path.basename(p);
  const files = findCsFiles(p);
  projectStats[pName] = { total: files.length, files, passed: 0, failed: 0, errors: [] };
  allFiles.push(...files);
  console.log(`[${pName}] Found ${files.length} .cs files`);
}

console.log(`\nTotal .cs files to test: ${allFiles.length}\n`);

// 1. Test AST Parser
console.log('--- Phase 1: AST Parser Verification ---');
let parsePassed = 0;
let parseFailed = 0;
const parseErrors = [];

for (const file of allFiles) {
  const code = fs.readFileSync(file, 'utf8');
  const filename = path.basename(file);
  try {
    const ast = parseCSharpSource(code, filename);
    parsePassed++;
  } catch (err) {
    parseFailed++;
    parseErrors.push({ file, error: err.message });
  }
}

console.log(`Parser Results: ${parsePassed} / ${allFiles.length} passed (${((parsePassed / allFiles.length) * 100).toFixed(2)}%)`);
if (parseFailed > 0) {
  console.log(`Failed Parser Files (${parseFailed}):`);
  for (const err of parseErrors) {
    console.log(`  - ${err.file}: ${err.error}`);
  }
}

// 2. Test End-to-End Compiler
console.log('\n--- Phase 2: Full Compilation to Cocos Creator TS ---');
let compilePassed = 0;
let compileFailed = 0;
const compileErrors = [];

for (const p of TARGET_PROJECTS) {
  const pName = path.basename(p);
  for (const file of projectStats[pName].files) {
    const res = compileFile(file, 'temp/test_output', true);
    if (res.success) {
      compilePassed++;
      projectStats[pName].passed++;
    } else {
      compileFailed++;
      projectStats[pName].failed++;
      projectStats[pName].errors.push({ file, error: res.error });
      compileErrors.push({ file, error: res.error });
    }
  }
}

console.log('\n=== Per-Project Breakdown ===');
for (const pName in projectStats) {
  const s = projectStats[pName];
  console.log(`[${pName}]: ${s.passed}/${s.total} compiled (${((s.passed / s.total) * 100).toFixed(2)}%)`);
}

console.log(`\nTotal Compile Results: ${compilePassed} / ${allFiles.length} (${((compilePassed / allFiles.length) * 100).toFixed(2)}%)`);
if (compileFailed > 0) {
  console.log(`\nFailed Compilation Files (${compileFailed}):`);
  for (const err of compileErrors) {
    console.log(`  - ${err.file}: ${err.error}`);
  }
}
