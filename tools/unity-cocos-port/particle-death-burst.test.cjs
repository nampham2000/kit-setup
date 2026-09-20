'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
class Vec3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  static subtract(out,a,b){out.x=a.x-b.x;out.y=a.y-b.y;out.z=a.z-b.z;}
  static add(out,a,b){out.x=a.x+b.x;out.y=a.y+b.y;out.z=a.z+b.z;}
}
const exportsResult={};
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleDeathBurst.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
new Function('exports','require',compiled)(exportsResult,name=>name==='cc'?{Vec3,Mat4:class {}}:{UnityParticleSubEmitterFollower:class {}});
function makeSystem(){
 const pool={data:[],length:0,removeAt(i){this.data.splice(i,1);this.length--;}};
 const processor={_particles:pool,setNewParticle(p){pool.data.push(p);pool.length++;},updateParticles(dt){for(let i=pool.length-1;i>=0;i--){const p=pool.data[i];p.remainingLifetime=Math.fround(p.remainingLifetime-dt);if(p.remainingLifetime<0){pool.removeAt(i);continue;}for(const k of ['x','y','z'])p.position[k]=Math.fround(p.position[k]+p.velocity[k]*dt);}return pool.length;}};
 return {capacity:16,simulationSpace:0,node:{getComponents(){return[];},worldPosition:new Vec3()},processor,trailModule:{enable:false},bursts:[],rateOverTime:{},rateOverDistance:{},stop(){},play(){},emit(count){for(let i=0;i<count;i++)processor.setNewParticle({position:new Vec3(),velocity:new Vec3(),remainingLifetime:1});}};
}
for(const oracle of require('./fixtures/death-burst.json'))test(`native Death callback count and integrated position, dt=${oracle.step}`,()=>{
 const source=makeSystem(),target=makeSystem(),second=makeSystem();
 const before=source.processor.updateParticles;
 const firstLink=new exportsResult.UnityParticleDeathBurst(source,target,1),secondLink=new exportsResult.UnityParticleDeathBurst(source,second,1);
 source.processor.setNewParticle({position:new Vec3(1,2,3),velocity:new Vec3(2,3,4),remainingLifetime:Math.fround(.05)});
 for(const sample of oracle.samples){
  source.processor.updateParticles(Math.fround(oracle.step));
  assert.equal(source.processor._particles.length,sample.parentCount);
  assert.equal(target.processor._particles.length,sample.childCount);
  assert.equal(second.processor._particles.length,sample.childCount);
  if(sample.childCount)for(const [i,k] of ['x','y','z'].entries())assert.ok(Math.abs(target.processor._particles.data[0].position[k]-sample.childPosition[i])<1e-6);
 }
 assert.equal(firstLink.emitted,1);assert.equal(secondLink.emitted,1);
 secondLink.destroy();assert.notEqual(source.processor.updateParticles,before);
 firstLink.destroy();assert.equal(source.processor.updateParticles,before);
});
