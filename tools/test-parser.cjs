'use strict';

const fs = require('fs');
const path = require('path');
const { parseCSharpSource } = require('./compiler/csharp-parser.cjs');

const SAMPLE_PROJECTS = [
  'd:\\_Projects\\Unity\\Tank3d\\Assets\\_Tanks',
  'd:\\_Projects\\Unity\\TapeTap\\Assets\\EpicVictoryEffects',
  'd:\\_Projects\\Unity\\MyCozyHome\\MyCozyHome-Android\\Assets\\CheatDetected',
  'd:\\_Projects\\Unity\\HoleScrum4\\Assets\\CheatDetect',
  'd:\\_Projects\\Unity\\BlashShooter\\BlastShooter-Android\\Assets\\CheatDetected'
];

function getAllCsFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllCsFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

console.log('=== Batch Testing C# AST Parser on ALL .cs files in sample directories ===\n');

let allCsFiles = [];
for (const p of SAMPLE_PROJECTS) {
  const files = getAllCsFiles(p);
  allCsFiles = allCsFiles.concat(files);
}

console.log(`Found ${allCsFiles.length} total C# files across sample projects.`);
let passed = 0;
let failed = 0;
const failures = [];

for (const filePath of allCsFiles) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const ast = parseCSharpSource(code, path.basename(filePath));
    passed++;
  } catch (err) {
    failed++;
    failures.push({ file: filePath, error: err.message });
  }
}

console.log(`\n=== Batch Parser Results ===`);
console.log(`Total: ${allCsFiles.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`- ${f.file}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
