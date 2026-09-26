import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleStartRotation } from './UnityParticleStartRotation';
const {ccclass,property,executionOrder}=_decorator;
@ccclass('UnityParticleStartRotationAdapter')
@executionOrder(-120)
export class UnityParticleStartRotationAdapter extends Component {
    @property(ParticleSystem) source:ParticleSystem|null=null;
    @property sourceContract='';
    protected start():void {
        if(!this.source)throw new Error('Missing start rotation particle source');
        installUnityParticleStartRotation(this.source,JSON.parse(this.sourceContract));
    }
}
