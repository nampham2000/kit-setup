'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { lintCocosComponentModules, RULE_ID } = require('./cocos-component-module-linter.cjs');

function createFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-component-lint-'));
  const paths = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    if (/\.tsx?$/i.test(filePath)) paths.push(filePath);
  }
  return {
    root,
    paths,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const BASE = `
import { Component } from 'cc';
export abstract class ParticleAdapterBase extends Component {}
`;

test('flags decorated Components through a relative imported base class', () => {
  const fixture = createFixture({
    'base.ts': BASE,
    'multi.ts': `
import { _decorator } from 'cc';
import { ParticleAdapterBase } from './base';
const { ccclass } = _decorator;
@ccclass('BurstA')
export class BurstA extends ParticleAdapterBase {}
@ccclass('BurstB')
export class BurstB extends ParticleAdapterBase {}
`,
  });
  try {
    const violations = lintCocosComponentModules(fixture.paths, { projectRoot: fixture.root });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, RULE_ID);
    assert.equal(violations[0].file, 'multi.ts');
    assert.match(violations[0].message, /BurstA, BurstB/);
    assert.match(violations[0].message, /null _sealed/);
  } finally {
    fixture.cleanup();
  }
});

test('does not count @ccclass serializable data or an unrelated class named Component', () => {
  const fixture = createFixture({
    'data-base.ts': `export class Component {}`,
    'mixed.ts': `
import { _decorator, Component as CocosComponent, EventHandler } from 'cc';
import { Component as DataComponent } from './data-base';
const { ccclass } = _decorator;
@ccclass('StatsData')
export class StatsData {}
@ccclass('OtherData')
export class OtherData extends DataComponent {}
@ccclass('HandlerData')
export class HandlerData extends EventHandler {}
@ccclass('OnlyRuntimeComponent')
export class OnlyRuntimeComponent extends CocosComponent {}
`,
  });
  try {
    assert.deepEqual(
      lintCocosComponentModules(fixture.paths, { projectRoot: fixture.root }),
      [],
    );
  } finally {
    fixture.cleanup();
  }
});

test('recognizes aliased and namespace Cocos bindings plus a local inheritance chain', () => {
  const fixture = createFixture({
    'aliases.ts': `
import { _decorator as decorators, Component as CocosComponent } from 'cc';
import * as cc from 'cc';
const { ccclass: cocosClass } = decorators;
abstract class LocalBase extends CocosComponent {}
@cocosClass('AliasedComponent')
export class AliasedComponent extends LocalBase {}
@cc._decorator.ccclass('NamespaceComponent')
export class NamespaceComponent extends cc.Component {}
`,
  });
  try {
    const violations = lintCocosComponentModules(fixture.paths, { projectRoot: fixture.root });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, 'aliases.ts');
  } finally {
    fixture.cleanup();
  }
});

test('fails a barrel that re-exports multiple Components in all supported forms', () => {
  const files = { 'base.ts': BASE };
  for (const name of ['A', 'B', 'C', 'D']) {
    files[`${name.toLowerCase()}.ts`] = `
import { _decorator } from 'cc';
import { ParticleAdapterBase } from './base';
const { ccclass } = _decorator;
@ccclass('${name}')
export class ${name} extends ParticleAdapterBase {}
`;
  }
  files['barrel.ts'] = `
import { D } from './d';
export { A } from './a';
export * from './b';
export { C as PublicC } from './c';
export { D };
`;
  const fixture = createFixture(files);
  try {
    const violations = lintCocosComponentModules(fixture.paths, { projectRoot: fixture.root });
    assert.equal(violations.length, 3);
    assert.ok(violations.every((violation) => violation.file === 'barrel.ts'));
    assert.ok(violations.every((violation) => /marker\/barrel modules Component-free/.test(violation.message)));
  } finally {
    fixture.cleanup();
  }
});

test('allows one decorated Component per concrete module with a Component-free marker', () => {
  const fixture = createFixture({
    'base.ts': BASE,
    'a.ts': `
import { _decorator } from 'cc';
import { ParticleAdapterBase } from './base';
const { ccclass } = _decorator;
@ccclass('A') export class A extends ParticleAdapterBase {}
`,
    'b.ts': `
import { _decorator } from 'cc';
import { ParticleAdapterBase } from './base';
const { ccclass } = _decorator;
@ccclass('B') export class B extends ParticleAdapterBase {}
`,
    'marker.ts': `export const COMPONENT_MODULE_LAYOUT = 1;`,
  });
  try {
    assert.deepEqual(
      lintCocosComponentModules(fixture.paths, { projectRoot: fixture.root }),
      [],
    );
  } finally {
    fixture.cleanup();
  }
});

test('zero-gc CLI integrates the project-wide Component module gate', () => {
  const fixture = createFixture({
    'assets/base.ts': BASE,
    'assets/multi.ts': `
import { _decorator } from 'cc';
import { ParticleAdapterBase } from './base';
const { ccclass } = _decorator;
@ccclass('First') export class First extends ParticleAdapterBase {}
@ccclass('Second') export class Second extends ParticleAdapterBase {}
`,
  });
  try {
    const cli = path.join(__dirname, 'zero-gc-linter.cjs');
    const proc = spawnSync(process.execPath, [cli, '--json'], {
      cwd: fixture.root,
      env: { ...process.env, PLAYABLE_PROJECT_ROOT: fixture.root },
      encoding: 'utf8',
    });
    assert.equal(proc.status, 1, proc.stderr || proc.stdout);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.errorCount, 1);
    assert.equal(result.violations[0].rule, RULE_ID);
    assert.equal(result.violations[0].file, 'assets/multi.ts');
  } finally {
    fixture.cleanup();
  }
});
