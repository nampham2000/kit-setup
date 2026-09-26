export interface UnityParticleLightSpec {
    range:number; intensity:number; color:number[]; rangeMultiplier:number; intensityMultiplier:number;
    useParticleColor:boolean; sizeAffectsRange:boolean; alphaAffectsIntensity:boolean; maxLights:number;
}
function linear(v:number):number{return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}
/** Native POINT probes: choose particle/template color, decode, then intensity. */
export function writeUnityParticleLight(out:Float32Array,offset:number,spec:UnityParticleLightSpec,particle:any,worldScale:number,linearIntensity=true):void {
    const c=particle.color;
    const intensity=spec.intensity*spec.intensityMultiplier*(spec.alphaAffectsIntensity?c.a/255:1);
    const size=spec.sizeAffectsRange?Math.sqrt(Math.abs(particle.size.x*particle.size.y)):1;
    out[offset+3]=spec.range*spec.rangeMultiplier*size*worldScale;
    for(let channel=0;channel<3;channel++){
        const gamma=spec.useParticleColor?(channel===0?c.r:channel===1?c.g:c.b)/255:spec.color[channel];
        // Legacy intensity multiplies gamma RGB BEFORE converting to linear.
        out[offset+4+channel]=linearIntensity?linear(gamma)*intensity:linear(gamma*intensity);
    }
    // Forward importance uses authored gamma luminance independently of GPU RGB.
    const r=spec.useParticleColor?c.r/255:spec.color[0],g=spec.useParticleColor?c.g/255:spec.color[1],b=spec.useParticleColor?c.b/255:spec.color[2];
    out[offset+7]=(.3*r+.59*g+.11*b)*intensity;
}
