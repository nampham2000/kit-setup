import { _decorator, Component, Node, Quat, Vec3 } from 'cc';

const { ccclass, executeInEditMode, playOnFocus, property } = _decorator;

@ccclass('UnityParticleHierarchyTransformSyncEntry')
export class UnityParticleHierarchyTransformSyncEntry {
  @property({ type: Node })
  public target: Node | null = null;

  @property({ visible: false })
  public baseEuler = new Vec3();
}

@ccclass('UnityParticleHierarchyTransformSync')
@executeInEditMode
@playOnFocus
export class UnityParticleHierarchyTransformSync extends Component {
  @property({ type: [UnityParticleHierarchyTransformSyncEntry] })
  public entries: UnityParticleHierarchyTransformSyncEntry[] = [];

  private readonly _rootRotation = new Quat();
  private readonly _baseRotation = new Quat();
  private readonly _targetRotation = new Quat();

  protected onLoad(): void {
    this.syncTargets();
  }

  protected onEnable(): void {
    this.syncTargets();
  }

  protected lateUpdate(): void {
    this.syncTargets();
  }

  private syncTargets(): void {
    this.node.getWorldRotation(this._rootRotation);

    for (const entry of this.entries) {
      const target = entry.target;
      if (!target || !target.isValid) continue;

      Quat.fromEuler(this._baseRotation, entry.baseEuler.x, entry.baseEuler.y, entry.baseEuler.z);
      Quat.multiply(this._targetRotation, this._rootRotation, this._baseRotation);
      // _targetRotation already includes the root's world rotation. Applying it
      // locally applies the parent a second time (e.g. -90 degrees becomes -180).
      target.setWorldRotation(this._targetRotation);
    }
  }
}
