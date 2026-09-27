interface Position { x: number; y: number; z: number; }
interface Rotation extends Position { w: number; }

/** Float32 Transform.Translate for the measured local-Z-only source contract. */
export function unityLocalZTranslation(out: Position, position: Readonly<Position>, rotation: Readonly<Rotation>, step: number): void {
    const f=Math.fround,x=f(rotation.x),y=f(rotation.y),z=f(rotation.z),w=f(rotation.w),distance=f(step);
    const dx=f(2*f(f(f(x*z)+f(y*w))*distance));
    const dy=f(2*f(f(f(y*z)-f(x*w))*distance));
    const dz=f(distance-f(2*f(f(f(x*x)+f(y*y))*distance)));
    out.x=f(f(position.x)+dx);out.y=f(f(position.y)+dy);out.z=f(f(position.z)+dz);
}
