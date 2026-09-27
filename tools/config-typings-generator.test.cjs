'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTypings,
  propertyName,
  generateTypings,
} = require('./config-typings-generator.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');

test('help and invalid CLI arguments never generate configuration typings',()=>{
  const output=path.resolve(__dirname,'../../assets/script/shared/core/config/PlayableConfigTypes.d.ts');
  const snapshot=()=>fs.existsSync(output)?{mtime:fs.statSync(output).mtimeMs,bytes:fs.readFileSync(output).toString('base64')}:null;
  const before=snapshot();
  for(const args of [['--help'],['--unknown'],['--check','--help']]){
    const result=spawnSync(process.execPath,[path.join(__dirname,'config-typings-generator.cjs'),...args],{encoding:'utf8'});
    assert.equal(result.status,args[0]==='--help'?0:1);assert.deepEqual(snapshot(),before);
  }
});

test('unchanged generation preserves bytes and mtime; check rejects stale types without writing',t=>{
  const base=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'config-types-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),base);fs.rmSync(dir,{recursive:true,force:true});});
  const resources=path.join(dir,'assets/resources');fs.mkdirSync(resources,{recursive:true});
  const configPath=path.join(resources,'playable-config.json'),outputPath=path.join(dir,'Types.d.ts');fs.writeFileSync(configPath,JSON.stringify({custom:{speed:1}}));
  generateTypings({configPath,outputPath});fs.utimesSync(outputPath,new Date(1000000),new Date(1000000));
  const snapshot=()=>({mtime:fs.statSync(outputPath).mtimeMs,sha:crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')});
  const before=snapshot();generateTypings({configPath,outputPath});generateTypings({configPath,outputPath,check:true});assert.deepEqual(snapshot(),before);
  fs.writeFileSync(configPath,JSON.stringify({custom:{speed:1,enabled:true}}));assert.throws(()=>generateTypings({configPath,outputPath,check:true}),/Stale/);assert.deepEqual(snapshot(),before);
  generateTypings({configPath,outputPath});assert.notEqual(snapshot().sha,before.sha);
});

test('quotes unsafe config property names and keeps safe identifiers readable', () => {
  assert.equal(propertyName('speed'), 'speed');
  assert.equal(propertyName('fx/Demo/Fireball (projectile)'), '"fx/Demo/Fireball (projectile)"');
  assert.equal(propertyName('has-hyphen'), '"has-hyphen"');
});

test('does not emit the custom property twice when config defines it', () => {
  const output = buildTypings({
    custom: {
      projectiles: {
        'fx/Demo/Fireball (projectile)': { radius: 2 },
      },
    },
  });

  assert.match(output, /"fx\/Demo\/Fireball \(projectile\)":/);
  assert.equal((output.match(/\bcustom\?:/g) || []).length, 1);
  assert.doesNotMatch(output, /custom\?: Record<string, any>/);
});

test('keeps the backwards-compatible custom fallback when config omits it', () => {
  const output = buildTypings({ gameplay: { duration: 30 } });
  assert.match(output, /custom\?: Record<string, any>/);
});

test('does not expose fragment manifest metadata as a gameplay config section', () => {
  const output = buildTypings({
    $fragments: { cta: 'playable-config/cta' },
    cta: { googlePlayUrl: 'https://example.test' },
  });
  assert.doesNotMatch(output, /fragments/i);
  assert.match(output, /googlePlayUrl\?: string/);
});
