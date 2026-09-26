export interface UnityParticleLightSpec {
    range:number; intensity:number; color:number[]; rangeMultiplier:number; intensityMultiplier:number;
    useParticleColor:boolean; sizeAffectsRange:boolean; alphaAffectsIntensity:boolean; maxLights:number;
}
function linear(v:number):number{return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}
/** Native POINT probes: choose particle/template color, decode, then intensity. */
export function writeUnityParticleLight(out:Float32Array,offset:number,spec:UnityParticleLightSpec,particle:any,worldScale:number):void {
    const c=particle.color;
    const intensity=spec.intensity*spec.intensityMultiplier*(spec.alphaAffectsIntensity?c.a/255:1);
    const size=spec.sizeAffectsRange?Math.sqrt(Math.abs(particle.size.x*particle.size.y)):1;
    out[offset+3]=spec.range*spec.rangeMultiplier*size*worldScale;
    out[offset+4]=linear(spec.useParticleColor?c.r/255:spec.color[0])*intensity;
    out[offset+5]=linear(spec.useParticleColor?c.g/255:spec.color[1])*intensity;
    out[offset+6]=linear(spec.useParticleColor?c.b/255:spec.color[2])*intensity;
    out[offset+7]=0;
}
