import { director, PhysicsSystem } from 'cc';

/** Explicit scene opt-in: Unity fixed physics runs before behaviour Update. */
export function installUnityPhysicsBeforeUpdate():()=>void {
    const clock=director as any,physics=PhysicsSystem.instance as any;
    if(physics.unityBeforeUpdate)throw new Error('Unity physics phase already has an owner');
    const tick=clock.tick,post=physics.postUpdate;
    const wrapped=function(this:any,dt:number):void {
        if(!this._invalid&&!this._paused)post.call(physics,dt);
        tick.call(this,dt);
    };
    // Cocos clears node transform flags during rendering. Retain Update-driven
    // transforms in the physics backend now, without advancing simulation;
    // otherwise next frame's step writes the stale body pose over the node.
    const suppressed=function():void{physics.physicsWorld?.syncSceneToPhysics();};
    clock.tick=wrapped;physics.postUpdate=suppressed;physics.unityBeforeUpdate=true;
    return ()=>{
        if(clock.tick===wrapped)clock.tick=tick;
        if(physics.postUpdate===suppressed)physics.postUpdate=post;
        physics.unityBeforeUpdate=false;
    };
}
