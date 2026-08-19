'use strict';

/**
 * GLSL std140 Uniform Block (UBO) Layout Builder
 * for Cocos Creator 3.8.8+ Effects
 *
 * Implements strict std140 layout calculation:
 * - scalar (float, int, bool): size 4, align 4
 * - vec2: size 8, align 8
 * - vec3: size 12, align 16
 * - vec4: size 16, align 16
 * - mat2: size 32 (2 x vec4/vec2 with matrixStride 16), align 16
 * - mat3: size 48 (3 x vec4 with matrixStride 16), align 16
 * - mat4: size 64 (4 x vec4 with matrixStride 16), align 16
 * - arrays: each element rounded to multiple of 16 bytes (arrayStride = 16)
 * - total block size rounded up to multiple of 16
 */

const STD140_SPECS = {
  float: { size: 4, align: 4, glsl: 'float' },
  int: { size: 4, align: 4, glsl: 'int' },
  bool: { size: 4, align: 4, glsl: 'bool' },
  vec2: { size: 8, align: 8, glsl: 'vec2' },
  vec3: { size: 12, align: 16, glsl: 'vec3' },
  vec4: { size: 16, align: 16, glsl: 'vec4' },
  mat2: { size: 32, align: 16, glsl: 'mat2', matrixStride: 16 },
  mat3: { size: 48, align: 16, glsl: 'mat3', matrixStride: 16 },
  mat4: { size: 64, align: 16, glsl: 'mat4', matrixStride: 16 },
};

/**
 * Normalizes type string to std140 type
 */
function normalizeType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'color' || t === 'vector' || t === 'vec4' || t === 'float4' || t === 'half4' || t === 'fixed4' || t === 'min16float4') return 'vec4';
  if (t === 'vec3' || t === 'float3' || t === 'half3' || t === 'fixed3' || t === 'min16float3') return 'vec3';
  if (t === 'vec2' || t === 'float2' || t === 'half2' || t === 'fixed2' || t === 'min16float2') return 'vec2';
  if (t === 'int' || t === 'integer') return 'int';
  if (t === 'bool' || t === 'boolean') return 'bool';
  if (t === 'mat4' || t === 'float4x4' || t === 'matrix') return 'mat4';
  if (t === 'mat3' || t === 'float3x3') return 'mat3';
  if (t === 'mat2' || t === 'float2x2') return 'mat2';
  return 'float';
}

/**
 * Computes std140 layout for a list of properties/uniforms
 * @param {Array<{ name: string, type: string, arraySize?: number, isStruct?: boolean }>} fields
 * @param {boolean} optimizeOrder - If true, sorts fields (mat4 -> mat3 -> mat2 -> vec4 -> vec3 -> vec2 -> float) to minimize padding
 * @param {object} options - Optional config { explicitBindings: boolean, set: number, binding: number }
 */
function buildStd140Ubo(fields, optimizeOrder = true, options = {}) {
  if (!fields || fields.length === 0) {
    return {
      glsl: '',
      fields: [],
      totalSize: 0,
      paddedFields: [],
      diagnostics: [],
    };
  }

  const diagnostics = [];

  // Filter out textures / samplers and check for unsupported nested structs
  const uboCandidates = [];
  for (const f of fields) {
    if (f.isStruct || f.type === 'struct') {
      diagnostics.push({
        severity: 'error',
        message: `Nested struct in UBO is not supported by std140 builder: ${f.name}`,
      });
      continue;
    }
    const t = normalizeType(f.type || f.cocosType);
    if (STD140_SPECS[t] !== undefined) {
      uboCandidates.push(f);
    }
  }

  if (uboCandidates.length === 0) {
    return {
      glsl: '',
      fields: [],
      totalSize: 0,
      paddedFields: [],
      diagnostics,
    };
  }

  let ordered = [...uboCandidates];
  if (optimizeOrder) {
    // Sort order: mat4, mat3, mat2, vec4, vec3, vec2, float/int/bool
    const typePriority = { mat4: 0, mat3: 1, mat2: 2, vec4: 3, vec3: 4, vec2: 5, float: 6, int: 7, bool: 8 };
    ordered.sort((a, b) => {
      const typeA = normalizeType(a.type || a.cocosType);
      const typeB = normalizeType(b.type || b.cocosType);
      const pA = typePriority[typeA] !== undefined ? typePriority[typeA] : 99;
      const pB = typePriority[typeB] !== undefined ? typePriority[typeB] : 99;
      return pA - pB;
    });
  }

  let currentOffset = 0;
  const layoutFields = [];
  const emittedStatements = [];
  let padCounter = 0;

  for (const field of ordered) {
    const typeKey = normalizeType(field.type || field.cocosType);
    const spec = STD140_SPECS[typeKey] || STD140_SPECS.float;
    const arraySize = field.arraySize || 0;

    let alignment = spec.align;
    let size = spec.size;
    let arrayStride = undefined;
    let matrixStride = spec.matrixStride;

    if (arraySize > 0) {
      // In std140, each array element is rounded up to a 16-byte multiple
      arrayStride = Math.ceil(size / 16) * 16;
      size = arrayStride * arraySize;
      alignment = Math.max(alignment, 16);
    }

    // Insert deterministic padding if currentOffset is not aligned
    const remainder = currentOffset % alignment;
    if (remainder !== 0) {
      const paddingNeeded = alignment - remainder;
      if (paddingNeeded === 4) {
        emittedStatements.push(`  float _pad${padCounter++};`);
      } else if (paddingNeeded === 8) {
        emittedStatements.push(`  vec2 _pad${padCounter++};`);
      } else if (paddingNeeded === 12) {
        emittedStatements.push(`  float _pad${padCounter++};`);
        emittedStatements.push(`  vec2 _pad${padCounter++};`);
      }
      currentOffset += paddingNeeded;
    }

    layoutFields.push({
      name: field.name || field.cocosName,
      type: spec.glsl,
      typeKey,
      offset: currentOffset,
      size,
      alignment,
      arraySize,
      arrayStride,
      matrixStride,
    });

    if (arraySize > 0) {
      emittedStatements.push(`  ${spec.glsl} ${field.name || field.cocosName}[${arraySize}];`);
    } else {
      emittedStatements.push(`  ${spec.glsl} ${field.name || field.cocosName};`);
    }

    currentOffset += size;
  }

  // Round up total UBO size to multiple of 16
  const totalRemainder = currentOffset % 16;
  const totalSize = totalRemainder === 0 ? currentOffset : currentOffset + (16 - totalRemainder);

  // Generate GLSL Block string
  const layoutPrefix = options.explicitBindings
    ? `layout(set = ${options.set !== undefined ? options.set : 2}, binding = ${options.binding !== undefined ? options.binding : 0}) `
    : '';

  const blockName = options.blockName || 'Constant';
  const glsl = `${layoutPrefix}uniform ${blockName} {\n${emittedStatements.join('\n')}\n};`;

  return {
    glsl,
    fields: layoutFields,
    totalSize,
    diagnostics,
  };
}

module.exports = {
  STD140_SPECS,
  normalizeType,
  buildStd140Ubo,
};
