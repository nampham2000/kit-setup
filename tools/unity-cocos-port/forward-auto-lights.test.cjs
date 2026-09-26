'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityForwardAutoLights.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(out);
function fixture(name,probe){const f=require('./fixtures/'+name+'.json');assert.equal(f.colorSpace,'Linear');assert.equal(f.lightsUseLinearIntensity,true);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-'+probe+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));return f;}
function compare(row,samples,sumColor){
 const selection=new out.UnityForwardAutoLights(32);selection.select(samples,row.count,{x:1000,y:0,z:0},{x:5,y:0,z:5});
 let pixel=0;for(let i=0;i<selection.pixelCount;i++)pixel+=sumColor(selection.slots[i])*selection.weights[i];
 assert.ok(Math.abs(pixel-row.slots[14][0])<4e-6,`pixel sum ${pixel} vs ${row.slots[14][0]}`);
 // Near-tied scores amplify float operation-order differences at x=1000;
 // bound weighted linear RGB to 1e-5, rather than claim bit-identical sorting.
 for(let j=0;j<4;j++){const index=selection.slots[4+j],weight=selection.weights[4+j];for(let c=0;c<3;c++)assert.ok(Math.abs((index>=0?samples[index*8+4+c]*weight:0)-row.slots[j][c])<1e-5,JSON.stringify({n:row.count,spacing:row.spacing,j,c,got:index>=0?samples[index*8+4+c]*weight:0,native:row.slots[j][c]}));}
 assert.equal(selection.unverifiedSHOverflow,false);
}
test('24 native quality 150 cases retain every point light below the overflow boundary',()=>{
 const rows=fixture('forward-quality150','forward-quality150').rows.filter(r=>r.count<=150);assert.equal(rows.length,24);
 for(const r of rows){const samples=new Float32Array(r.count*8);for(let i=0;i<r.count;i++)samples.set([Math.fround(1000+Math.fround((i%4)*.1)),1,Math.fround(Math.floor(i/4)*.1),20,.107020572,.0254380442,.5,.20375],i*8);
  const selection=new out.UnityForwardAutoLights(200);selection.select(samples,r.count,{x:1000,y:0,z:0},{x:5,y:0,z:5},150);
  assert.equal(selection.pixelCount,r.pixelPasses);assert.equal(selection.vertexCount,0);assert.equal(r.vertexRed,0);
  let red=0;for(let i=0;i<selection.pixelCount;i++)red+=samples[selection.slots[i]*8+4]*selection.weights[i];assert.ok(Math.abs(red-r.pixelRed)<5e-5);
 }
 const samples=new Float32Array(151*8);for(let i=0;i<151;i++)samples.set([0,1,0,20,1,1,1,1],i*8);
 assert.throws(()=>new out.UnityForwardAutoLights(200).select(samples,151,{x:0,y:0,z:0},{x:5,y:0,z:5},150),/overflow requires/);
});
test('27 native Auto cases bind ranked lights and pixel/vertex overlap at quality budget four',()=>{
 const rows=fixture('forward-light-slots','forward-light-slots').rows.filter(r=>r.pixelCount===4&&r.mode===0);assert.equal(rows.length,27);
 for(const r of rows){const samples=new Float32Array(r.count*8);for(let i=0;i<r.count;i++)samples.set([Math.fround(1000+Math.fround((i%4)*r.spacing)),1,Math.fround(Math.floor(i/4)*r.spacing),20,.107020572,.0254380442,.5,.20375],i*8);compare(r,samples,()=>.107020572);}
});
test('15 native intensity ratios verify rational crossfade, including ties and zero lights',()=>{
 const rows=fixture('light-fade-native','light-fade').rows;assert.equal(rows.length,15);
 for(const r of rows){const samples=new Float32Array(40);for(let i=0;i<5;i++){const q=i===4?r.ratio:1;samples.set([1000,1,0,20,.107020572*q,.0254380442*q,.5*q,.20375*q],i*8);}compare(r,samples,i=>samples[i*8+4]);}
});
test('48 held-out native range, height and RGB cases establish gamma luminance importance and bounds culling',()=>{
 const rows=fixture('light-score-native','light-score').rows;assert.equal(rows.length,48);
 for(const r of rows){const rgb=r.channel===0?[1,1,1]:r.channel===1?[1,0,0]:r.channel===2?[0,1,0]:[0,0,1],samples=new Float32Array(40);
  for(let i=0;i<5;i++){const intensity=.5*(i===4?r.ratio:1);samples.set([1000,r.height,0,r.radius,...rgb.map(x=>x*intensity),(.3*rgb[0]+.59*rgb[1]+.11*rgb[2])*intensity],i*8);}compare(r,samples,i=>samples[i*8+4]+samples[i*8+5]+samples[i*8+6]);
 }
});

for(const [name,probe] of [['forward-sh-native','forward-sh'],['forward-sh-bounds-native','forward-sh-bounds'],['forward-sh-directions-native','forward-sh-directions']])test('native packed overflow SH '+name,()=>{
 const rows=fixture(name,probe).rows;
 const key=r=>JSON.stringify([r.radius,r.height,r.objectScale,r.channel,r.intensity,r.offset]);
 const baseline=new Map(rows.filter(r=>r.count===0).map(r=>[key(r),r]));
 for(const r of rows.filter(r=>r.count>0&&(name!=='forward-sh-bounds-native'||r.objectScale>=1))){
  const b=baseline.get(key(r));assert.ok(b,'matched ambient baseline');
  const gamma=r.channel===0?[1,1,1]:r.channel===1?[1,0,0]:r.channel===2?[.5,.25,1]:[.5,.5,.5];
  const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
  const samples=new Float32Array(r.count*8),offset=r.offset||[0,r.height,0];
  for(let i=0;i<r.count;i++)samples.set([1000+offset[0],offset[1],offset[2],r.radius,...gamma.map(x=>linear(x)*r.intensity),(.3*gamma[0]+.59*gamma[1]+.11*gamma[2])*r.intensity],i*8);
  const selection=new out.UnityForwardAutoLights(32),extent=5*(r.objectScale??1);selection.select(samples,r.count,{x:1000,y:0,z:0},{x:extent,y:0,z:extent});
  for(let i=0;i<27;i++){const slot=8+Math.floor(i/4),channel=i%4,expected=r.slots[slot][channel]-b.slots[slot][channel];assert.ok(Math.abs(selection.sh[i]-expected)<2e-6,JSON.stringify({name,count:r.count,key:key(r),i,got:selection.sh[i],expected}));}
 }
});
