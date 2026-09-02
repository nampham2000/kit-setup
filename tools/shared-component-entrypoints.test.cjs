'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const { lintCocosComponentModules } = require('./cocos-component-module-linter.cjs');

const PACKAGES_ROOT = path.resolve(__dirname, '../packages');

const FORMER_PUBLIC_SYMBOLS = {
  'playable-core': {
    './GameManager': ['GameManager', 'GameState', 'GameHooks'],
    './SoundManager': ['SoundManager'],
    './utils/GameUtils': ['GameUtils'],
    './utils/pool/ObjectPool': ['ObjectPool', 'PoolHandle', 'PoolConfig', 'PoolKey'],
    './utils/pool/NodePoolAdapter': ['makeNodePoolConfig'],
    './utils/pool/Poolable': ['Poolable'],
    './config/PlayableConfig': [
      'IPlayableCTAConfig', 'IPlayableAudioConfig', 'IPlayableGameplayConfig',
      'IPlayableCameraPreset', 'IPlayableCameraConfig', 'IPlayableHeroConfig',
      'IPlayableTrackingConfig', 'IPlayableConfig', 'DEFAULT_PLAYABLE_CONFIG',
    ],
    './config/PlayableConfigManager': ['PlayableConfigManager'],
    './components/CameraController': ['CameraController', 'CameraAngleMode'],
    './components/Interactive3DHero': ['Interactive3DHero'],
    './components/PlayableAudioController': ['PlayableAudioController'],
    './components/PlayableCTAController': ['PlayableCTAController'],
    './components/PlayableEntry': ['PlayableEntry'],
    './components/PlayableTrackingController': ['PlayableTrackingController', 'PlayableEventType'],
    './components/PlayableUIHUD': ['PlayableUIHUD'],
  },
  'playable-sdk': {
    './analytics/GameTrackingService': ['GameTrackingService'],
    './platform/SuperHtmlPlayable': ['SuperHtmlPlayable', 'superHtmlPlayable'],
    './platform/PlayableAdDownloadEvent': ['PlayableAdDownloadEvent'],
  },
};

function exportedDeclarations(filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set();
  for (const statement of sourceFile.statements) {
    const exported = statement.modifiers
      && statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if ((ts.isClassDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isFunctionDeclaration(statement))
      && statement.name) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function walkTypeScript(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScript(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(fullPath);
  }
  return files;
}

test('concrete package subpaths preserve every symbol formerly exposed by Component barrels', () => {
  for (const [packageName, entrypoints] of Object.entries(FORMER_PUBLIC_SYMBOLS)) {
    const packageRoot = path.join(PACKAGES_ROOT, packageName);
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    for (const [subpath, symbols] of Object.entries(entrypoints)) {
      const target = packageJson.exports[subpath];
      assert.equal(typeof target, 'string', `${packageName} is missing export ${subpath}`);
      assert.doesNotMatch(target, /(?:^|\/)index\.ts$/, `${packageName}:${subpath} must target a concrete module`);
      const filePath = path.resolve(packageRoot, target);
      assert.equal(fs.existsSync(filePath), true, `${packageName}:${subpath} target is missing`);
      const exported = exportedDeclarations(filePath);
      for (const symbol of symbols) {
        assert.equal(exported.has(symbol), true, `${packageName}:${subpath} no longer exports ${symbol}`);
      }
    }
  }
});

test('shared package source has no multi-Component concrete or barrel module', () => {
  const files = [
    ...walkTypeScript(path.join(PACKAGES_ROOT, 'playable-core')),
    ...walkTypeScript(path.join(PACKAGES_ROOT, 'playable-sdk')),
  ];
  assert.deepEqual(
    lintCocosComponentModules(files, { projectRoot: PACKAGES_ROOT }),
    [],
  );
});

test('package barrels preserve safe utilities while excluding decorated Components', () => {
  const coreIndex = fs.readFileSync(path.join(PACKAGES_ROOT, 'playable-core/index.ts'), 'utf8');
  assert.match(coreIndex, /export \{ GameUtils \}/);
  assert.match(coreIndex, /export \{ ObjectPool, PoolHandle, type PoolConfig, type PoolKey \}/);
  assert.match(coreIndex, /export \{ makeNodePoolConfig \}/);
  assert.match(coreIndex, /export \* from '\.\/config\/index'/);
  assert.doesNotMatch(coreIndex, /export[^\n]*(?:GameManager|SoundManager|Poolable|\.\/components)/);

  const sdkIndex = fs.readFileSync(path.join(PACKAGES_ROOT, 'playable-sdk/index.ts'), 'utf8');
  assert.match(sdkIndex, /export \{ GameTrackingService \}/);
  assert.match(sdkIndex, /export \{ SuperHtmlPlayable, superHtmlPlayable \}/);
  assert.doesNotMatch(sdkIndex, /export[^\n]*PlayableAdDownloadEvent/);
});
