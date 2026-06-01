import { assetManager, Asset, Node, Layers, resources, settings } from 'cc';

export class GameUtils {
  /**
   * Wait for a given number of milliseconds.
   * Usage: await AsyncUtils.wait(200);
   */
  public static wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Set custom layer for a node and all its children recursively.
   * @param node The node to set the layer for
   * @param layerName The name of the layer
   */
  public static setCustomLayer(node: Node, layerName: string): void {
    const layerIndex = Layers.nameToLayer(layerName);
    const layerMask = 1 << layerIndex;
    
    // Set layer for the node itself
    node.layer = layerMask;
    
    // Recursively set layer for all children
    for (const child of node.children) {
      GameUtils.setCustomLayer(child, layerName);
    }
  }

  /**
   * Load an asset either from an Asset Bundle or from built-in Resources.
   *
   * @param path Asset path (no extension), e.g. "WinOverlay" or "prefabs/WinOverlay".
   * @param bundleName If provided, loads from this bundle; otherwise loads from Resources.
   */
  public static async loadAsset<T extends Asset>(
    path: string,
    bundleName?: string,
  ): Promise<T | null> {
    const loadFromResources = () => new Promise<T | null>((resolve) =>
      resources.load(path, (err, asset) => resolve(err ? null : ((asset as T) ?? null))));

    if (!bundleName) return loadFromResources();

    const bundle = assetManager.getBundle(bundleName) ?? await new Promise<ReturnType<typeof assetManager.getBundle> | null>((resolve) =>
      assetManager.loadBundle(bundleName, (err, b) => resolve(err ? null : (b ?? null))));

    if (!bundle) return null;

    return new Promise<T | null>((resolve) =>
      bundle.load(path, (err, a) => resolve(err ? null : ((a as T) ?? null))));
  }

  private static readonly SYSTEM_BUNDLES = new Set(['internal', 'main', 'resources']);

  public static listCustomBundles(): string[] {
    const all = settings.querySettings('assets', 'projectBundles') as string[] | undefined;
    return (all ?? []).filter(b => !GameUtils.SYSTEM_BUNDLES.has(b));
  }

  public static currentCustomBundle(): string {
    return GameUtils.listCustomBundles()[0]!;
  }
}
