// NodePoolAdapter.ts
import { Node, Prefab, instantiate, Tween, Component, Vec3, Quat } from 'cc';
import { Poolable } from './Poolable.ts';
import type { PoolConfig } from './ObjectPool.ts';

type LocalTransform = {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
};

export function makeNodePoolConfig(template: Prefab | Node, opts?: {
  name?: string;
  max?: number;
  parentOnPut?: Node;   // optional: staging node để giữ pooled node
  resetTransform?: boolean;
}): PoolConfig<Node> {
  const parentOnPut = opts?.parentOnPut;
  const initialTransformByNode = new WeakMap<Node, LocalTransform>();

  return {
    name: opts?.name ?? template.name,
    max: opts?.max ?? 9999,
    create: () => {
      const n = instantiate(template as any) as Node;
      initialTransformByNode.set(n, {
        position: n.position.clone(),
        rotation: n.rotation.clone(),
        scale: n.scale.clone(),
      });
      return n;
    },
    validate: (n) => !!n && n.isValid,
    destroy: (n) => n?.destroy?.(),
    onGet: (n) => {
      // call Poolable hooks
      const poolables = n.getComponentsInChildren(Poolable);
      for (const p of poolables) p.onPoolGet();

      n.active = true;
    },
    onPut: (n) => {
      // 1) stop tweens (node + children)
      stopAllTweensRecursive(n);

      // 2) stop particles if present (duck-typing to avoid import mismatch)
      stopParticlesRecursive(n);

      // 3) call Poolable hooks
      const poolables = n.getComponentsInChildren(Poolable);
      for (const p of poolables) p.onPoolPut();

      // 4) detach & hide
      if (parentOnPut) n.setParent(parentOnPut);
      else n.removeFromParent();
      n.active = false;

      // 5) optional: restore authored local transform for the pooled instance
      if (opts?.resetTransform) {
        const initial = initialTransformByNode.get(n);
        if (initial) {
          n.setPosition(initial.position);
          n.setRotation(initial.rotation);
          n.setScale(initial.scale);
        } else {
          n.setPosition(0, 0, 0);
          n.setRotationFromEuler(0, 0, 0);
          n.setScale(1, 1, 1);
        }
      }
    },
  };
}

function stopAllTweensRecursive(node: Node) {
  Tween.stopAllByTarget(node);
  for (const c of node.children) stopAllTweensRecursive(c);
}

function stopParticlesRecursive(node: Node) {
  // Duck typing: ParticleSystem/ParticleSystem2D often have stopSystem/clear
  const comps: any[] = node.getComponents(Component as any) as any;
  for (const comp of comps) {
    if (!comp) continue;
    if (typeof comp.stopSystem === 'function') comp.stopSystem();
    if (typeof comp.clear === 'function') comp.clear();
    if (typeof comp.resetSystem === 'function') {
      // do nothing on put, just stop/clear
    }
  }
  for (const c of node.children) stopParticlesRecursive(c);
}
