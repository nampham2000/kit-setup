'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { insertGeneratedStamp, shouldDeployUserHome,copyFileSafe,injectGenerated,copyDirRecursive } = require('./ai-knowledge-sync.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');

test('copy and rendered instruction injection preserve unchanged output mtimes',t=>{
  const base=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'ai-sync-idempotent-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),base);fs.rmSync(dir,{recursive:true,force:true});});
  const src=path.join(dir,'template.md'),dest=path.join(dir,'agent.md'),blocks={commands:'native commands'};fs.writeFileSync(src,'# Agent\n');
  copyFileSafe(src,dest,blocks);fs.utimesSync(dest,new Date(1000000),new Date(1000000));const before=fs.readFileSync(dest),mtime=fs.statSync(dest).mtimeMs;
  copyFileSafe(src,dest,blocks);injectGenerated(dest,blocks);assert.deepEqual(fs.readFileSync(dest),before);assert.equal(fs.statSync(dest).mtimeMs,mtime);
  const skills=path.join(dir,'skills'),target=path.join(dir,'target');fs.mkdirSync(path.join(skills,'unity-to-cocos-porting'),{recursive:true});fs.copyFileSync(src,path.join(skills,'unity-to-cocos-porting/SKILL.md'));
  copyDirRecursive(skills,target,blocks);const skill=path.join(target,'unity-to-cocos-porting/SKILL.md');fs.utimesSync(skill,new Date(1000000),new Date(1000000));copyDirRecursive(skills,target,blocks);injectGenerated(skill,blocks);assert.equal(fs.statSync(skill).mtimeMs,1000000);
});

test('generated stamp preserves SKILL.md YAML frontmatter at byte zero', () => {
  const source = '---\nname: unity-to-cocos-porting\ndescription: test\n---\n\n# Skill\n';
  const output = insertGeneratedStamp(source, '<!-- generated -->');
  assert.equal(output.startsWith('---\n'), true);
  assert.match(output, /^---\n[\s\S]*?\n---\n<!-- generated -->\n/);
});

test('generated stamp remains the first line for ordinary agent instruction files', () => {
  assert.equal(insertGeneratedStamp('# Agent\n', '<!-- generated -->'), '<!-- generated -->\n# Agent\n');
});

test('project-only sync skips machine-local skill deployment without changing the default', () => {
  assert.equal(shouldDeployUserHome({}), true);
  assert.equal(shouldDeployUserHome({ CC_PLAYABLE_AI_SYNC_PROJECT_ONLY: '0' }), true);
  assert.equal(shouldDeployUserHome({ CC_PLAYABLE_AI_SYNC_PROJECT_ONLY: '1' }), false);
});
