import { _decorator, Component, ParticleSystem } from 'cc';
import { installUnityParticleSorting, UnityParticleSortSpec } from './UnityParticleSorting';

const { ccclass, property, executionOrder } = _decorator;

// Generated prefab binding. The camera is resolved every frame from the render
// scene (first enabled camera that sees the node layer), so runtime-spawned
// prefabs need no scene controller.
@ccclass('UnityParticleSortingAdapter')
@executionOrder(-100)
export class UnityParticleSortingAdapter extends Component {
    @property(ParticleSystem) source: ParticleSystem | null = null;
    @property sourceContract = '';

    protected start(): void {
        if (!this.source || !this.sourceContract) throw new Error('Missing Unity sorting source contract');
        installUnityParticleSorting(this.source, null, JSON.parse(this.sourceContract) as UnityParticleSortSpec);
    }
}
