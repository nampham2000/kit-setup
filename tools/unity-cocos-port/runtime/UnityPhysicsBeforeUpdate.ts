import { director, PhysicsSystem } from 'cc';
let renderTime=0,fixedTime=0;
export function unityRenderTime():number{return renderTime;}
export function unityFixedTime():number{return fixedTime;}

/** Explicit scene opt-in: Unity fixed physics runs before behaviour Update. */
export function installUnityPhysicsBeforeUpdate():()=>void {
    const clock=director as any,physics=PhysicsSystem.instance as any;
    if(physics.unityBeforeUpdate)throw new Error('Unity physics phase already has an owner');
    const tick=clock.tick,post=physics.postUpdate;
    const world=physics.physicsWorld,step=world.step,reset=physics.resetAccumulator;
    renderTime=0;fixedTime=0;
    const stepWrapped=function(this:any,dt:number,deltaTime?:number,maxSubSteps?:number):void{
        fixedTime=Math.fround(fixedTime+Math.fround(dt));step.call(this,dt,deltaTime,maxSubSteps);
    };
    const resetWrapped=function(this:any,time=0):void{renderTime=0;fixedTime=0;reset.call(this,time);};
    if(typeof step==='function')world.step=stepWrapped;
    if(typeof reset==='function')physics.resetAccumulator=resetWrapped;
    const wrapped=function(this:any,dt:number):void {
        if(!this._invalid&&!this._paused){renderTime=Math.fround(renderTime+Math.fround(dt));post.call(physics,dt);}
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
        if(world.step===stepWrapped)world.step=step;
        if(physics.resetAccumulator===resetWrapped)physics.resetAccumulator=reset;
        physics.unityBeforeUpdate=false;
    };
}
