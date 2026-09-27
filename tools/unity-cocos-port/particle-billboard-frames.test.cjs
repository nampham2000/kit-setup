'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const native=require('./fixtures/billboard-frames-native.json');
const spin=require('./fixtures/billboard-spin-native.json');
const {particleRendererContract}=require('./particle-renderer-contract');
const {applyParticleStartRotation}=require('./particle-system-converter');
const mul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
function euler(angles){const a=angles.map((degrees,i)=>{const result=[0,0,0,Math.cos(degrees*Math.PI/360)];result[i]=Math.sin(degrees*Math.PI/360);return result;});return mul(mul(a[1],a[0]),a[2]);}
function rotate(q,v){return mul(mul(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]).slice(0,3);}
const effect=fs.readFileSync(path.join(__dirname,'source-particle.effect'),'utf8');
test('fixture is complete and bound to its native capture script',()=>{
  assert.equal(native.cases.length,30);assert.equal(native.unityVersion,'6000.3.1f1');
  assert.equal(native.captureSha256Lf,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-billboard-frames.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
});
test('spin fixture is bound to native capture and integrates each Euler component',()=>{
  assert.equal(spin.cases.length,6);
  assert.equal(spin.captureSha256Lf,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-billboard-spin.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
  for(const row of spin.cases)row.rotation.forEach((v,axis)=>assert.ok(Math.abs(v-row.startRotation[axis]-row.angularVelocity[axis]*row.dt*row.steps)<.0002));
});
for(const c of [...native.cases,...spin.cases].filter(c=>c.mode===2||c.mode===3&&c.camera[0]===0||c.mode===0&&[0,1,2].includes(c.alignment)))test(`native ${c.steps?'spin':'birth'} mode ${c.mode}, alignment ${c.alignment}, camera ${c.camera}: all four UV corners`,()=>{
  const contract=particleRendererContract({}, {m_RenderMode:c.mode,m_RenderAlignment:c.alignment});
  const q=euler(c.mode===0?c.rotation.map((v,i)=>v*contract.eulerSigns[i]):[0,0,-c.rotation[2]]);
  const camera=euler(c.camera.map((v,i)=>v*(i===2?1:-1)));
  c.vertices.forEach((vertex,i)=>{
    const corner=[c.uv[i][0]-.5,c.uv[i][1]-.5,0];
    let offset;
    if(c.mode===0){
      offset=rotate(q,[corner[0]*c.size[0],corner[1]*c.size[1],0]);
      if(c.alignment===0)offset=rotate(camera,offset);
      if(c.alignment===2)offset=rotate(euler(c.emitter.map((v,i)=>v*(i===2?1:-1))),offset);
    }
    else {
      const r=rotate(q,corner),x=r[0]*c.size[0]/Math.sqrt(2),y=r[1]*c.size[1]/Math.sqrt(2);
      offset=c.mode===2?[x,0,-y]:rotate(camera,[x,0,0]).map((value,axis)=>value+(axis===1?y:0));
    }
    const actual=offset.map((value,axis)=>value+c.position[axis]*(axis===2?-1:1));
    const expected=vertex.map((value,axis)=>value*(axis===2?-1:1));
    actual.forEach((value,axis)=>assert.ok(Math.abs(value-expected[axis])<3e-6,`UV ${c.uv[i]} axis ${axis}: ${value} vs ${expected[axis]}`));
  });
  if(c.mode!==0)assert.equal(contract.unsupported.includes('alignment'),false);
});
test('source vertex uses Z-X-Y and inverse-view columns, and scales axial corners after rotation',()=>{
  assert.match(effect,/rot=sourceEuler\(rotEuler\)/);
  assert.match(effect,/normalize\(cc_matViewInv\[0\]\.xyz\)\*offset.x/);
  assert.match(effect,/rotateVecFromQuat\(offset,rot\);\s*offset.xy\*=compScale.xy/);
});
test('converter uses the native View Y sign for both constants and curve multipliers',()=>{
  const objects=[{startRotationX:{__id__:1},startRotationY:{__id__:2},startRotationZ:{__id__:3}},{},{},{}];
  const particle={InitialModule:{rotation3D:true,startRotationX:{scalar:1},startRotationY:{scalar:2},startRotation:{scalar:3}}};
  applyParticleStartRotation({objects},objects[0],particle,{m_RenderMode:0,m_RenderAlignment:0});
  assert.deepEqual(objects.slice(1).map(curve=>curve.constant),[-1,-2,-3]);
  applyParticleStartRotation({objects},objects[0],particle,{m_RenderMode:0,m_RenderAlignment:2});
  assert.deepEqual(objects.slice(1).map(curve=>curve.constant),[1,2,-3]);
});
