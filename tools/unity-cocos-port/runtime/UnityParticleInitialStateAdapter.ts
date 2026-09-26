import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleInitialState } from './UnityParticleInitialState';
const {ccclass,property,executionOrder}=_decorator;
@ccclass('UnityParticleInitialStateAdapter')
@executionOrder(-121)
export class UnityParticleInitialStateAdapter extends Component {
    @property(ParticleSystem) source:ParticleSystem|null=null;
    @property sourceContract='';
    protected start():void {
        if(!this.source)throw new Error('Missing native initial particle system');
        installUnityParticleInitialState(this.source,JSON.parse(this.sourceContract));
    }
}
