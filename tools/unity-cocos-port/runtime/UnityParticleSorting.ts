import { Camera, ParticleSystem } from 'cc';

export interface UnityParticleSortSpec { path: string; fudge: number; queue: number; }
// Unity perspective transparency uses distance plus the renderer's sorting fudge.
// Cocos' queue compares Model.priority before its built-in camera-Z distance.
export function installUnityParticleSorting(system: ParticleSystem, camera: Camera, spec: UnityParticleSortSpec): void {
    const processor = (system as any).processor;
    if (!processor) throw new Error('Initialize the particle processor before binding source sorting');
    if (spec.queue !== 3000 || !Number.isFinite(spec.fudge)) throw new Error('Unsupported source sorting queue/fudge');
    if (processor.unitySourceSorting) return;
    processor.unitySourceSorting = spec;
    const beforeRender = processor.beforeRender;
    processor.beforeRender = function (): void {
        beforeRender.call(this);
        const model = this._model;
        if (!model) return;
        const point = model.worldBounds ? model.worldBounds.center : system.node.worldPosition;
        const eye = camera.node.worldPosition;
        const distance = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
        model.priority = -(distance + spec.fudge);
    };
}
