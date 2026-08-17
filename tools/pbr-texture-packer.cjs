#!/usr/bin/env node
'use strict';

/**
 * CLI Tool: PBR Texture Channel Packer for Cocos Creator 3.8.8
 * Converts Unity Metallic-Glossiness + Occlusion textures into standard Cocos ORM PBR maps.
 * 
 * Usage:
 *   node playable-shared-kit/tools/pbr-texture-packer.cjs --metallic <path> --occlusion <path> --output <out_path>
 */

const path = require('path');
const fs = require('fs');
const { packPbrOrmTexture } = require('./unity-cocos-port/pbr-texture-packer');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    metallicGlossPath: '',
    occlusionPath: '',
    roughnessPath: '',
    outputPath: '',
    defaultMetallic: 0.0,
    defaultRoughness: 0.5,
    defaultOcclusion: 1.0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--metallic' || arg === '-m') {
      options.metallicGlossPath = args[++i];
    } else if (arg === '--occlusion' || arg === '-ao') {
      options.occlusionPath = args[++i];
    } else if (arg === '--roughness' || arg === '-r') {
      options.roughnessPath = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.outputPath = args[++i];
    } else if (arg === '--default-metallic') {
      options.defaultMetallic = parseFloat(args[++i]);
    } else if (arg === '--default-roughness') {
      options.defaultRoughness = parseFloat(args[++i]);
    } else if (arg === '--default-occlusion') {
      options.defaultOcclusion = parseFloat(args[++i]);
    }
  }

  return options;
}

function main() {
  const options = parseArgs();

  console.log('\n======================================================');
  console.log('🎨 Cocos Creator 3.8.8 PBR Texture Channel Packer');
  console.log('======================================================\n');

  if (!options.metallicGlossPath && !options.occlusionPath && !options.roughnessPath) {
    console.log('Usage: node pbr-texture-packer.cjs --metallic <metallic_png> [--occlusion <ao_png>] --output <out_orm_png>');
    console.log('\nChannels packed into output:');
    console.log('  • Red (R)   = Ambient Occlusion');
    console.log('  • Green (G) = Roughness (1.0 - Smoothness)');
    console.log('  • Blue (B)  = Metallic');
    console.log('  • Alpha (A) = 255 (Full Opacity)\n');
    process.exit(0);
  }

  if (!options.outputPath) {
    options.outputPath = 'assets/textures/pbr_packed_orm.png';
  }

  console.log(`• Metallic/Gloss Map: ${options.metallicGlossPath || '(None, using default: ' + options.defaultMetallic + ')'}`);
  console.log(`• Occlusion Map:      ${options.occlusionPath || '(None, using default: ' + options.defaultOcclusion + ')'}`);
  console.log(`• Roughness Map:      ${options.roughnessPath || '(None, derived from Glossiness or default: ' + options.defaultRoughness + ')'}`);
  console.log(`• Output Path:        ${options.outputPath}\n`);

  try {
    const result = packPbrOrmTexture(options);
    console.log(`✅ [SUCCESS] Generated PBR ORM Texture (${result.width}x${result.height}) at: ${options.outputPath}\n`);
  } catch (err) {
    console.error(`❌ [ERROR] Failed to pack PBR texture: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  packPbrOrmTexture,
};
