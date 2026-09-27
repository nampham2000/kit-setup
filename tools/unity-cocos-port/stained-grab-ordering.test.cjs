'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const result={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityStainedGrabOrdering.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(result.exports,result);
const precedes=result.exports.unityPrecedesStainedGrab,fixture=require('./fixtures/stained-grab-ties-native.json');
test('native stained-glass draw-order fixture binds producer and covers 192 cases',()=>{
 const source=fs.readFileSync(path.join(__dirname,'fixtures/capture-stained-grab-ties.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(source).digest('hex'),fixture.producerSha256);
 assert.equal(fixture.rows.length,192);
});
for(const row of fixture.rows)test(`${row.particleShader} perspective=${row.perspective} order=${row.additiveOrderOffset} creation=${row.reverseCreation} materials=${row.reverseMaterials} siblings=${row.reverseSiblings}`,()=>{
 assert.equal(row.redBounds,row.greenBounds);
 assert.equal(precedes(row.additiveOrderOffset,0,true),row.rgb[1]>0);
});
test('unknown shader ties are not silently treated as measured legacy particles',()=>{
 assert.equal(precedes(0,0,false),false);assert.equal(precedes(-1,0,false),true);
 assert.equal(precedes(1,0,true),false);
});
