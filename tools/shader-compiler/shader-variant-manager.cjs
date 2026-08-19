'use strict';

/**
 * Shader Variant & Keyword Manifest Manager
 * for UCShaderTranspiler
 *
 * Implements:
 * - Parsing of all #pragma shader_feature & multi_compile forms:
 *   (shader_feature, shader_feature_local, shader_feature_vertex, shader_feature_fragment,
 *    multi_compile, multi_compile_local, multi_compile_vertex, multi_compile_fragment)
 * - Variant Tree Model (ShaderVariantNode) & total combination calculation
 * - Variant Policies: 'preserve' | 'material-driven' | 'strip-unused' | 'single-playable'
 * - Minimal safe keyword selection for Playable Ads
 * - Generation of shader-variants.json manifest and Cocos YAML defines
 */

const fs = require('fs');
const path = require('path');

/**
 * Parses all pragma keyword declarations in HLSL source
 */
function parsePragmaKeywords(hlslSource) {
  const pragmaRegex = /#pragma\s+(shader_feature|shader_feature_local|shader_feature_vertex|shader_feature_fragment|multi_compile|multi_compile_local|multi_compile_vertex|multi_compile_fragment)\s+([^\r\n]+)/gi;
  const groups = [];
  let match;

  while ((match = pragmaRegex.exec(hlslSource)) !== null) {
    const pragmaType = match[1].toLowerCase();
    const rawTokens = match[2].trim().split(/\s+/);

    const isLocal = pragmaType.includes('_local');
    let stage = 'both';
    if (pragmaType.includes('_vertex')) stage = 'vertex';
    else if (pragmaType.includes('_fragment')) stage = 'fragment';

    const isFeature = pragmaType.startsWith('shader_feature');

    // Filter out '_' empty placeholder
    const keywords = rawTokens.filter(t => t !== '_' && t.length > 0);

    if (keywords.length > 0) {
      groups.push({
        type: pragmaType,
        isFeature,
        scope: isLocal ? 'local' : 'global',
        stage,
        keywords,
        hasEmptyOption: rawTokens.includes('_'),
      });
    }
  }

  return groups;
}

/**
 * Builds the variant tree nodes and calculates total combinations
 */
function buildVariantTree(keywordGroups, sourceCode = '') {
  const nodes = [];
  let totalCombinations = 1;

  for (const group of keywordGroups) {
    const count = group.keywords.length + (group.hasEmptyOption ? 1 : 0);
    totalCombinations *= Math.max(count, 1);

    for (const kw of group.keywords) {
      // Find dependencies or sub-keywords in source
      const isUsed = sourceCode ? new RegExp(`\\bdefined\\s*\\(\\s*${kw}\\s*\\)|\\bdefined\\s+${kw}\\b|#ifdef\\s+${kw}\\b`, 'i').test(sourceCode) : true;

      nodes.push({
        keyword: kw,
        defaultValue: false,
        scope: group.scope,
        stage: group.stage,
        isFeature: group.isFeature,
        isUsedInSource: isUsed,
        dependencies: [],
      });
    }
  }

  return { nodes, totalCombinations };
}

/**
 * Enforces variant policy on the keyword nodes
 * @param {Array} nodes
 * @param {string} policy - 'preserve' | 'material-driven' | 'strip-unused' | 'single-playable'
 * @param {Object} options - { activeMaterialKeywords: Set<string>, sourceCode: string }
 */
function enforceVariantPolicy(nodes, policy = 'single-playable', options = {}) {
  const activeKeywords = new Map();
  const materialKeywords = options.activeMaterialKeywords || new Set();

  for (const node of nodes) {
    let isActive = false;

    switch (policy) {
      case 'preserve':
        // Keep all keywords defined
        isActive = true;
        break;

      case 'material-driven':
        // Activate if in material keywords
        isActive = materialKeywords.has(node.keyword);
        break;

      case 'strip-unused':
        // Activate only if referenced in shader code
        isActive = node.isUsedInSource;
        break;

      case 'single-playable':
      default:
        // Smallest safe set: activate if in material keywords OR referenced and essential
        if (materialKeywords.has(node.keyword)) {
          isActive = true;
        } else if (node.isUsedInSource && !node.isFeature) {
          // multi_compile required in code
          isActive = true;
        } else {
          isActive = false;
        }
        break;
    }

    activeKeywords.set(node.keyword, isActive);
  }

  const activeCount = Array.from(activeKeywords.values()).filter(Boolean).length;

  return {
    policy,
    activeKeywords: Object.fromEntries(activeKeywords),
    activeCount,
  };
}

/**
 * Generates the complete variant manifest JSON and diagnostic reports
 */
function generateVariantManifest(shaderName, rawHlsl, options = {}) {
  const policy = options.policy || 'single-playable';
  const groups = parsePragmaKeywords(rawHlsl);
  const { nodes, totalCombinations } = buildVariantTree(groups, rawHlsl);

  const materialKeywords = new Set(options.materialKeywords || []);
  const enforcement = enforceVariantPolicy(nodes, policy, {
    activeMaterialKeywords: materialKeywords,
    sourceCode: rawHlsl,
  });

  const activeCombinations = Math.max(1, enforcement.activeCount);

  const manifest = {
    shader: shaderName,
    policy,
    totalCombinations,
    activeCombinations,
    keywords: enforcement.activeKeywords,
    variantNodes: nodes,
  };

  const reportMessage = `UCST-VARIANT-002: ${totalCombinations} Unity keyword combination(s) detected. Playable profile selected ${activeCombinations} required combination(s).`;

  // Generate Cocos YAML defines array
  const cocosDefines = nodes.map(n => {
    return {
      name: n.keyword,
      type: 'boolean',
      default: enforcement.activeKeywords[n.keyword] || false,
    };
  });

  // Generate GLSL defines snippet
  const glslLines = [];
  for (const [kw, active] of Object.entries(enforcement.activeKeywords)) {
    if (active) {
      glslLines.push(`#define ${kw} 1`);
    } else {
      glslLines.push(`// #define ${kw} 0`);
    }
  }

  return {
    manifest,
    reportMessage,
    cocosDefines,
    glslDefines: glslLines.join('\n'),
  };
}

module.exports = {
  parsePragmaKeywords,
  buildVariantTree,
  enforceVariantPolicy,
  generateVariantManifest,
};
