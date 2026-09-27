'use strict';
const fs = require('node:fs');
const { parseFbxBinary } = require('../lib/fbx-binary.cjs');

// Unity and Cocos split an FBX mesh by material differently (measured on the ARPG
// Effects chest and campfire against Unity's imported sub-meshes, see
// fixtures/fbx-submesh-order.json):
// - Cocos (FBX-glTF-conv) emits one primitive per material index used by the
//   polygons, in ascending index order, keeping repeated material slots.
// - Unity emits one sub-mesh per distinct material object, in the order the
//   polygon list first uses it.
// A Unity MeshRenderer's material slot i draws Unity sub-mesh i, so the Cocos slot
// of primitive p takes the Unity slot of the material object behind that primitive.

const layouts = new Map();

const objectName = (node) => String(node?.properties?.[1] ?? '').split('\0')[0];
const idOf = (node) => String(node?.properties?.[0] ?? '');

function readLayout(file) {
  const { nodes } = parseFbxBinary(fs.readFileSync(file));
  const objects = nodes.find((node) => node.name === 'Objects');
  const connections = nodes.find((node) => node.name === 'Connections');
  if (!objects || !connections) throw new Error('FBX is missing Objects or Connections');
  const byId = new Map(objects.children.map((node) => [idOf(node), node]));
  const links = connections.children.filter((node) => node.name === 'C' && node.properties[0] === 'OO')
    .map((node) => ({ child: String(node.properties[1]), parent: String(node.properties[2]) }));
  const result = new Map();
  for (const model of objects.children.filter((node) => node.name === 'Model')) {
    const modelId = idOf(model);
    const connected = links.filter((link) => link.parent === modelId).map((link) => byId.get(link.child));
    const geometry = connected.find((node) => node?.name === 'Geometry');
    // Connection order is the material index order the geometry refers to.
    const materials = connected.filter((node) => node?.name === 'Material').map(idOf);
    if (!geometry || !materials.length) continue;
    const polygons = geometry.children.find((node) => node.name === 'PolygonVertexIndex')?.properties[0] || [];
    const layer = geometry.children.find((node) => node.name === 'LayerElementMaterial');
    const indices = layer?.children.find((node) => node.name === 'Materials')?.properties[0] || [0];
    const mapping = layer?.children.find((node) => node.name === 'MappingInformationType')?.properties[0] || 'AllSame';
    const perPolygon = [];
    if (mapping === 'AllSame') perPolygon.push(indices[0] ?? 0);
    else {
      let polygon = 0;
      for (const vertex of polygons) if (vertex < 0) perPolygon.push(indices[polygon++] ?? 0);
    }
    const used = [...new Set(perPolygon)].sort((a, b) => a - b);
    const firstUse = [];
    for (const index of perPolygon) {
      const key = materials[index];
      if (key !== undefined && !firstUse.includes(key)) firstUse.push(key);
    }
    result.set(objectName(model), {
      cocosPrimitives: used.map((index) => materials[index]),
      unitySubmeshes: firstUse,
    });
  }
  return result;
}

/** Per-model material layout of a binary FBX, or null when the file gives no evidence. */
function fbxMaterialLayout(file, modelName) {
  if (!file) return null;
  let entry = layouts.get(file);
  if (entry === undefined) {
    try { entry = readLayout(file); } catch (_) { entry = null; }
    layouts.set(file, entry);
  }
  return entry?.get(modelName) || null;
}

/**
 * Cocos material slots for an FBX mesh drawn with Unity's per-sub-mesh materials,
 * or null without evidence (ASCII FBX, unknown model) or when the orders agree.
 */
function cocosSlotsForUnitySlots(file, modelName, unitySlots) {
  const layout = fbxMaterialLayout(file, modelName);
  if (!layout || !Array.isArray(unitySlots)) return null;
  const slots = layout.cocosPrimitives.map((key) => {
    const index = layout.unitySubmeshes.indexOf(key);
    return index >= 0 && index < unitySlots.length ? unitySlots[index] : null;
  });
  if (slots.includes(null)) return null;
  const same = slots.length === unitySlots.length && slots.every((slot, index) => slot === unitySlots[index]);
  return same ? null : slots;
}

/** Unity material slot index drawn by each Cocos primitive of the model. */
function unitySlotIndexForCocosPrimitive(file, modelName, primitive) {
  const layout = fbxMaterialLayout(file, modelName);
  if (!layout) return null;
  const index = layout.unitySubmeshes.indexOf(layout.cocosPrimitives[primitive]);
  return index >= 0 ? index : null;
}

module.exports = { fbxMaterialLayout, cocosSlotsForUnitySlots, unitySlotIndexForCocosPrimitive };
