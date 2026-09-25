import { Mat4, MeshRenderer, Node } from 'cc';

/**
 * Unity inverts the triangle winding of renderers whose world matrix has a negative determinant (mirrored
 * FBX nodes such as Tanks! UTV wheel2/wheel3 with scale -0.54). Cocos 3.8 does not, so those meshes render
 * inside-out: back faces culled, the far half visible with normals facing away from the light. Flip the front
 * face on the renderer's material instances (every pass, including the shadow caster) to keep Unity's result.
 *
 * Call once after a hierarchy with authored negative scales is instantiated; returns how many renderers were
 * mirrored. Renderer material instances stay shared with later per-instance edits (getMaterialInstance returns
 * the same instance).
 */
export function applyMirroredRendererCulling(root: Node): number {
  let mirrored = 0;
  for (const renderer of root.getComponentsInChildren(MeshRenderer)) {
    if (Mat4.determinant(renderer.node.worldMatrix) >= 0) continue;
    const count = renderer.sharedMaterials.length;
    for (let index = 0; index < count; index++) {
      const instance = renderer.getMaterialInstance(index);
      if (!instance) continue;
      instance.overridePipelineStates({ rasterizerState: { isFrontFaceCCW: false } } as never);
    }
    mirrored++;
  }
  return mirrored;
}
