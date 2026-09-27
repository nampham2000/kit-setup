'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, captureScript, validateManifestFrames, validateCaptureClock } = require('./unity-reference-capture.cjs');
const {captureUnityReference}=require('./unity-reference-capture.cjs');

function captureFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capture-request-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'manifest.json'),old=JSON.stringify({complete:true,requestId:'unrelated'});fs.writeFileSync(file,old);
 const options={project:dir,scene:'Assets/Demo.unity',out:dir,width:1280,height:720,frameRate:60,frames:[0,30],timeoutMs:2000};
 const request=args=>JSON.parse(JSON.parse('"'+args.csharpCode.match(/Begin\("((?:\\.|[^"\\])*)"\)/)[1]+'"'));
 const write=id=>fs.writeFileSync(file,JSON.stringify({...manifestFrames([0,30]),requestId:id,complete:true,visibilityClock:'continuous-request-viewport-v1',renderedFrames:31}));
 return {file,old,options,request,write,dependencies:{readConnection:()=>({url:'http://localhost/mock'}),readFile:()=>imageHeader()}};
}
test('lost Play Mode RPC acknowledgement consumes only its own completed request',async t=>{
 const f=captureFixture(t);let calls=0;
 const got=await captureUnityReference(f.options,{...f.dependencies,callMcp:async(c,n,args)=>{calls++;assert.equal(fs.readFileSync(f.file,'utf8'),f.old);f.write(f.request(args).requestId);throw Object.assign(new Error('RPC lost during reload'),{code:'UNITY_MCP_TIMEOUT'});}});
 assert.equal(got.complete,true);assert.notEqual(got.requestId,'unrelated');assert.equal(calls,1);
});
test('busy rejection preserves a pre-existing capture manifest',async t=>{
 const f=captureFixture(t);
 await assert.rejects(captureUnityReference(f.options,{...f.dependencies,callMcp:async()=>({content:[{text:'editor has an active or queued capture'}]})}),{code:'UNITY_CAPTURE_REJECTED'});
 assert.equal(fs.readFileSync(f.file,'utf8'),f.old);
});
test('queued capture ignores a stale manifest even when its frames would pass',async t=>{
 const f=captureFixture(t);let id,sleeps=0;f.write('unrelated');
 const got=await captureUnityReference(f.options,{...f.dependencies,callMcp:async(c,n,args)=>{id=f.request(args).requestId;return {content:[{text:'capture queued'}]};},sleep:async()=>{sleeps++;f.write(id);}});
 assert.equal(got.requestId,id);assert.equal(sleeps,1);
});
test('non-transport failures are not hidden behind a manifest wait',async t=>{
 const f=captureFixture(t);
 await assert.rejects(captureUnityReference(f.options,{...f.dependencies,callMcp:async()=>{throw Object.assign(new Error('compiler error'),{code:'UNITY_MCP_TOOL_ERROR'});},sleep:async()=>assert.fail('must not wait')}),{code:'UNITY_MCP_TOOL_ERROR'});
 assert.equal(fs.readFileSync(f.file,'utf8'),f.old);
});
test('stale live capture package is rejected before a request can be queued',async t=>{
 const f=captureFixture(t);assert.match(captureScript({}),/GetField\("requestId"\)/);
 await assert.rejects(captureUnityReference(f.options,{...f.dependencies,callMcp:async()=>({content:[{text:'capture package requires refresh: requestId protocol unavailable'}]})}),{code:'UNITY_CAPTURE_PROTOCOL_UNVERIFIED'});
 assert.equal(fs.readFileSync(f.file,'utf8'),f.old);
});

const base = ['--project', 'U', '--scene', 'Assets/Demo.unity', '--out', 'o', '--frames', '0,30'];

test('Batch capture requires visibility rendering on skipped frames too', () => {
  for (const manifest of [{}, { visibilityClock: 'continuous-request-viewport-v1', renderedFrames: 2 },
    { visibilityClock: 'continuous-request-viewport-v1', renderedFrames: 30 }])
    assert.throws(() => validateCaptureClock(manifest, [0, 30]), { code: 'UNITY_CAPTURE_VISIBILITY_CLOCK_UNVERIFIED' });
  validateCaptureClock({ visibilityClock: 'continuous-request-viewport-v1', renderedFrames: 31 }, [30, 0]);
  validateCaptureClock({ visibilityClock: 'game-view-and-request-viewport', renderedFrames: 2 }, [0, 30]);
});
function spawnsFile(t, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-spawns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'spawns.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test('spawns map to the ReferenceCapture Spawn shape and keep prefab rotation by default', t => {
  const options = parseArgs([...base, '--spawns', spawnsFile(t, [
    { prefab: 'Assets/FX/Marker 1.prefab', frame: 1, position: [1, 0.01, -2] },
    { prefab: 'Assets/FX/Beam.prefab', frame: 5, position: [0, 1, 0], eulerAngles: [0, 90, 0] },
  ])]);
  assert.deepEqual(options.spawns, [
    { prefab: 'Assets/FX/Marker 1.prefab', frame: 1, position: { x: 1, y: 0.01, z: -2 }, useRotation: false, eulerAngles: { x: 0, y: 0, z: 0 } },
    { prefab: 'Assets/FX/Beam.prefab', frame: 5, position: { x: 0, y: 1, z: 0 }, useRotation: true, eulerAngles: { x: 0, y: 90, z: 0 } },
  ]);
  // The request travels as an escaped C# string literal into script-execute.
  assert.match(captureScript({ spawns: options.spawns }), /Marker 1\.prefab/);
});

test('malformed spawns fail before Unity is contacted', t => {
  assert.throws(() => parseArgs([...base, '--spawns', spawnsFile(t, [{ prefab: 'Packages/x.prefab', frame: 1, position: [0, 0, 0] }])]), /prefab/);
  assert.throws(() => parseArgs([...base, '--spawns', spawnsFile(t, [{ prefab: 'Assets/x.prefab', frame: -1, position: [0, 0, 0] }])]), /frame/);
  assert.throws(() => parseArgs([...base, '--spawns', spawnsFile(t, [{ prefab: 'Assets/x.prefab', frame: 1, position: [0, 0] }])]), /position/);
});

test('--field overrides reach the request and reject malformed input', () => {
  const options = parseArgs([...base, '--field', 'CameraHolder.Prefab=3', '--field', 'Demo.speed=0.5']);
  assert.deepEqual(options.fields, [{ component: 'CameraHolder', field: 'Prefab', value: '3' }, { component: 'Demo', field: 'speed', value: '0.5' }]);
  assert.throws(() => parseArgs([...base, '--field', 'CameraHolder=3']), /Component\.field=value/);
});

function imageHeader(width = 1280, height = 720) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
test('isolated prefab capture disables only explicit demo component types before Start', () => {
  const options = parseArgs([...base, '--disable-component', 'demo']);
  assert.deepEqual(options.disableComponents, ['demo']);
  assert.match(captureScript({ disableComponents: options.disableComponents }), /disableComponents/);
  assert.throws(() => parseArgs([...base, '--disable-component', '../demo']), /MonoBehaviour/);
});
function manifestFrames(frames) {
  return { camera: 'Main Camera', width: 1280, height: 720,
    frames: frames.map(frame => ({ frame, file: `frame-${String(frame).padStart(5, '0')}.png` })) };
}
test('capture receipt rejects empty, partial, duplicate or camera-less results', () => {
  for (const manifest of [manifestFrames([]), manifestFrames([0]), manifestFrames([0, 30, 30]), { ...manifestFrames([0, 30]), camera: '' }]) {
    assert.throws(() => validateManifestFrames(manifest, [0, 30], 'out', () => imageHeader()), { code: 'UNITY_CAPTURE_INCOMPLETE' });
  }
});
test('capture receipt checks image existence, PNG header, viewport and canonical paths', () => {
  const valid = manifestFrames([0, 30]);
  for (const readFile of [() => { throw new Error('missing'); }, () => Buffer.from('not an image'), () => imageHeader(720, 1280)]) {
    assert.throws(() => validateManifestFrames(valid, [0, 30], 'out', readFile), { code: 'UNITY_CAPTURE_INCOMPLETE' });
  }
  const unsafe = manifestFrames([0, 30]);
  unsafe.frames[0].file = '../other.png';
  assert.throws(() => validateManifestFrames(unsafe, [0, 30], 'out', () => imageHeader()), /path/);
});
test('capture receipt accepts every requested frame even if order differs', () => {
  const files = [];
  validateManifestFrames(manifestFrames([30, 0]), [0, 30, 30], 'out', file => { files.push(path.basename(file)); return imageHeader(); });
  assert.deepEqual(files, ['frame-00030.png', 'frame-00000.png']);
});
