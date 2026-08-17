#!/usr/bin/env node
'use strict';

/**
 * CLI Tool: GLSL std140 UBO Alignment Formatter & Validator for CCEffects
 * 
 * Usage:
 *   node playable-shared-kit/tools/ubo-alignment-formatter.cjs check --file <effect_file>
 *   node playable-shared-kit/tools/ubo-alignment-formatter.cjs format --props <json_props_file>
 */

const fs = require('fs');
const path = require('path');
const { computeStd140Layout, packStd140Uniforms } = require('./unity-cocos-port/ubo-alignment-formatter');

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  console.log('\n======================================================');
  console.log('📐 GLSL std140 UBO Alignment Formatter for Cocos 3.8.8');
  console.log('======================================================\n');

  if (command === 'help' || args.length === 0) {
    console.log('Commands:');
    console.log('  check --file <path>       Inspect and validate UBO std140 alignment in a shader/effect.');
    console.log('  demo                      Run a demonstration packing mixed uniforms into std140.');
    console.log('');
    return;
  }

  if (command === 'demo') {
    const demoProps = [
      { name: '_Color', type: 'vec4', defaultValue: [1, 0, 0, 1] },
      { name: '_SpecularColor', type: 'vec3', defaultValue: [1, 1, 1] },
      { name: '_Glossiness', type: 'float', defaultValue: 0.8 },
      { name: '_Tiling', type: 'vec2', defaultValue: [2, 2] },
      { name: '_Offset', type: 'vec2', defaultValue: [0, 0] },
      { name: '_Cutoff', type: 'float', defaultValue: 0.5 },
      { name: '_BumpScale', type: 'float', defaultValue: 1.0 },
    ];

    console.log('Input Uniform Properties:');
    demoProps.forEach(p => console.log(`  • [${p.type}] ${p.name}`));

    const packed = packStd140Uniforms(demoProps, 'DemoParams');
    console.log('\n✨ Optimized std140 GLSL Block:');
    console.log(packed.uboGlsl);
    console.log('\n✨ GLSL Aliases:');
    console.log(packed.aliasesGlsl);
    console.log('\n✨ Cocos Properties YAML:');
    console.log(packed.propertyYaml);
    console.log(`\n📊 Total std140 Block Size: ${packed.layout.totalSize} bytes (Wasted: ${packed.layout.wastedBytes} bytes)`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  computeStd140Layout,
  packStd140Uniforms,
};
