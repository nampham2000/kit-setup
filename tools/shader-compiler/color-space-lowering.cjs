'use strict';

const { replaceCall } = require('./call-rewriter.cjs');

const SRGB_SAMPLE_HELPER = `
  vec4 CCDecodeColorSample(vec4 sampleColor) {
    sampleColor.rgb = SRGBToLinear(sampleColor.rgb);
    return sampleColor;
  }
`;

const DATA_TEXTURE_NAME = /(?:normal|bump|mask|metal|rough|smooth|occlusion|ao|height|depth|noise|dissolve|distort|flow|lookup|lut|ramp|matcap|specular|gloss)/i;
const COLOR_TEXTURE_NAME = /(?:maintex|basemap|basecolormap|albedo|diffuse|emission|emissive|color(?:map|tex|texture)?)/i;

function isLikelySrgbSampler(sampler) {
  const names = [sampler && sampler.originalName, sampler && sampler.name]
    .filter(Boolean).map(String);
  if (names.some(name => DATA_TEXTURE_NAME.test(name))) return false;
  return names.some(name => COLOR_TEXTURE_NAME.test(name));
}

function srgbSamplerNames(samplers) {
  return (samplers || []).filter(isLikelySrgbSampler).map(s => s.name);
}

/**
 * Unity samples an sRGB TextureImporter through hardware decoding. Cocos custom
 * effects expose the stored sRGB values and its builtin effects explicitly call
 * SRGBToLinear(). Wrap only known color samplers; data maps must remain raw.
 */
function lowerSrgbTextureSamples(code, names) {
  const selected = new Set(names || []);
  if (!code || selected.size === 0) return code;
  let out = code;
  for (const sampler of selected) {
    // Preserve source shaders that already perform an explicit decode.
    const escaped = sampler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`SRGBToLinear\\s*\\([^;{}]*\\b${escaped}\\b`).test(out)) {
      selected.delete(sampler);
    }
  }
  if (selected.size === 0) return out;
  for (const callName of ['texture', 'textureLod', 'textureProj', 'texU']) {
    out = replaceCall(out, callName, (args) => {
      if (!args.length || !selected.has(args[0].trim())) return null;
      return `CCDecodeColorSample(${callName}(${args.join(', ')}))`;
    });
  }
  return out;
}

module.exports = {
  SRGB_SAMPLE_HELPER,
  isLikelySrgbSampler,
  srgbSamplerNames,
  lowerSrgbTextureSamples,
};
