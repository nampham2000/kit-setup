import { _decorator, Component, Material, MeshRenderer, Node } from 'cc';

const { ccclass, disallowMultiple, property } = _decorator;

// Unity flips triangle winding (and so back-face culling and VFACE) for a
// renderer whose world matrix has a negative determinant, i.e. an odd number of
// negative scale axes. Cocos Creator 3.8.8 has no such rule: RasterizerState
// .isFrontFaceCCW comes only from the effect/material pass, never from the model
// transform, so a mirrored mesh renders inside out (only far faces survive the
// back-face cull and look black or missing).
//
// This adapter restores the Unity rule per renderer. When a managed renderer's
// world determinant is negative it swaps every pass of every material slot to the
// opposite front-face winding (isFrontFaceCCW negated, all other rasterizer
// fields kept). That is exactly Unity's behaviour: cull BACK and cull FRONT trade
// places, cull OFF is unchanged and gl_FrontFacing stays true on the visible
// outer faces. Multi-pass effects (outline shells) are flipped per pass.
//
// Positive determinant: the renderer keeps its original shared materials, so
// batching/instancing is untouched. Negative determinant: the slot switches to a
// cached mirrored copy of the shared material (one copy per source material, so
// mirrored renderers still batch together). A slot that already renders through
// a MaterialInstance owned by game code has its pass states flipped in place
// instead. Everything is restored when the determinant turns positive again.
//
// The sign depends on ancestors at runtime (a mirrored game container), so it is
// polled every lateUpdate from the world matrix: a 3x3 determinant sign, no
// allocation. TRANSFORM_CHANGED on the host node re-evaluates immediately.

const SLOT_NONE = 0;
const SLOT_SHARED = 1;
const SLOT_INSTANCE = 2;

const mirroredBySource = new Map<Material, Material>();
const sourceByMirrored = new Map<Material, Material>();

interface RasterizerLike {
  isDiscard?: boolean;
  polygonMode?: number;
  shadeModel?: number;
  cullMode?: number;
  isFrontFaceCCW?: boolean;
  depthBiasEnabled?: boolean;
  depthBias?: number;
  depthBiasClamp?: number;
  depthBiasSlop?: number;
  isDepthClip?: boolean;
  isMultisample?: boolean;
  lineWidth?: number;
}

interface MatrixLike {
  m00: number; m01: number; m02: number;
  m04: number; m05: number; m06: number;
  m08: number; m09: number; m10: number;
}

/** Sign (-1 or 1) of the determinant of the upper 3x3 of a Cocos Mat4. */
export function unityMatrixDeterminantSign(m: MatrixLike): number {
  const det = m.m00 * (m.m05 * m.m10 - m.m06 * m.m09)
    - m.m01 * (m.m04 * m.m10 - m.m06 * m.m08)
    + m.m02 * (m.m04 * m.m09 - m.m05 * m.m08);
  return det < 0 ? -1 : 1;
}

/** Sign of the node's world determinant: -1 means Unity would flip its winding. */
export function unityWorldDeterminantSign(node: Node): number {
  return unityMatrixDeterminantSign(node.worldMatrix as unknown as MatrixLike);
}

/**
 * Full rasterizer override with the front-face winding flipped. Every field is
 * written because pass overrides replace the whole rasterizerState key.
 */
export function unityFlippedRasterizerState(rs: RasterizerLike): RasterizerLike {
  return {
    isDiscard: rs.isDiscard,
    polygonMode: rs.polygonMode,
    shadeModel: rs.shadeModel,
    cullMode: rs.cullMode,
    isFrontFaceCCW: !(rs.isFrontFaceCCW ?? true),
    depthBiasEnabled: rs.depthBiasEnabled,
    depthBias: rs.depthBias,
    depthBiasClamp: rs.depthBiasClamp,
    depthBiasSlop: rs.depthBiasSlop,
    isDepthClip: rs.isDepthClip,
    isMultisample: rs.isMultisample,
    lineWidth: rs.lineWidth,
  };
}

/** True when the material is a mirrored copy produced by this adapter. */
export function isUnityMirroredMaterial(material: Material | null): boolean {
  return !!material && sourceByMirrored.has(material);
}

/**
 * Cached mirrored copy of a shared material: same effect, technique, defines and
 * properties, every pass with the opposite front-face winding. Returns the input
 * when the material has no passes yet (effect not loaded).
 */
export function unityMirroredMaterial(source: Material): Material {
  const original = sourceByMirrored.get(source);
  if (original) return mirroredBySource.get(original) || source;
  const cached = mirroredBySource.get(source);
  if (cached && cached.isValid) return cached;
  const passes = source.passes;
  if (!passes || passes.length === 0) return source;
  const states: Record<string, unknown>[] = [];
  for (let i = 0; i < passes.length; i++) {
    states.push({ rasterizerState: unityFlippedRasterizerState(passes[i].rasterizerState as unknown as RasterizerLike) });
  }
  const mirrored = new Material();
  mirrored.copy(source, { states } as any);
  mirrored.name = `${source.name || 'material'} (UnityMirrored)`;
  mirroredBySource.set(source, mirrored);
  sourceByMirrored.set(mirrored, source);
  return mirrored;
}

/** Drop cached mirrored copies, e.g. after game code edits a shared material. */
export function clearUnityMirroredMaterialCache(): void {
  mirroredBySource.forEach((mirrored) => { if (mirrored.isValid) mirrored.destroy(); });
  mirroredBySource.clear();
  sourceByMirrored.clear();
}

function flipInstancePasses(material: Material): void {
  const passes = material.passes;
  for (let p = 0; p < passes.length; p++) {
    const rasterizerState = unityFlippedRasterizerState(passes[p].rasterizerState as unknown as RasterizerLike);
    (material as any).overridePipelineStates({ rasterizerState }, p);
  }
}

class MirroredRendererEntry {
  public renderer: MeshRenderer;
  public sign = 1;
  public mode: number[] = [];
  public original: (Material | null)[] = [];
  public applied: (Material | null)[] = [];

  constructor(renderer: MeshRenderer) {
    this.renderer = renderer;
  }
}

function nearestMirroredCulling(node: Node | null): UnityMirroredCulling | null {
  for (let current = node; current; current = current.parent) {
    // The closest adapter owns the renderer, enabled or not, so an ancestor
    // with includeDescendants never double-flips a renderer that has its own.
    const component = current.getComponent(UnityMirroredCulling);
    if (component) return component;
  }
  return null;
}

@ccclass('UnityMirroredCulling')
@disallowMultiple
export class UnityMirroredCulling extends Component {
  /** Also manage MeshRenderer/SkinnedMeshRenderer on descendant nodes (nested prefab instance roots). */
  @property
  public includeDescendants = false;

  private _entries: MirroredRendererEntry[] = [];

  /** Number of managed renderers whose world determinant is currently negative. */
  public get mirroredRendererCount(): number {
    let count = 0;
    for (let i = 0; i < this._entries.length; i++) if (this._entries[i].sign < 0) count++;
    return count;
  }

  protected onEnable(): void {
    this.refresh();
    this.node.on(Node.EventType.TRANSFORM_CHANGED, this.onTransformChanged, this);
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.TRANSFORM_CHANGED, this.onTransformChanged, this);
    this.restoreAll();
    this._entries.length = 0;
  }

  protected lateUpdate(): void {
    this.evaluate();
  }

  /** Re-collect renderers (call after adding renderers or swapping materials) and re-evaluate. */
  public refresh(): void {
    this.restoreAll();
    this._entries.length = 0;
    const renderers = this.includeDescendants
      ? this.node.getComponentsInChildren(MeshRenderer)
      : this.node.getComponents(MeshRenderer);
    for (const renderer of renderers) {
      if (this.includeDescendants && nearestMirroredCulling(renderer.node) !== this) continue;
      this._entries.push(new MirroredRendererEntry(renderer));
    }
    this.evaluate();
  }

  private onTransformChanged(): void {
    this.evaluate();
  }

  private evaluate(): void {
    const entries = this._entries;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const renderer = entry.renderer;
      if (!renderer || !renderer.isValid) continue;
      const sign = unityWorldDeterminantSign(renderer.node);
      if (sign !== entry.sign) {
        if (sign < 0) this.mirror(entry);
        else this.restore(entry);
        entry.sign = sign;
      } else if (sign < 0) {
        this.verifyMirrored(entry);
      }
    }
  }

  // Keeps slots mirrored when game code replaced a material after we mirrored it.
  private verifyMirrored(entry: MirroredRendererEntry): void {
    const renderer = entry.renderer;
    const shared = renderer.sharedMaterials;
    for (let slot = 0; slot < shared.length; slot++) {
      const mode = entry.mode[slot] ?? SLOT_NONE;
      if (mode === SLOT_SHARED && shared[slot] === entry.applied[slot]) continue;
      if (mode === SLOT_INSTANCE && renderer.getRenderMaterial(slot) === entry.applied[slot]) continue;
      if (mode === SLOT_NONE && !shared[slot]) continue;
      this.mirrorSlot(entry, slot);
    }
  }

  private mirror(entry: MirroredRendererEntry): void {
    const count = entry.renderer.sharedMaterials.length;
    for (let slot = 0; slot < count; slot++) this.mirrorSlot(entry, slot);
  }

  private mirrorSlot(entry: MirroredRendererEntry, slot: number): void {
    const renderer = entry.renderer;
    const shared = renderer.sharedMaterials[slot];
    entry.mode[slot] = SLOT_NONE;
    entry.original[slot] = null;
    entry.applied[slot] = null;
    if (!shared) return;
    const rendered = renderer.getRenderMaterial(slot);
    if (rendered && rendered !== shared) {
      // A MaterialInstance owned by game code: flip its passes in place.
      flipInstancePasses(rendered);
      entry.mode[slot] = SLOT_INSTANCE;
      entry.applied[slot] = rendered;
      return;
    }
    if (isUnityMirroredMaterial(shared)) {
      entry.mode[slot] = SLOT_SHARED;
      entry.original[slot] = sourceByMirrored.get(shared) || null;
      entry.applied[slot] = shared;
      return;
    }
    const mirrored = unityMirroredMaterial(shared);
    if (mirrored === shared) return;
    renderer.setSharedMaterial(mirrored, slot);
    entry.mode[slot] = SLOT_SHARED;
    entry.original[slot] = shared;
    entry.applied[slot] = mirrored;
  }

  private restore(entry: MirroredRendererEntry): void {
    const renderer = entry.renderer;
    if (!renderer || !renderer.isValid) return;
    for (let slot = 0; slot < entry.mode.length; slot++) {
      const mode = entry.mode[slot];
      if (mode === SLOT_INSTANCE) {
        const rendered = renderer.getRenderMaterial(slot);
        if (rendered && rendered === entry.applied[slot]) flipInstancePasses(rendered);
      } else if (mode === SLOT_SHARED) {
        const rendered = renderer.getRenderMaterial(slot);
        const shared = renderer.sharedMaterials[slot];
        if (rendered && rendered !== shared) {
          // Game code instantiated the mirrored slot; flip the instance back
          // instead of destroying it through setSharedMaterial.
          flipInstancePasses(rendered);
        } else if (shared === entry.applied[slot] && entry.original[slot]) {
          renderer.setSharedMaterial(entry.original[slot], slot);
        }
      }
      entry.mode[slot] = SLOT_NONE;
      entry.original[slot] = null;
      entry.applied[slot] = null;
    }
  }

  private restoreAll(): void {
    for (let i = 0; i < this._entries.length; i++) {
      const entry = this._entries[i];
      if (entry.sign < 0) this.restore(entry);
      entry.sign = 1;
    }
  }
}

/**
 * Attach UnityMirroredCulling to every node under `root` (inclusive) that owns a
 * MeshRenderer or SkinnedMeshRenderer. Use it for renderers spawned at runtime
 * under parents that may be mirrored; the adapter is a no-op while the world
 * determinant stays positive. Returns the number of components added.
 */
export function attachUnityMirroredCulling(root: Node): number {
  let added = 0;
  const renderers = root.getComponentsInChildren(MeshRenderer);
  for (const renderer of renderers) {
    const node = renderer.node;
    const existing = node.getComponent(UnityMirroredCulling);
    if (existing) {
      if (existing.enabledInHierarchy) existing.refresh();
      continue;
    }
    node.addComponent(UnityMirroredCulling);
    added++;
  }
  return added;
}
