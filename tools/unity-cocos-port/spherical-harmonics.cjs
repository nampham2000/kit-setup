'use strict';
// Unity SphericalHarmonicsL2 stores coefficients for the shader polynomial.
// Creator 3.8 SH.updateUBOData multiplies its coefficients by basisOverPI.
const BASIS_OVER_PI=[0.0897936,0.155527,0.155527,0.155527,0.347769,0.347769,0.301177,0.347769,0.173884];
function unityToCocosSH(coefficients, flipZ=true) {
  if(coefficients.length!==9)throw Error('Expected nine RGB SH coefficients');
  return coefficients.map((v,i)=>{
    const scale=(i===6?3:1)*(flipZ&&[2,5,7].includes(i)?-1:1)/BASIS_OVER_PI[i];
    return {...v,x:v.x*scale,y:v.y*scale,z:v.z*scale};
  });
}
module.exports={unityToCocosSH,BASIS_OVER_PI};
