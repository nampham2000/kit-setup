'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {contentProbeClips}=require('./runtime-content-probes.cjs');
test('extra source content points supplement all original blank-frame probes',()=>{
 const base=contentProbeClips(1280,720),extra=contentProbeClips(1280,720,[[.3,.4]]);
 assert.deepEqual(extra.slice(0,3),base);assert.deepEqual(extra[3],{x:384,y:288,width:16,height:16,scale:1});
 const blank=extra.map(()=> 'same pixels');assert.equal(blank.every(p=>p===blank[0]),true);
 const visible=blank.slice();visible[3]='native content location has pixels';assert.equal(visible.every(p=>p===visible[0]),false);
});
test('probe rectangles stay inside portrait, edge and tiny viewports',()=>{
 for(const [w,h]of [[720,1280],[1,1],[8,12]])for(const r of contentProbeClips(w,h,[[0,0],[1,1]])){assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);}
});
test('invalid and excessive reference probe points fail closed',()=>{
 for(const points of [null,[[NaN,0]],[[1.01,0]],[[-.1,0]],[[0]],Array(17).fill([0,0])])assert.throws(()=>contentProbeClips(1280,720,points));
});
