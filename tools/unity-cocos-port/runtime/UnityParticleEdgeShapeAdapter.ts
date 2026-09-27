import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleEdgeShape } from './UnityParticleEdgeShape';
const {ccclass,property,executionOrder}=_decorator;
@ccclass('UnityParticleEdgeShapeAdapter')
@executionOrder(-120)
export class UnityParticleEdgeShapeAdapter extends Component {
    @property(ParticleSystem) source:ParticleSystem|null=null;
    @property sourceContract='';
    protected start():void {
        if(!this.source)throw new Error('Missing native edge particle system');
        installUnityParticleEdgeShape(this.source,JSON.parse(this.sourceContract));
    }
}
