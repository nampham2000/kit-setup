'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleLimitVelocity.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(out);
const fixture=require('./fixtures/limit-curve-phase-native.json');
test('native limit curve samples start-of-step age without changing other module ages',()=>{
 assert.equal(fixture.rows.length,21);
 for(const row of fixture.rows){
  const module={dampen:1,animate(p){const t=1-p.remainingLifetime/p.startLifetime,[a,b]=fixture.keys;const speed=a.value+(b.value-a.value)*(3*t*t-2*t*t*t);p.ultimateVelocity.y=-speed;p.velocity.y=-speed;}};
  const particle={startLifetime:row.life,remainingLifetime:row.remaining,velocity:{x:0,y:-10,z:0},ultimateVelocity:{x:0,y:-10,z:0},animatedVelocity:{x:0,y:0,z:0}};
  out.installUnityParticleLimitVelocity({limitVelocityOvertimeModule:module});module.animate(particle,fixture.dt);
  assert.equal(particle.remainingLifetime,row.remaining,'restore age for following modules');
  assert.ok(Math.abs(particle.velocity.y-row.velocity[1])<2e-6,JSON.stringify({frame:row.frame,seed:row.seed,actual:particle.velocity.y,native:row.velocity[1]}));
 }
});
