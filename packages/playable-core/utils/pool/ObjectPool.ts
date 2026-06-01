// ObjectPool.ts (Cocos Creator 3.8.x, TypeScript)
import { director, Director } from 'cc';

export type PoolKey = string | number | symbol;

export interface PoolConfig<T extends object> {
  name?: string;
  create: () => T;

  /** Called right after take from pool (or newly created). */
  onGet?: (obj: T) => void;

  /** Called right before put into pool (cleanup/reset). */
  onPut?: (obj: T) => void;

  /** Validate object is reusable (e.g., node.isValid). Default: true */
  validate?: (obj: T) => boolean;

  /** Destroy object if pool is full or clear(). Default: no-op */
  destroy?: (obj: T) => void;

  /** Max pooled (free) objects kept. Default: Infinity */
  max?: number;
}

type PoolMeta = { key: PoolKey; inUse: boolean };

class Bucket<T extends object> {
  readonly key: PoolKey;
  readonly cfg: Required<Pick<PoolConfig<T>, 'create' | 'validate' | 'destroy'>> & PoolConfig<T>;
  free: T[] = [];
  inUseCount = 0;
  createdCount = 0;
  reusedCount = 0;
  destroyedCount = 0;

  constructor(key: PoolKey, cfg: PoolConfig<T>) {
    this.key = key;
    this.cfg = {
      create: cfg.create,
      validate: cfg.validate ?? (() => true),
      destroy: cfg.destroy ?? (() => {}),
      ...cfg,
    };
  }
}

export class PoolHandle<T extends object> {
  constructor(private pool: ObjectPool, private key: PoolKey) {}

  get(): T {
    return this.pool.get(this.key);
  }

  put(obj: T): void {
    this.pool.put(this.key, obj);
  }

  sizeFree(): number {
    return this.pool.sizeFree(this.key);
  }

  stats() {
    return this.pool.stats(this.key);
  }

  async prewarm(count: number, yieldEvery = 0): Promise<void> {
    await this.pool.prewarm(this.key, count, yieldEvery);
  }

  clear(): void {
    this.pool.clear(this.key);
  }
}

export class ObjectPool {
  private buckets = new Map<PoolKey, Bucket<any>>();
  private meta = new WeakMap<object, PoolMeta>();

  register<T extends object>(key: PoolKey, cfg: PoolConfig<T>): PoolHandle<T> {
    if (this.buckets.has(key)) throw new Error(`[ObjectPool] key already registered: ${String(key)}`);
    this.buckets.set(key, new Bucket<T>(key, cfg));
    return new PoolHandle<T>(this, key);
  }

  get<T extends object>(key: PoolKey): T {
    const b = this.requireBucket<T>(key);
    let obj: T | undefined;

    // Find a valid free object
    while (b.free.length > 0) {
      const candidate = b.free.pop() as T;
      if (b.cfg.validate(candidate)) {
        obj = candidate;
        b.reusedCount++;
        break;
      } else {
        b.cfg.destroy(candidate);
        b.destroyedCount++;
      }
    }

    if (!obj) {
      obj = b.cfg.create();
      b.createdCount++;
    }

    // Guard: prevent double get of same instance
    const m = this.meta.get(obj);
    if (m?.inUse) {
      throw new Error(`[ObjectPool] Object is already in use. key=${String(key)}`);
    }

    this.meta.set(obj, { key, inUse: true });
    b.inUseCount++;

    b.cfg.onGet?.(obj);
    return obj;
  }

  put<T extends object>(key: PoolKey, obj: T): void {
    const b = this.requireBucket<T>(key);

    // Validate belongs to same key (anti “put wrong pool”)
    const m = this.meta.get(obj);
    if (m && m.key !== key) {
      throw new Error(
        `[ObjectPool] Put wrong key. expected=${String(m.key)} got=${String(key)}`
      );
    }
    if (m && !m.inUse) {
      throw new Error(`[ObjectPool] Double put detected. key=${String(key)}`);
    }

    // If invalid, destroy directly
    if (!b.cfg.validate(obj)) {
      this.meta.delete(obj);
      b.inUseCount = Math.max(0, b.inUseCount - 1);
      b.cfg.destroy(obj);
      b.destroyedCount++;
      return;
    }

    b.cfg.onPut?.(obj);
    this.meta.set(obj, { key, inUse: false });
    b.inUseCount = Math.max(0, b.inUseCount - 1);

    const max = b.cfg.max ?? Number.POSITIVE_INFINITY;
    if (b.free.length >= max) {
      b.cfg.destroy(obj);
      b.destroyedCount++;
      return;
    }

    b.free.push(obj);
  }

  sizeFree(key: PoolKey): number {
    return this.requireBucket<any>(key).free.length;
  }

  stats(key: PoolKey) {
    const b = this.requireBucket<any>(key);
    return {
      key: String(key),
      name: b.cfg.name ?? '',
      free: b.free.length,
      inUse: b.inUseCount,
      created: b.createdCount,
      reused: b.reusedCount,
      destroyed: b.destroyedCount,
      max: b.cfg.max ?? Infinity,
    };
  }

  clear(key?: PoolKey): void {
    if (key === undefined) {
      for (const k of this.buckets.keys()) this.clear(k);
      return;
    }
    const b = this.requireBucket<any>(key);
    while (b.free.length > 0) {
      const obj = b.free.pop();
      b.cfg.destroy(obj);
      b.destroyedCount++;
      this.meta.delete(obj);
    }
  }

  async prewarm(key: PoolKey, count: number, yieldEvery = 0): Promise<void> {
    const b = this.requireBucket<any>(key);
    for (let i = 0; i < count; i++) {
      const obj = b.cfg.create();
      b.createdCount++;
      b.cfg.onPut?.(obj);
      if (b.free.length < (b.cfg.max ?? Infinity)) b.free.push(obj);
      else {
        b.cfg.destroy(obj);
        b.destroyedCount++;
      }

      if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
        await nextFrame();
      }
    }
  }

  private requireBucket<T extends object>(key: PoolKey): Bucket<T> {
    const b = this.buckets.get(key);
    if (!b) throw new Error(`[ObjectPool] key not registered: ${String(key)}`);
    return b as Bucket<T>;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => director.once(Director.EVENT_AFTER_DRAW, resolve));
}
