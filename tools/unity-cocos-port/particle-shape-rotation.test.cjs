'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {particleShapeRotation}=require('./particle-shape-rotation');
const fixtures=require('./particle-shape-rotation.fixture.json');
function cocosQuat(e){const h=Math.PI/360,sx=Math.sin(e.x*h),cx=Math.cos(e.x*h),sy=Math.sin(e.y*h),cy=Math.cos(e.y*h),sz=Math.sin(e.z*h),cz=Math.cos(e.z*h);return [sx*cy*cz+cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz-sx*sy*sz];}
function rotate(v,q){const [x,y,z,w]=q;const [a,b,c]=v;const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return[a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];}
for(const f of fixtures)test('native Unity basis '+f.euler.join(','),()=>{const q=cocosQuat(particleShapeRotation({x:f.euler[0],y:f.euler[1],z:f.euler[2]}));for(let i=0;i<3;i++){const v=[0,0,0];v[i]=i===2?-1:1;const got=rotate(v,q),want=f.axes[i].map((a,j)=>j===2?-a:a);for(let j=0;j<3;j++)assert.ok(Math.abs(got[j]-want[j])<2e-6,JSON.stringify({got,want}));}});
