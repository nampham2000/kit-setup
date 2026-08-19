'use strict';

/**
 * ShaderLab Lexer & Parser for Unity -> Cocos Creator Transpiler
 *
 * Implements a balanced-token parser for ShaderLab syntax:
 * - Shader, Properties, SubShader, Pass, Category
 * - Render states (Cull, ZWrite, ZTest, Blend, BlendOp, ColorMask, Stencil)
 * - Property types (Float, Range, Color, Vector, 2D, Cube, 3D, Int, attributes)
 * - Program blocks (CGPROGRAM/HLSLPROGRAM, CGINCLUDE/HLSLINCLUDE)
 * - Pragmas (#pragma vertex, fragment, target, multi_compile, shader_feature, surface)
 */

const {
  createShaderDocumentIR,
  createShaderPropertyIR,
  createSubShaderIR,
  createShaderPassIR,
  createRenderStateIR,
  createShaderProgramIR,
  createDiagnosticIR,
} = require('./shader-ir.cjs');
const { analyzeHlslProgram } = require('./hlsl-ast-parser.cjs');
const { extractAndSpliceIncludes } = require('./shader-preprocessor.cjs');

/**
 * Helper to convert Unity property name into camelCase Cocos property name
 */
function toCocosPropertyName(unityName) {
  let name = String(unityName || '').replace(/^_+/, '');
  if (!name) return 'prop';
  name = name.charAt(0).toLowerCase() + name.slice(1);
  if (name === 'mainTex') return 'mainTexture';
  if (name === 'color') return 'baseColor';
  if (name === 'baseMap') return 'mainTexture';
  if (name === 'baseColor') return 'baseColor';
  return name;
}

/**
 * Strip comments while preserving line count (replaces with whitespace or empty lines)
 */
function cleanComments(source) {
  let inBlockComment = false;
  let inString = false;
  let quoteChar = '';
  let result = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] || '';

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
        result += '  ';
      } else {
        result += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (ch === '\\') {
        result += next;
        i += 1;
      } else if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      result += ch;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      result += '  ';
      continue;
    }

    if (ch === '/' && next === '/') {
      // Line comment: skip until newline
      result += '  ';
      i += 2;
      while (i < source.length && source[i] !== '\n') {
        result += ' ';
        i++;
      }
      if (i < source.length && source[i] === '\n') {
        result += '\n';
      }
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Finds matching closing brace for an opening brace at `openIndex`
 */
function findClosingBrace(str, openIndex) {
  let depth = 0;
  let inString = false;
  let quote = '';

  for (let i = openIndex; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Parses `Properties { ... }` block
 */
function parsePropertiesBlock(propertiesContent, diagnostics = []) {
  const properties = [];
  if (!propertiesContent) return properties;

  // Split lines or tokens
  const lines = propertiesContent.split(/\r?\n/);
  let currentAttributes = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex].trim();
    if (!line) continue;

    // Extract attributes like [Header(Text)], [Toggle], [Enum(One,1,Zero,0)], [MainTexture], etc.
    let attrMatch;
    const attrRegex = /\[([^\]]+)\]/g;
    while ((attrMatch = attrRegex.exec(line)) !== null) {
      currentAttributes.push(attrMatch[1].trim());
    }
    line = line.replace(/\[([^\]]+)\]/g, '').trim();
    if (!line) continue;

    // Match property: _Name ("Display Name", Type[(params)]) = DefaultValue [{}]
    // Examples:
    // _MainTex ("Texture", 2D) = "white" {}
    // _Color ("Tint", Color) = (1,1,1,1)
    // _Cutoff ("Cutoff", Range(0, 1)) = 0.5
    // _Speed ("Speed", Float) = 2.0
    // _Vector ("Offset", Vector) = (0,0,0,0)
    // _IntVal ("Count", Int) = 1
    const propRegex = /^([A-Za-z_]\w*)\s*\(\s*"([^"]*)"\s*,\s*([\s\S]+?)\)\s*=\s*([\s\S]+)$/;
    const match = propRegex.exec(line);

    if (match) {
      const name = match[1].trim();
      const displayName = match[2].trim();
      const rawType = match[3].trim();
      let rawDefault = match[4].trim();

      // Clean default value (remove trailing {} or comments)
      rawDefault = rawDefault.replace(/\{\s*\}\s*$/, '').trim();

      let type = 'Float';
      let range = null;
      let defaultValue = 0;
      let cocosType = 'float';
      let textureDefault = 'white';
      const editor = {};

      const rangeMatch = /^Range\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i.exec(rawType);
      if (rangeMatch) {
        type = 'Range';
        cocosType = 'float';
        range = [parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2])];
        defaultValue = parseFloat(rawDefault) || range[0];
        editor.range = range;
        editor.step = (range[1] - range[0]) > 10 ? 1 : 0.01;
      } else if (/^Color/i.test(rawType)) {
        type = 'Color';
        cocosType = 'vec4';
        editor.type = 'color';
        // Parse (r, g, b, a)
        const vecMatch = /\(([^)]+)\)/.exec(rawDefault);
        if (vecMatch) {
          defaultValue = vecMatch[1].split(',').map(v => parseFloat(v.trim()) || 0);
          while (defaultValue.length < 4) defaultValue.push(1);
        } else {
          defaultValue = [1, 1, 1, 1];
        }
      } else if (/^Vector/i.test(rawType)) {
        type = 'Vector';
        cocosType = 'vec4';
        const vecMatch = /\(([^)]+)\)/.exec(rawDefault);
        if (vecMatch) {
          defaultValue = vecMatch[1].split(',').map(v => parseFloat(v.trim()) || 0);
          while (defaultValue.length < 4) defaultValue.push(0);
        } else {
          defaultValue = [0, 0, 0, 0];
        }
      } else if (/^2D/i.test(rawType)) {
        type = '2D';
        cocosType = 'sampler2D';
        const texMatch = /"([^"]*)"/.exec(rawDefault);
        textureDefault = texMatch ? texMatch[1].toLowerCase() : 'white';
        if (!textureDefault) textureDefault = 'white';
        defaultValue = textureDefault;
      } else if (/^Cube/i.test(rawType)) {
        type = 'Cube';
        cocosType = 'samplerCube';
        const texMatch = /"([^"]*)"/.exec(rawDefault);
        textureDefault = texMatch ? texMatch[1].toLowerCase() : 'white';
        defaultValue = textureDefault;
      } else if (/^3D/i.test(rawType)) {
        type = '3D';
        cocosType = 'sampler3D';
        defaultValue = 'white';
      } else if (/^Int/i.test(rawType)) {
        type = 'Int';
        cocosType = 'int';
        defaultValue = parseInt(rawDefault, 10) || 0;
      } else if (/^Float/i.test(rawType)) {
        type = 'Float';
        cocosType = 'float';
        defaultValue = parseFloat(rawDefault) || 0;
      }

      // Check header / toggle attributes
      for (const attr of currentAttributes) {
        if (/^Header\s*\((.*)\)/i.test(attr)) {
          const headerText = attr.replace(/^Header\s*\(/i, '').replace(/\)$/, '').replace(/["']/g, '');
          editor.displayName = headerText;
        } else if (/^Toggle/i.test(attr)) {
          editor.type = 'boolean';
        } else if (/^HDR/i.test(attr)) {
          editor.hdr = true;
        }
      }

      properties.push(createShaderPropertyIR({
        name,
        displayName: displayName || name,
        type,
        range,
        defaultValue,
        attributes: [...currentAttributes],
        cocosName: toCocosPropertyName(name),
        cocosType,
        editor,
        textureDefault,
      }));

      currentAttributes = [];
    }
  }

  return properties;
}

/**
 * Parses `Tags { "Queue"="Transparent" ... }`
 */
function parseTagsBlock(tagsContent) {
  const tags = {};
  if (!tagsContent) return tags;

  const tagRegex = /"([^"]+)"\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = tagRegex.exec(tagsContent)) !== null) {
    tags[match[1]] = match[2];
  }
  return tags;
}

/**
 * Parses Render State settings from a SubShader or Pass block
 */
function parseRenderState(blockContent, defaultState = {}) {
  const state = createRenderStateIR(defaultState);

  // Cull Back | Front | Off | [_CullMode]
  const cullMatch = /\bCull\s+(Back|Front|Off|none|\[\w+\])/i.exec(blockContent);
  if (cullMatch) {
    const val = cullMatch[1].toLowerCase();
    if (val === 'off' || val === 'none') state.cull = 'none';
    else if (val === 'front') state.cull = 'front';
    else if (val.startsWith('[')) state.cull = 'none'; // dynamic
    else state.cull = 'back';
  }

  // ZWrite On | Off | [_ZWrite]
  const zWriteMatch = /\bZWrite\s+(On|Off|\[\w+\])/i.exec(blockContent);
  if (zWriteMatch) {
    state.zWrite = zWriteMatch[1].toLowerCase() === 'on';
  }

  // ZTest LEqual | Less | Greater | GEqual | Equal | NotEqual | Always | Off
  const zTestMatch = /\bZTest\s+(LEqual|Less|Greater|GEqual|Equal|NotEqual|Always|Off)/i.exec(blockContent);
  if (zTestMatch) {
    state.zTest = zTestMatch[1];
  }

  // Blend SrcFactor DstFactor, SrcFactorA DstFactorA
  // e.g. Blend SrcAlpha OneMinusSrcAlpha, Blend One One, Blend One [_Blend2]
  const blendMatch = /\bBlend\s+([A-Za-z0-9_\[\]]+)\s+([A-Za-z0-9_\[\]]+)(?:\s*,\s*([A-Za-z0-9_\[\]]+)\s+([A-Za-z0-9_\[\]]+))?/i.exec(blockContent);
  if (blendMatch) {
    const srcRGB = mapUnityBlendFactor(blendMatch[1]);
    const dstRGB = mapUnityBlendFactor(blendMatch[2]);
    const srcAlpha = blendMatch[3] ? mapUnityBlendFactor(blendMatch[3]) : srcRGB;
    const dstAlpha = blendMatch[4] ? mapUnityBlendFactor(blendMatch[4]) : dstRGB;

    state.blend = {
      enabled: true,
      srcRGB,
      dstRGB,
      srcAlpha,
      dstAlpha,
      opRGB: 'add',
      opAlpha: 'add',
    };
  } else if (/\bBlend\s+Off\b/i.test(blockContent)) {
    state.blend = { enabled: false };
  }

  // BlendOp Add | Sub | RevSub | Min | Max
  const blendOpMatch = /\bBlendOp\s+([A-Za-z0-9_]+)(?:\s*,\s*([A-Za-z0-9_]+))?/i.exec(blockContent);
  if (blendOpMatch && state.blend) {
    state.blend.opRGB = mapUnityBlendOp(blendOpMatch[1]);
    state.blend.opAlpha = blendOpMatch[2] ? mapUnityBlendOp(blendOpMatch[2]) : state.blend.opRGB;
  }

  // AlphaToMask On | Off
  const alphaToMaskMatch = /\bAlphaToMask\s+(On|Off)/i.exec(blockContent);
  if (alphaToMaskMatch) {
    state.alphaToCoverage = alphaToMaskMatch[1].toLowerCase() === 'on';
  }

  // Offset Factor, Units
  const offsetMatch = /\bOffset\s+([-\d.]+)\s*,\s*([-\d.]+)/i.exec(blockContent);
  if (offsetMatch) {
    state.depthBias = parseFloat(offsetMatch[1]) || 0;
    state.depthBiasSlope = parseFloat(offsetMatch[2]) || 0;
  }

  // ColorMask RGB | RGBA | A | R | G | B | 0
  const colorMaskMatch = /\bColorMask\s+([RGBA0]+)/i.exec(blockContent);
  if (colorMaskMatch) {
    state.colorMask = colorMaskMatch[1].toUpperCase();
  }

  // Stencil block
  const stencilMatch = /\bStencil\s*\{([\s\S]*?)\}/i.exec(blockContent);
  if (stencilMatch) {
    const sBlock = stencilMatch[1];
    const comp = (/\bComp\s+(\w+)/i.exec(sBlock) || [])[1] || 'Always';
    const pass = (/\bPass\s+(\w+)/i.exec(sBlock) || [])[1] || 'Keep';
    const fail = (/\bFail\s+(\w+)/i.exec(sBlock) || [])[1] || 'Keep';
    const zFail = (/\bZFail\s+(\w+)/i.exec(sBlock) || [])[1] || 'Keep';

    const compFront = (/\bCompFront\s+(\w+)/i.exec(sBlock) || [])[1] || comp;
    const passFront = (/\bPassFront\s+(\w+)/i.exec(sBlock) || [])[1] || pass;
    const failFront = (/\bFailFront\s+(\w+)/i.exec(sBlock) || [])[1] || fail;
    const zFailFront = (/\bZFailFront\s+(\w+)/i.exec(sBlock) || [])[1] || zFail;

    const compBack = (/\bCompBack\s+(\w+)/i.exec(sBlock) || [])[1] || comp;
    const passBack = (/\bPassBack\s+(\w+)/i.exec(sBlock) || [])[1] || pass;
    const failBack = (/\bFailBack\s+(\w+)/i.exec(sBlock) || [])[1] || fail;
    const zFailBack = (/\bZFailBack\s+(\w+)/i.exec(sBlock) || [])[1] || zFail;

    state.stencil = {
      enabled: true,
      ref: parseInt((/\bRef\s+(\d+)/i.exec(sBlock) || [])[1], 10) || 0,
      readMask: parseInt((/\bReadMask\s+(\d+)/i.exec(sBlock) || [])[1], 10) || 255,
      writeMask: parseInt((/\bWriteMask\s+(\d+)/i.exec(sBlock) || [])[1], 10) || 255,
      comp: mapUnityStencilComp(comp),
      pass: mapUnityStencilOp(pass),
      fail: mapUnityStencilOp(fail),
      zFail: mapUnityStencilOp(zFail),
      compFront: mapUnityStencilComp(compFront),
      passFront: mapUnityStencilOp(passFront),
      failFront: mapUnityStencilOp(failFront),
      zFailFront: mapUnityStencilOp(zFailFront),
      compBack: mapUnityStencilComp(compBack),
      passBack: mapUnityStencilOp(passBack),
      failBack: mapUnityStencilOp(failBack),
      zFailBack: mapUnityStencilOp(zFailBack),
    };
  }

  return state;
}

/**
 * Maps Unity BlendOp strings to Cocos Creator blend equation strings
 */
function mapUnityBlendOp(op) {
  if (!op) return 'add';
  const o = op.toLowerCase();
  switch (o) {
    case 'sub': return 'sub';
    case 'revsub': return 'rev_sub';
    case 'min': return 'min';
    case 'max': return 'max';
    default: return 'add';
  }
}

/**
 * Maps Unity Stencil comparison strings to Cocos Creator
 */
function mapUnityStencilComp(comp) {
  if (!comp) return 'always';
  const c = comp.toLowerCase();
  switch (c) {
    case 'greater': return 'greater';
    case 'gequal': return 'greater_equal';
    case 'less': return 'less';
    case 'lequal': return 'less_equal';
    case 'equal': return 'equal';
    case 'notequal': return 'not_equal';
    case 'never': return 'never';
    default: return 'always';
  }
}

/**
 * Maps Unity Stencil operation strings to Cocos Creator
 */
function mapUnityStencilOp(op) {
  if (!op) return 'keep';
  const o = op.toLowerCase();
  switch (o) {
    case 'zero': return 'zero';
    case 'replace': return 'replace';
    case 'incrsat': return 'incr_sat';
    case 'decrsat': return 'decr_sat';
    case 'invert': return 'invert';
    case 'incrwrap': return 'incr_wrap';
    case 'decrwrap': return 'decr_wrap';
    default: return 'keep';
  }
}

/**
 * Maps Unity Blend Factor strings to Cocos Creator blend strings
 */
function mapUnityBlendFactor(factor) {
  if (!factor) return 'one';
  const f = factor.replace(/^\[|\]$/g, '').toLowerCase();
  switch (f) {
    case 'srcalpha': return 'src_alpha';
    case 'oneminussrcalpha':
    case 'oneminus_srcalpha':
    case 'oneminusrcalpha': return 'one_minus_src_alpha';
    case 'one': return 'one';
    case 'zero': return 'zero';
    case 'dstcolor': return 'dst_color';
    case 'srccolor': return 'src_color';
    case 'oneminusdstcolor': return 'one_minus_dst_color';
    case 'oneminussrccolor': return 'one_minus_src_color';
    case 'dstalpha': return 'dst_alpha';
    case 'oneminusdstalpha': return 'one_minus_dst_alpha';
    default: return 'one';
  }
}

/**
 * Extracts HLSL/Cg Program source and pragma directives from a Pass block
 */
function extractProgram(passContent, globalInclude = '') {
  const program = createShaderProgramIR();

  // Find CGPROGRAM ... ENDCG or HLSLPROGRAM ... ENDHLSL
  let code = '';
  const hlslMatch = /HLSLPROGRAM([\s\S]*?)ENDHLSL/i.exec(passContent);
  const cgMatch = /CGPROGRAM([\s\S]*?)ENDCG/i.exec(passContent);

  if (hlslMatch) {
    code = hlslMatch[1];
    program.language = 'hlsl';
  } else if (cgMatch) {
    code = cgMatch[1];
    program.language = 'cg';
  } else {
    code = '';
  }

  if (globalInclude) {
    code = globalInclude + '\n' + code;
  }

  program.rawHlsl = code;

  // Extract pragmas
  const pragmaRegex = /#pragma\s+([^\r\n]+)/g;
  let pragmaMatch;
  while ((pragmaMatch = pragmaRegex.exec(code)) !== null) {
    const pragmaLine = pragmaMatch[1].trim();
    program.pragmas.push(pragmaLine);

    const parts = pragmaLine.split(/\s+/);
    const directive = parts[0];

    if (directive === 'vertex' && parts[1]) {
      program.vertexEntry = parts[1];
    } else if (directive === 'fragment' && parts[1]) {
      program.fragmentEntry = parts[1];
    } else if (directive === 'target' && parts[1]) {
      program.target = parts[1];
    } else if ((directive === 'shader_feature' || directive === 'shader_feature_local' || directive === 'multi_compile') && parts.length > 1) {
      program.keywords.push(...parts.slice(1));
    } else if (directive === 'surface' && parts.length > 1) {
      program.features.isSurfaceShader = true;
      program.features.surfaceEntry = parts[1];
      program.features.surfaceLighting = parts[2] || 'Standard';
    }
  }

  // Extract #include statements
  const incRegex = /#include\s+["<]([^">]+)[">]/g;
  let incMatch;
  while ((incMatch = incRegex.exec(code)) !== null) {
    program.includes.push(incMatch[1]);
  }

  analyzeHlslProgram(program);

  return program;
}

/**
 * Parses a ShaderLab source string into a ShaderDocumentIR
 */
function parseShaderLab(source, filename = '') {
  const diagnostics = [];
  const cleaned = cleanComments(source);

  // Match Shader "Name" { ... }
  const shaderMatch = /\bShader\s+"([^"]+)"\s*\{/i.exec(cleaned);
  if (!shaderMatch) {
    diagnostics.push(createDiagnosticIR({
      code: 'UCST-PARSE-001',
      severity: 'error',
      category: 'parse',
      message: 'No valid Shader "Name" { ... } block found in source file.',
      sourceFile: filename,
    }));
    return createShaderDocumentIR({
      sourceFile: filename,
      shaderName: filename ? filename.replace(/\.[^/.]+$/, '') : 'UnknownShader',
      diagnostics,
    });
  }

  const shaderName = shaderMatch[1];
  const shaderBodyOpen = shaderMatch.index + shaderMatch[0].length - 1;
  const shaderBodyClose = findClosingBrace(cleaned, shaderBodyOpen);
  let shaderBody = shaderBodyClose > shaderBodyOpen
    ? cleaned.slice(shaderBodyOpen + 1, shaderBodyClose)
    : cleaned.slice(shaderBodyOpen + 1);

  shaderBody = extractAndSpliceIncludes(shaderBody);

  // Extract Fallback
  const fallBackMatch = /\bFallback\s+("([^"]+)"|Off)/i.exec(shaderBody);
  const fallBack = fallBackMatch ? (fallBackMatch[2] || fallBackMatch[1]) : 'Off';

  // Extract CustomEditor
  const customEditorMatch = /\bCustomEditor\s+"([^"]+)"/i.exec(shaderBody);
  const customEditor = customEditorMatch ? customEditorMatch[1] : '';

  // Extract Properties block
  let properties = [];
  const propsMatch = /\bProperties\s*\{/i.exec(shaderBody);
  if (propsMatch) {
    const propsOpen = propsMatch.index + propsMatch[0].length - 1;
    const propsClose = findClosingBrace(shaderBody, propsOpen);
    if (propsClose > propsOpen) {
      const propsContent = shaderBody.slice(propsOpen + 1, propsClose);
      properties = parsePropertiesBlock(propsContent, diagnostics);
    }
  }

  // Extract Global HLSLINCLUDE / CGINCLUDE if any
  let globalInclude = '';
  const globalHlslInc = /HLSLINCLUDE([\s\S]*?)ENDHLSL/i.exec(shaderBody);
  const globalCgInc = /CGINCLUDE([\s\S]*?)ENDCG/i.exec(shaderBody);
  if (globalHlslInc) globalInclude += globalHlslInc[1] + '\n';
  if (globalCgInc) globalInclude += globalCgInc[1] + '\n';

  // Extract Category or SubShaders
  const subShaders = [];
  let subShaderIdx = 0;

  // Search for SubShader blocks
  const subShaderRegex = /\bSubShader\s*\{/gi;
  let ssMatch;
  while ((ssMatch = subShaderRegex.exec(shaderBody)) !== null) {
    const ssOpen = ssMatch.index + ssMatch[0].length - 1;
    const ssClose = findClosingBrace(shaderBody, ssOpen);
    if (ssClose <= ssOpen) continue;

    const ssContent = shaderBody.slice(ssOpen + 1, ssClose);

    // SubShader Tags
    let ssTags = {};
    const ssTagsMatch = /\bTags\s*\{([\s\S]*?)\}/i.exec(ssContent);
    if (ssTagsMatch) {
      ssTags = parseTagsBlock(ssTagsMatch[1]);
    }

    // SubShader LOD
    const lodMatch = /\bLOD\s+(\d+)/i.exec(ssContent);
    const lod = lodMatch ? parseInt(lodMatch[1], 10) : 100;

    // SubShader default render state
    const ssRenderState = parseRenderState(ssContent);

    // Parse Passes inside this SubShader
    const passes = [];
    const passRegex = /\b(Pass|GrabPass)\s*\{/gi;
    let pMatch;
    let passIndex = 0;

    while ((pMatch = passRegex.exec(ssContent)) !== null) {
      const isGrabPass = /^GrabPass/i.test(pMatch[1]);
      const pOpen = pMatch.index + pMatch[0].length - 1;
      const pClose = findClosingBrace(ssContent, pOpen);
      if (pClose <= pOpen) continue;

      const pContent = ssContent.slice(pOpen + 1, pClose);

      // Pass Name
      const nameMatch = /\bName\s+"([^"]+)"/i.exec(pContent);
      const passName = nameMatch ? nameMatch[1] : `Pass_${passIndex}`;

      // Pass Tags
      let passTags = { ...ssTags };
      const pTagsMatch = /\bTags\s*\{([\s\S]*?)\}/i.exec(pContent);
      if (pTagsMatch) {
        Object.assign(passTags, parseTagsBlock(pTagsMatch[1]));
      }

      // LightMode
      const lightMode = passTags.LightMode || passTags.lightmode || '';

      // Pass Render State (merges with SubShader state)
      const passRenderState = parseRenderState(pContent, ssRenderState);

      // Program
      const program = extractProgram(pContent, globalInclude);

      passes.push(createShaderPassIR({
        id: `pass_${subShaderIdx}_${passIndex}`,
        name: passName,
        lightMode,
        tags: passTags,
        renderState: passRenderState,
        program,
        isGrabPass,
      }));

      passIndex++;
    }

    // Parse UsePass statements inside this SubShader
    const usePassRegex = /\bUsePass\s+"([^"]+)"/gi;
    let upMatch;
    while ((upMatch = usePassRegex.exec(ssContent)) !== null) {
      const target = upMatch[1];
      passes.push(createShaderPassIR({
        id: `usepass_${subShaderIdx}_${passIndex++}`,
        name: `UsePass_${target.replace(/[\/\\]/g, '_')}`,
        usePass: target,
        renderState: ssRenderState,
        program: createShaderProgramIR(),
      }));
    }

    // If SubShader had HLSLPROGRAM/CGPROGRAM directly without Pass wrapper (e.g. Surface Shaders)
    if (passes.length === 0 && (/\b(HLSLPROGRAM|CGPROGRAM)\b/i.test(ssContent))) {
      const program = extractProgram(ssContent, globalInclude);
      passes.push(createShaderPassIR({
        id: `pass_${subShaderIdx}_0`,
        name: 'DefaultPass',
        tags: ssTags,
        renderState: ssRenderState,
        program,
      }));
    }

    subShaders.push(createSubShaderIR({
      index: subShaderIdx,
      tags: ssTags,
      lod,
      renderState: ssRenderState,
      passes,
    }));

    subShaderIdx++;
  }

  // Detect Shader Family
  let family = 'CustomVertexFragment';
  const allHlsl = subShaders.map(s => s.passes.map(p => p.program.rawHlsl).join(' ')).join(' ');

  if (/SurfaceOutput|#pragma\s+surface/i.test(allHlsl)) {
    family = 'Surface';
  } else if (/MatCap|computeMatCap/i.test(allHlsl) || /MatCap/i.test(shaderName)) {
    family = 'MatCap';
  } else if (/Toon|Ramp|ShadowStep|RimStep/i.test(allHlsl) || /Toon/i.test(shaderName)) {
    family = 'Toon';
  } else if (/Dissolve|applyDissolve/i.test(allHlsl) || /Dissolve/i.test(shaderName)) {
    family = 'Dissolve';
  } else if (/UniversalPipeline|UniversalRenderPipeline|UniversalForward/i.test(source)) {
    family = 'URP';
  } else if (/Unlit/i.test(shaderName) || (!/LightMode|Lighting/i.test(allHlsl) && !/_WorldSpaceLightPos/i.test(allHlsl))) {
    family = 'Unlit';
  }

  // Collect dependencies
  const dependencies = [];
  if (fallBack && fallBack !== 'Off') {
    dependencies.push({ type: 'Fallback', target: fallBack });
  }
  for (const s of subShaders) {
    for (const p of s.passes) {
      if (p.usePass) {
        dependencies.push({ type: 'UsePass', target: p.usePass });
      }
    }
  }

  return createShaderDocumentIR({
    sourceFile: filename,
    shaderName,
    family,
    properties,
    subShaders,
    fallBack,
    dependencies,
    customEditor,
    diagnostics,
  });
}

module.exports = {
  parseShaderLab,
  parsePropertiesBlock,
  parseTagsBlock,
  parseRenderState,
  toCocosPropertyName,
};
