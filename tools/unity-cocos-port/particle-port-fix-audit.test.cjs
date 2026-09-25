'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {audit}=require('./particle-port-fix-audit.cjs');
const root=path.resolve(__dirname,'../..');
const source=JSON.parse(fs.readFileSync(path.join(root,'ai/particle-port-fixes.json'),'utf8'));
test('all resolved AOE particle bugs route to shared code/tests and a source-specific acceptance gate',()=>{
  const result=audit(source,root);assert.deepEqual(result.errors,[]);assert.equal(result.count,23);
  assert.ok(result.byApplicability.automatic>0 && result.byApplicability.conditional>0 && result.byApplicability.recipe>0);
  assert.ok(source.fixes.some(f=>f.id==='nested-birth-transform-cache'&&f.sharedPaths.includes('tools/unity-cocos-port/runtime/UnityParticleNestedEmission.ts')));
});
test('audit fails closed for missing implementation, unsupported classification and duplicate fix',()=>{
  const mutated=structuredClone(source);
  mutated.fixes[0].sharedPaths[0]='tools/unity-cocos-port/does-not-exist.js';
  mutated.fixes[1].applicability='automatic-for-everyone';
  mutated.fixes[1].id=mutated.fixes[0].id;
  const result=audit(mutated,root);
  assert.equal(result.ok,false);assert.ok(result.errors.some(s=>s.includes('does-not-exist')));
  assert.ok(result.errors.some(s=>s.includes('repeated id')));
  assert.ok(result.errors.some(s=>s.includes('invalid applicability')));
});
