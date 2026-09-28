'use strict';
/**
 * Parser for Unity's generated ShaderGraph shader code (ShaderGraphImporter.GetShaderText, dumped by
 * packages/unity-intelligence Capture/Editor/ShaderGraphCodeDump.cs). Extracts what the Cocos generator needs:
 * Properties (with defaults and attributes), SubShader tags (target id), and per pass: name, LightMode, render
 * state, defines/keywords, the URP pass include (target template), CBUFFER properties, textures/samplers,
 * graph includes, graph functions, the vertex/surface description structs + functions and the input structs.
 */

function section(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const j = text.indexOf(end, i + start.length);
  return text.slice(i + start.length, j < 0 ? undefined : j);
}

function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function parseProperties(text) {
  const m = /\bProperties\s*\{/.exec(text);
  if (!m) return [];
  const close = matchBrace(text, m.index + m[0].length - 1);
  const block = text.slice(m.index + m[0].length, close);
  const props = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    const pm = /^((?:\[[^\]]*\]\s*)*)(\w+)\s*\(\s*"([^"]*)"\s*,\s*([^)]*?)\)\s*=\s*(.+)$/.exec(line);
    if (!pm) continue;
    const attrs = [...pm[1].matchAll(/\[([^\]]*)\]/g)].map((a) => a[1].trim());
    const typeText = pm[4].trim();
    let type = typeText;
    let range = null;
    const rm = /^Range\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)$/i.exec(typeText);
    if (rm) { type = 'Range'; range = [Number(rm[1]), Number(rm[2])]; }
    const vm = /^Vector\s*,\s*(\d)$/i.exec(typeText);
    if (vm) type = 'Vector';
    const valueText = pm[5].trim();
    let value = null;
    const tuple = /^\(([^)]*)\)/.exec(valueText);
    if (tuple) value = tuple[1].split(',').map((x) => Number(x.trim()));
    else if (/^"/.test(valueText)) value = (/^"([^"]*)"/.exec(valueText) || [])[1] || '';
    else if (/^[-\d.]/.test(valueText)) value = Number(valueText.split(/\s/)[0]);
    props.push({
      name: pm[2], display: pm[3], type, range, value, attrs,
      hidden: attrs.includes('HideInInspector'), hdr: attrs.includes('HDR'), noScaleOffset: attrs.includes('NoScaleOffset'),
      normal: attrs.includes('Normal'), toggle: attrs.find((a) => /^Toggle/.test(a)) || null,
    });
  }
  return props;
}

function parseTags(text) {
  const tags = {};
  for (const m of text.matchAll(/"(\w+)"\s*=\s*"([^"]*)"/g)) if (!(m[1] in tags)) tags[m[1]] = m[2];
  return tags;
}

function splitPasses(text) {
  const starts = [];
  const re = /\n[ \t]*Pass[ \t]*\r?\n[ \t]*\{/g;
  let m;
  while ((m = re.exec(text))) starts.push(m.index);
  return starts.map((s, i) => text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length));
}

function renderState(pass) {
  const head = pass.slice(0, Math.max(0, pass.indexOf('HLSLPROGRAM')));
  const state = { cull: 'Back', zwrite: 'On', ztest: 'LEqual', blend: null, blendOp: null, colorMask: null };
  for (const raw of head.split(/\r?\n/)) {
    const t = raw.trim();
    let mm;
    if ((mm = /^Cull (\w+)/.exec(t))) state.cull = mm[1];
    if ((mm = /^ZWrite (\w+)/.exec(t))) state.zwrite = mm[1];
    if ((mm = /^ZTest (\w+)/.exec(t))) state.ztest = mm[1];
    if ((mm = /^Blend Off/.exec(t))) state.blend = null;
    else if ((mm = /^Blend (\w+) (\w+)(?:\s*,\s*(\w+) (\w+))?/.exec(t))) state.blend = mm.slice(1).filter(Boolean);
    if ((mm = /^BlendOp (\w+)/.exec(t))) state.blendOp = mm[1];
    if ((mm = /^ColorMask (\w+)/.exec(t))) state.colorMask = mm[1];
  }
  return state;
}

function parsePass(pass, index) {
  const name = (/Name\s+"([^"]+)"/.exec(pass) || [])[1] || `Pass${index}`;
  const lightMode = (/"LightMode"\s*=\s*"([^"]+)"/.exec(pass) || [])[1] || '';
  const program = section(pass, 'HLSLPROGRAM', 'ENDHLSL');
  const defines = new Map();
  for (const m of program.matchAll(/^[ \t]*#define\s+(\w+)(?:[ \t]+([^\r\n]*))?$/gm)) if (!defines.has(m[1])) defines.set(m[1], (m[2] || '').trim());
  const keywords = [...program.matchAll(/^[ \t]*#pragma\s+(multi_compile\w*|shader_feature\w*)\s+([^\r\n]*)$/gm)].map((m) => ({ kind: m[1], names: m[2].trim().split(/\s+/) }));
  const includes = [...program.matchAll(/#include(?:_with_pragmas)?\s+"([^"]+)"/g)].map((m) => m[1]);
  const passInclude = includes.map((p) => (/\/(\w+Pass)\.hlsl$/.exec(p) || [])[1]).filter((x) => x && x !== 'ShaderPass').pop() || null;
  const graphIncludesText = section(program, '// Graph Includes', '// -- Property');
  const graphIncludes = [...graphIncludesText.matchAll(/#include(?:_with_pragmas)?\s+"([^"]+)"/g)].map((m) => m[1]);
  const cbuffer = section(program, 'CBUFFER_START(UnityPerMaterial)', 'CBUFFER_END');
  const materialProps = [];
  for (const raw of cbuffer.split(/\r?\n/)) {
    const m = /^\s*(float[234]?(?:x[234])?|half[234]?|int[234]?|uint|bool)\s+(\w+)\s*;/.exec(raw);
    if (m) materialProps.push({ type: m[1], name: m[2] });
  }
  const objectGlobals = section(program, '// Object and Global properties', '// Graph Includes');
  const textures = [];
  for (const m of objectGlobals.matchAll(/\b(TEXTURE2D|TEXTURE2D_ARRAY|TEXTURE3D|TEXTURECUBE|TEXTURECUBE_ARRAY)\s*\(\s*(\w+)\s*\)/g)) {
    textures.push({ kind: m[1], name: m[2] });
  }
  const samplerStates = [...objectGlobals.matchAll(/\bSAMPLER\s*\(\s*(SamplerState_\w+)\s*\)/g)].map((m) => m[1]);
  const globalScalars = [];
  for (const raw of objectGlobals.split(/\r?\n/)) {
    const m = /^\s*(float[234]?(?:x[234])?|half[234]?)\s+(\w+)\s*;/.exec(raw);
    if (m && !materialProps.some((p) => p.name === m[2])) globalScalars.push({ type: m[1], name: m[2] });
  }
  const functions = section(program, '// Graph Functions', '// Custom interpolators pre vertex');
  const vertex = section(program, '// Graph Vertex', '// Custom interpolators, pre surface');
  const pixel = section(program, '// Graph Pixel', '// --------------------------------------------------');
  const structBody = (name) => {
    const m = new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\};`).exec(program);
    if (!m) return [];
    return m[1].split(/\r?\n/).map((l) => /^\s*(\w+)\s+(\w+)\s*(?::\s*\w+)?\s*;/.exec(l)).filter(Boolean)
      .map((mm) => ({ type: mm[1], name: mm[2] }));
  };
  return {
    index, name, lightMode, state: renderState(pass), defines, keywords, includes, passInclude, graphIncludes,
    materialProps, textures, samplerStates, globalScalars, functions, vertex, pixel,
    surfaceInputs: structBody('SurfaceDescriptionInputs'), vertexInputs: structBody('VertexDescriptionInputs'),
    surfaceOutputs: structBody('SurfaceDescription'), vertexOutputs: structBody('VertexDescription'),
    featuresGraphVertex: /#define\s+FEATURES_GRAPH_VERTEX\b/.test(program),
  };
}

/** Parse the full generated shader text. */
function parseGeneratedShaderGraph(text) {
  const src = String(text).replace(/\r\n/g, '\n');
  const shaderName = (/^\s*Shader\s+"([^"]+)"/.exec(src) || [])[1] || '';
  const properties = parseProperties(src);
  const sub = /\bSubShader\s*\{/.exec(src);
  const tagsBlock = sub ? section(src.slice(sub.index), 'Tags', '}') : '';
  const tags = parseTags(tagsBlock);
  const passes = splitPasses(src).map(parsePass);
  const fallbackError = /^ERROR\b/.test(src.trim()) ? src.trim().split('\n')[0] : null;
  return { shaderName, properties, tags, targetId: tags.ShaderGraphTargetId || null, passes, error: fallbackError };
}

module.exports = { parseGeneratedShaderGraph, parseProperties, splitPasses, parsePass, section };
