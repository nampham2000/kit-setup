/**
 * Component-free package surface.
 *
 * Do not re-export decorated Component classes from a barrel: Cocos Creator
 * 3.8.x counts those exports against the one-Component-per-script limit. Import
 * GameManager, SoundManager, Poolable, and UI Components from their concrete
 * package subpaths. Non-Component utilities/config remain source-compatible.
 */
export { GameUtils } from './utils/GameUtils';
export { ObjectPool, PoolHandle, type PoolConfig, type PoolKey } from './utils/pool/ObjectPool';
export { makeNodePoolConfig } from './utils/pool/NodePoolAdapter';
export * from './config/index';
export const PLAYABLE_CORE_MODULE_LAYOUT = 1;
