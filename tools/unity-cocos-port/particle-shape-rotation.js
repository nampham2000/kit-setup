'use strict';
// Unity shape Euler uses Z-X-Y; Cocos ShapeModule uses Y-Z-X.
// Both emitter bases are XY, with forward +Z in Unity and -Z in Cocos.
function rawQuaternion(rotation = {}) {
 const h=Math.PI/360, sx=Math.sin((rotation.x||0)*h),cx=Math.cos((rotation.x||0)*h),sy=Math.sin((rotation.y||0)*h),cy=Math.cos((rotation.y||0)*h),sz=Math.sin((rotation.z||0)*h),cz=Math.cos((rotation.z||0)*h);
 return [-(sx*cy*cz+cx*sy*sz),-(cx*sy*cz-sx*cy*sz),cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz];
}
function cocosEuler([x,y,z,w]) {
 const test=x*y+z*w,d=180/Math.PI;
 if(test>0.499999)return{x:0,y:2*Math.atan2(x,w)*d,z:90};
 if(test<-.499999)return{x:0,y:-2*Math.atan2(x,w)*d,z:-90};
 return{x:Math.atan2(2*x*w-2*y*z,1-2*x*x-2*z*z)*d,y:Math.atan2(2*y*w-2*x*z,1-2*y*y-2*z*z)*d,z:Math.asin(Math.max(-1,Math.min(1,2*test)))*d};
}
function snap(r) { for(const k of ['x','y','z']) { if(Math.abs(r[k]-Math.round(r[k]))<1e-10)r[k]=Math.round(r[k]); } return r; }
function particleShapeRotation(rotation) { return snap(cocosEuler(rawQuaternion(rotation))); }
// Unity's single-sided Edge emits from a line on shape X toward shape +Y. Cocos has no Edge shape; its Box emits
// toward -Z, so the Edge becomes a Box volume flattened onto X, turned +90 degrees about X (-Z -> +Y, X kept)
// before the authored shape rotation.
function particleShapeEdgeRotation(rotation) {
 const [x,y,z,w]=rawQuaternion(rotation),s=Math.SQRT1_2;
 return snap(cocosEuler([s*(w+x),s*(y+z),s*(z-y),s*(w-x)]));
}
module.exports={particleShapeRotation,particleShapeEdgeRotation};
