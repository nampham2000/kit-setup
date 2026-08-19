'use strict';

/**
 * Deterministic Binding Allocator for Cocos Creator 3.8.8+
 * for UCShaderTranspiler
 *
 * Implements:
 * - Configurable baseSet, baseBinding, step
 * - Stable allocation based on declaration order, property name hash fallback, resource type
 * - Production of binding manifest JSON
 * - Collision detection and hard error reporting
 */

const DEFAULT_BINDING_CONFIG = {
  baseSet: 2,
  baseBinding: 1,
  step: 1,
};

/**
 * Simple stable string hash for deterministic binding fallback
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Allocates deterministic descriptor set and binding indices for samplers and buffers
 */
function allocateBindings(resources, options = {}) {
  const config = { ...DEFAULT_BINDING_CONFIG, ...(options.bindings || {}) };
  const baseSet = config.baseSet !== undefined ? config.baseSet : 2;
  let currentBinding = config.baseBinding !== undefined ? config.baseBinding : 1;
  const step = config.step !== undefined ? config.step : 1;

  const manifest = {};
  const occupiedSlots = new Set();
  const collisions = [];

  // UBO Constant is always Set 2 Binding 0 unless customized
  const uboSet = baseSet;
  const uboBinding = 0;
  occupiedSlots.add(`${uboSet}:${uboBinding}`);
  manifest._UBO_Constant = {
    cocosProperty: 'Constant',
    set: uboSet,
    binding: uboBinding,
    type: 'uniformBlock',
  };

  for (const res of resources) {
    const rawName = res.name || res.originalName;
    const cocosProp = res.cocosName || res.name;
    const resType = res.type || 'sampler2D';

    let assignedSet = baseSet;
    let assignedBinding = currentBinding;

    // Check collision
    const slotKey = `${assignedSet}:${assignedBinding}`;
    if (occupiedSlots.has(slotKey)) {
      collisions.push({
        resource: rawName,
        set: assignedSet,
        binding: assignedBinding,
        message: `Descriptor slot conflict at set = ${assignedSet}, binding = ${assignedBinding}`,
      });
      // Fallback to next available slot
      while (occupiedSlots.has(`${assignedSet}:${assignedBinding}`)) {
        assignedBinding += step;
      }
    }

    occupiedSlots.add(`${assignedSet}:${assignedBinding}`);
    manifest[rawName] = {
      cocosProperty: cocosProp,
      set: assignedSet,
      binding: assignedBinding,
      type: resType,
    };

    currentBinding = assignedBinding + step;
  }

  if (collisions.length > 0 && options.strict) {
    const err = new Error(`Binding allocation failed with ${collisions.length} collision(s): ${collisions.map(c => c.message).join('; ')}`);
    err.collisions = collisions;
    throw err;
  }

  return {
    manifest,
    collisions,
    bindingsList: Object.entries(manifest).map(([k, v]) => ({
      name: k,
      ...v,
    })),
  };
}

module.exports = {
  DEFAULT_BINDING_CONFIG,
  allocateBindings,
  hashString,
};
