'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const cache={};function load(name){if(cache[name])return cache[name];const out=cache[name]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(out,n=>n==='cc'?{}:load(n.slice(2)));return out;}
const kernel=load('UnityParticleStartRotation'),runtime=load('UnityParticleSizeRandom'),native=require('./fixtures/size-random-native.json');
test('512 native size seeds use a separate salted channel shared across XYZ',()=>{
 assert.equal(native.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-size-random.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
 assert.equal(native.rows.length,512);
 for(const row of native.rows){const actual=kernel.unityParticleSeedRandom(row.seed,0x8d2c8431);for(const size of row.size)assert.ok(Math.abs(size-actual)<2e-7,`seed ${row.seed}`);}
});
test('size animation preserves curve evaluation, nonuniform birth scale and stock-seed fallback',()=>{
 let stock=0;const curve={mode:3,evaluate:(age,u)=>age+u},module={separateAxes:true,x:curve,y:curve,z:curve,size:curve,animate(){stock++;}},system={sizeOvertimeModule:module};runtime.installUnityParticleSizeRandom(system);const hook=module.animate;runtime.installUnityParticleSizeRandom(system);assert.equal(module.animate,hook);
 for(const row of native.rows.slice(4))for(const separate of [true,false]){module.separateAxes=separate;const p={unityNativeSeed:row.seed,randomSeed:1,startLifetime:2,remainingLifetime:1,startSize:{x:2,y:3,z:4},size:{}};module.animate(p,1/60);for(const [i,axis]of ['x','y','z'].entries())assert.ok(Math.abs(p.size[axis]-(2+i)*(.5+row.size[i]))<1e-6);assert.equal(p.randomSeed,1);}
 module.animate({randomSeed:1},1/60);assert.equal(stock,1);
});

test('deterministic size curves retain the stock module',()=>{const module={size:{mode:1},animate(){}},hook=module.animate,system={sizeOvertimeModule:module};runtime.installUnityParticleSizeRandom(system);assert.equal(module.animate,hook);assert.equal(system.unitySizeRandom,undefined);});
