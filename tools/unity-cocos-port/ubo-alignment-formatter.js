'use strict';

/**
 * GLSL std140 Uniform Buffer Object (UBO) Alignment Formatter & Validator
 * Designed for Cocos Creator 3.8.8 CCEffect Shaders.
 * 
 * Rules of std140 layout (OpenGL ES 3.0 / Vulkan / WebGL 2.0 / Metal):
 * 1. float / int / uint / bool: size 4, align 4
 * 2. vec2 / ivec2 / uvec2 / bvec2: size 8, align 8
 * 3. vec3 / ivec3 / uvec3 / bvec3: size 12, align 16 (occupies a full 16-byte slot)
 * 4. vec4 / ivec4 / uvec4 / bvec4: size 16, align 16
 * 5. mat4: size 64, align 16 (4 column vectors of 16 bytes each)
 * 6. mat3: size 48, align 16 (3 column vectors of 16 bytes each in std140)
 * 7. Arrays: each element aligned to 16 bytes (vec4 boundary)
 * 8. Struct total size: multiple of 16 bytes
 */

const TYPE_SPECS = {
  float: { size: 4, align: 4, lanes: 1, baseType: 'float' },
  int: { size: 4, align: 4, lanes: 1, baseType: 'int' },
  uint: { size: 4, align: 4, lanes: 1, baseType: 'uint' },
  bool: { size: 4, align: 4, lanes: 1, baseType: 'bool' },
  vec2: { size: 8, align: 8, lanes: 2, baseType: 'float' },
  ivec2: { size: 8, align: 8, lanes: 2, baseType: 'int' },
  uvec2: { size: 8, align: 8, lanes: 2, baseType: 'uint' },
  bvec2: { size: 8, align: 8, lanes: 2, baseType: 'bool' },
  vec3: { size: 12, align: 16, lanes: 3, baseType: 'float' },
  ivec3: { size: 12, align: 16, lanes: 3, baseType: 'int' },
  uvec3: { size: 12, align: 16, lanes: 3, baseType: 'uint' },
  bvec3: { size: 12, align: 16, lanes: 3, baseType: 'bool' },
  vec4: { size: 16, align: 16, lanes: 4, baseType: 'float' },
  ivec4: { size: 16, align: 16, lanes: 4, baseType: 'int' },
  uvec4: { size: 16, align: 16, lanes: 4, baseType: 'uint' },
  bvec4: { size: 16, align: 16, lanes: 4, baseType: 'bool' },
  mat3: { size: 48, align: 16, lanes: 12, baseType: 'mat3' },
  mat4: { size: 64, align: 16, lanes: 16, baseType: 'mat4' },
};

function roundUp(value, multiple) {
  if (multiple === 0) return value;
  return Math.ceil(value / multiple) * multiple;
}

/**
 * Calculates byte layout and padding for a list of member fields.
 */
function computeStd140Layout(fields) {
  let currentOffset = 0;
  const layout = [];
  let totalWastedBytes = 0;

  for (const field of fields) {
    const spec = TYPE_SPECS[field.type] || { size: 16, align: 16, lanes: 4 };
    const alignedOffset = roundUp(currentOffset, spec.align);
    const paddingBefore = alignedOffset - currentOffset;
    totalWastedBytes += paddingBefore;

    let fieldSize = spec.size;
    if (field.arraySize && field.arraySize > 1) {
      // In std140, each array element is rounded up to 16 bytes
      const elementSize = roundUp(spec.size, 16);
      fieldSize = elementSize * field.arraySize;
    }

    layout.push({
      name: field.name,
      type: field.type,
      arraySize: field.arraySize || 1,
      offset: alignedOffset,
      size: fieldSize,
      align: spec.align,
      paddingBefore,
    });

    currentOffset = alignedOffset + fieldSize;
  }

  const finalTotalSize = roundUp(currentOffset, 16);
  const endPadding = finalTotalSize - currentOffset;
  totalWastedBytes += endPadding;

  return {
    fields: layout,
    totalSize: finalTotalSize,
    wastedBytes: totalWastedBytes,
  };
}

/**
 * Optimally packs uniform properties into std140 vec4 buckets or reordered members
 * with zero alignment violations and zero wasted memory.
 */
function packStd140Uniforms(props, blockName = 'UnityParams') {
  const matrices = [];
  const vectors = [];
  const vec3s = [];
  const vec2s = [];
  const scalars = [];
  const samplers = [];

  for (const prop of props) {
    const type = prop.type || (Array.isArray(prop.defaultValue) ? `vec${prop.defaultValue.length}` : 'float');
    if (type === 'sampler2D' || type === 'samplerCube') {
      samplers.push(prop);
    } else if (type === 'mat4' || type === 'mat3') {
      matrices.push({ ...prop, type });
    } else if (type === 'vec4' || type === 'color') {
      vectors.push({ ...prop, type: 'vec4' });
    } else if (type === 'vec3') {
      vec3s.push({ ...prop, type: 'vec3' });
    } else if (type === 'vec2') {
      vec2s.push({ ...prop, type: 'vec2' });
    } else {
      scalars.push({ ...prop, type: 'float' });
    }
  }

  const packedMembers = [];
  const propertyYamlLines = [];
  const glslAliases = [];

  // 1. Matrices (mat4: 64 bytes each, mat3: 48 bytes each)
  matrices.forEach((mat) => {
    packedMembers.push({ name: mat.name, type: mat.type });
    propertyYamlLines.push(`        ${mat.name}: { value: ${JSON.stringify(mat.defaultValue || [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])} }`);
  });

  // 2. Full vec4s
  vectors.forEach((vec, idx) => {
    const uniformName = `u_vec4_${vec.name || idx}`;
    packedMembers.push({ name: uniformName, type: 'vec4' });
    glslAliases.push(`  vec4 ${vec.name} = ${uniformName};`);
    const defVal = Array.isArray(vec.defaultValue) ? vec.defaultValue : [1, 1, 1, 1];
    propertyYamlLines.push(`        ${vec.name}: { value: [${defVal.join(', ')}], target: ${uniformName}, editor: { displayName: "${vec.displayName || vec.name}" } }`);
  });

  // 3. Pair vec3s with scalars (vec3 + float = 16 bytes, perfectly fills std140 slot)
  while (vec3s.length > 0) {
    const v3 = vec3s.shift();
    if (scalars.length > 0) {
      // Perfect match: vec3 + float packed into 1 vec4 slot
      const sc = scalars.shift();
      const slotName = `u_v3_${v3.name}_${sc.name}`;
      packedMembers.push({ name: slotName, type: 'vec4' });
      glslAliases.push(`  vec3 ${v3.name} = ${slotName}.xyz;`);
      glslAliases.push(`  float ${sc.name} = ${slotName}.w;`);
      
      const v3Def = Array.isArray(v3.defaultValue) ? v3.defaultValue : [0, 0, 0];
      propertyYamlLines.push(`        ${v3.name}: { value: [${v3Def.join(', ')}], target: ${slotName}.xyz, editor: { displayName: "${v3.displayName || v3.name}" } }`);
      propertyYamlLines.push(`        ${sc.name}: { value: ${sc.defaultValue ?? 0}, target: ${slotName}.w, editor: { displayName: "${sc.displayName || sc.name}" } }`);
    } else {
      // vec3 alone in a vec4 slot
      const slotName = `u_v3_${v3.name}`;
      packedMembers.push({ name: slotName, type: 'vec4' });
      glslAliases.push(`  vec3 ${v3.name} = ${slotName}.xyz;`);
      const v3Def = Array.isArray(v3.defaultValue) ? v3.defaultValue : [0, 0, 0];
      propertyYamlLines.push(`        ${v3.name}: { value: [${v3Def.join(', ')}], target: ${slotName}.xyz, editor: { displayName: "${v3.displayName || v3.name}" } }`);
    }
  }

  // 4. Pair vec2s (vec2 + vec2 = 16 bytes) or (vec2 + float + float = 16 bytes)
  while (vec2s.length > 0) {
    const v2_1 = vec2s.shift();
    if (vec2s.length > 0) {
      const v2_2 = vec2s.shift();
      const slotName = `u_v2_${v2_1.name}_${v2_2.name}`;
      packedMembers.push({ name: slotName, type: 'vec4' });
      glslAliases.push(`  vec2 ${v2_1.name} = ${slotName}.xy;`);
      glslAliases.push(`  vec2 ${v2_2.name} = ${slotName}.zw;`);

      const d1 = Array.isArray(v2_1.defaultValue) ? v2_1.defaultValue : [0, 0];
      const d2 = Array.isArray(v2_2.defaultValue) ? v2_2.defaultValue : [0, 0];
      propertyYamlLines.push(`        ${v2_1.name}: { value: [${d1.join(', ')}], target: ${slotName}.xy, editor: { displayName: "${v2_1.displayName || v2_1.name}" } }`);
      propertyYamlLines.push(`        ${v2_2.name}: { value: [${d2.join(', ')}], target: ${slotName}.zw, editor: { displayName: "${v2_2.displayName || v2_2.name}" } }`);
    } else if (scalars.length >= 2) {
      const s1 = scalars.shift();
      const s2 = scalars.shift();
      const slotName = `u_v2_${v2_1.name}_s`;
      packedMembers.push({ name: slotName, type: 'vec4' });
      glslAliases.push(`  vec2 ${v2_1.name} = ${slotName}.xy;`);
      glslAliases.push(`  float ${s1.name} = ${slotName}.z;`);
      glslAliases.push(`  float ${s2.name} = ${slotName}.w;`);

      const d1 = Array.isArray(v2_1.defaultValue) ? v2_1.defaultValue : [0, 0];
      propertyYamlLines.push(`        ${v2_1.name}: { value: [${d1.join(', ')}], target: ${slotName}.xy, editor: { displayName: "${v2_1.displayName || v2_1.name}" } }`);
      propertyYamlLines.push(`        ${s1.name}: { value: ${s1.defaultValue ?? 0}, target: ${slotName}.z, editor: { displayName: "${s1.displayName || s1.name}" } }`);
      propertyYamlLines.push(`        ${s2.name}: { value: ${s2.defaultValue ?? 0}, target: ${slotName}.w, editor: { displayName: "${s2.displayName || s2.name}" } }`);
    } else if (scalars.length === 1) {
      const s1 = scalars.shift();
      const slotName = `u_v2_${v2_1.name}_s`;
      packedMembers.push({ name: slotName, type: 'vec4' });
      glslAliases.push(`  vec2 ${v2_1.name} = ${slotName}.xy;`);
      glslAliases.push(`  float ${s1.name} = ${slotName}.z;`);

      const d1 = Array.isArray(v2_1.defaultValue) ? v2_1.defaultValue : [0, 0];
      propertyYamlLines.push(`        ${v2_1.name}: { value: [${d1.join(', ')}], target: ${slotName}.xy, editor: { displayName: "${v2_1.displayName || v2_1.name}" } }`);
      propertyYamlLines.push(`        ${s1.name}: { value: ${s1.defaultValue ?? 0}, target: ${slotName}.z, editor: { displayName: "${s1.displayName || s1.name}" } }`);
    } else {
      const slotName = `u_v2_${v2_1.name}`;
      packedMembers.push({ name: slotName, type: 'vec4' });
      glslAliases.push(`  vec2 ${v2_1.name} = ${slotName}.xy;`);
      const d1 = Array.isArray(v2_1.defaultValue) ? v2_1.defaultValue : [0, 0];
      propertyYamlLines.push(`        ${v2_1.name}: { value: [${d1.join(', ')}], target: ${slotName}.xy, editor: { displayName: "${v2_1.displayName || v2_1.name}" } }`);
    }
  }

  // 5. Pack remaining scalars in 4-tuples (vec4)
  const scalarLanes = ['x', 'y', 'z', 'w'];
  let bucketIndex = 0;
  while (scalars.length > 0) {
    const chunk = scalars.splice(0, 4);
    const slotName = `u_params_${bucketIndex++}`;
    packedMembers.push({ name: slotName, type: 'vec4' });

    chunk.forEach((sc, i) => {
      const lane = scalarLanes[i];
      glslAliases.push(`  float ${sc.name} = ${slotName}.${lane};`);
      propertyYamlLines.push(`        ${sc.name}: { value: ${sc.defaultValue ?? 0}, target: ${slotName}.${lane}, editor: { displayName: "${sc.displayName || sc.name}" } }`);
    });
  }

  // Generate GLSL Block Code
  const uboLines = [`uniform ${blockName} {`];
  packedMembers.forEach((m) => uboLines.push(`  ${m.type} ${m.name};`));
  uboLines.push('};');

  const layoutInfo = computeStd140Layout(packedMembers);

  return {
    blockName,
    packedMembers,
    uboGlsl: uboLines.join('\n'),
    aliasesGlsl: glslAliases.join('\n'),
    propertyYaml: propertyYamlLines.join('\n'),
    layout: layoutInfo,
    samplers,
  };
}

module.exports = {
  TYPE_SPECS,
  computeStd140Layout,
  packStd140Uniforms,
};
