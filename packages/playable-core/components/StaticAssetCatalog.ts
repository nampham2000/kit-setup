import { _decorator, Asset, Component } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Serialized dependency root for assets that do not need resources.load().
 *
 * Keep the catalog prefab/scene reference as the dynamic or entry root and keep
 * its transitive assets outside assets/resources. Logical keys may stay stable
 * while AssetDB moves preserve the referenced UUIDs.
 */
@ccclass('StaticAssetCatalog')
export class StaticAssetCatalog extends Component {
  @property
  public schemaVersion = 1;

  @property
  public manifestSha256 = '';

  @property([String])
  public keys: string[] = [];

  @property([String])
  public types: string[] = [];

  @property([Asset])
  public assets: Asset[] = [];

  public populate(target: Map<string, Asset>): void {
    const count = Math.min(this.keys.length, this.assets.length);
    for (let index = 0; index < count; index++) {
      const key = this.keys[index];
      const asset = this.assets[index];
      if (key && asset) target.set(key, asset);
    }
  }
}
