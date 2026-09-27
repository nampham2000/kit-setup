'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const loaded={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityLocalZTranslation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(loaded.exports,loaded);
const fixture=require('./fixtures/translate-float-native.json'),translate=loaded.exports.unityLocalZTranslation,f=Math.fround;
test('native translation fixture binds exact producer',()=>{
 const source=fs.readFileSync(path.join(__dirname,'fixtures/capture-translate-float.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(source).digest('hex'),fixture.producerSha256);
});
for(const row of fixture.rows.filter(r=>r.step[0]===0&&r.step[1]===0))for(const reflected of [false,true])test(`local Z float trajectory ${row.euler} reflected=${reflected}`,()=>{
 const sign=reflected?-1:1,q={x:f(row.rotation[0])*sign,y:f(row.rotation[1])*sign,z:f(row.rotation[2]),w:f(row.rotation[3])},p={x:0,y:0,z:0};
 for(const frame of row.frames){translate(p,p,q,f(row.step[2])*sign);assert.deepEqual([p.x,p.y,p.z],[f(frame.position[0]),f(frame.position[1]),f(frame.position[2])*sign],`frame ${frame.frame}`);}
});
