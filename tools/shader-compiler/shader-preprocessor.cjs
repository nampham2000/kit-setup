'use strict';

/**
 * ShaderLab Preprocessor & Include Resolution Engine v2
 * for UCShaderTranspiler
 *
 * Implements:
 * - C-style Macro & Preprocessor Evaluation (#if, #ifdef, #ifndef, #elif, #else, #endif, #define, #undef)
 * - Platform & Playable Profile Defaults (SHADER_API_MOBILE, SHADER_API_GLES3, SHADER_TARGET_GLSL, UNITY_VERSION)
 * - Global CGINCLUDE / HLSLINCLUDE Block Extraction and Splicing into Passes
 * - Include Dependency Graph Model (IncludeGraphNode, IncludeResolutionResult)
 * - Circular Include Detection & Include Depth Tracking
 * - UsePass and Fallback Reference Resolving
 */

const fs = require('fs');
const path = require('path');
const { UnityIncludeResolver } = require('./unity-include-resolver.cjs');

const DEFAULT_PLATFORM_DEFINES = {
  SHADER_API_MOBILE: '1',
  SHADER_API_GLES3: '1',
  SHADER_TARGET_GLSL: '1',
  UNITY_COMPILER_HLSL: '1',
  UNITY_VERSION: '202230',
  SHADER_TARGET: '30',
};

/**
 * Evaluates a preprocessor condition expression (e.g., "defined(A) && !defined(B) || VALUE >= 2")
 */
function evaluateCondition(expr, defines) {
  let clean = expr.trim();

  // Replace defined(FOO) and defined FOO with 1 or 0
  clean = clean.replace(/\bdefined\s*\(\s*([A-Za-z_]\w*)\s*\)/g, (_, name) => {
    return defines.has(name) ? '1' : '0';
  });
  clean = clean.replace(/\bdefined\s+([A-Za-z_]\w*)/g, (_, name) => {
    return defines.has(name) ? '1' : '0';
  });

  // Replace identifiers with their defined value or 0
  clean = clean.replace(/\b([A-Za-z_]\w*)\b/g, (match, name) => {
    if (name === 'true') return '1';
    if (name === 'false') return '0';
    if (defines.has(name)) {
      const val = defines.get(name);
      return val !== '' && val !== undefined ? String(val) : '1';
    }
    return '0';
  });

  // Evaluate safely
  try {
    // Only allow safe arithmetic & logical operators: numbers, (), !, &&, ||, ==, !=, <, >, <=, >=, +, -, *, /, %
    if (/^[0-9\s()!&|<>=+\-*/%]+$/.test(clean)) {
      // eslint-disable-next-line no-new-func
      const func = new Function(`return Boolean(${clean});`);
      return Boolean(func());
    }
  } catch (_) {
    // Fallback on error
  }
  return false;
}

/**
 * Preprocesses a raw HLSL/ShaderLab source text
 */
function preprocessShaderSource(source, options = {}) {
  const customDefines = options.defines || {};
  const defines = new Map(Object.entries({ ...DEFAULT_PLATFORM_DEFINES, ...customDefines }));
  const searchRoots = options.searchRoots || [];
  const currentFile = options.currentFile || 'source.shader';
  const currentFileDir = options.currentFile ? path.dirname(options.currentFile) : process.cwd();

  const resolver = options.resolver || new UnityIncludeResolver({ searchRoots });
  const graph = [];
  const resolvedFiles = new Map();
  const unresolved = [];
  const diagnostics = [];

  const includeStack = [currentFile];
  const maxDepth = options.maxDepth || 32;

  function processText(text, filePath, depth) {
    if (depth > maxDepth) {
      diagnostics.push({
        severity: 'error',
        message: `Maximum include depth (${maxDepth}) exceeded at file: ${filePath}`,
        file: filePath,
      });
      return `// [ERROR: Max include depth exceeded: ${filePath}]\n`;
    }

    const lines = text.split(/\r?\n/);
    const outputLines = [];
    const ifStack = []; // Stack of { active: boolean, branchTaken: boolean }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const trimmed = line.trim();

      // Conditional directives
      if (trimmed.startsWith('#ifdef')) {
        const match = /^#ifdef\s+([A-Za-z_]\w*)/.exec(trimmed);
        const parentActive = ifStack.length === 0 || ifStack[ifStack.length - 1].active;
        const conditionMet = parentActive && match && defines.has(match[1]);
        ifStack.push({ active: conditionMet, branchTaken: conditionMet });
        continue;
      } else if (trimmed.startsWith('#ifndef')) {
        const match = /^#ifndef\s+([A-Za-z_]\w*)/.exec(trimmed);
        const parentActive = ifStack.length === 0 || ifStack[ifStack.length - 1].active;
        const conditionMet = parentActive && match && !defines.has(match[1]);
        ifStack.push({ active: conditionMet, branchTaken: conditionMet });
        continue;
      } else if (trimmed.startsWith('#if')) {
        const expr = trimmed.slice(3).trim();
        const parentActive = ifStack.length === 0 || ifStack[ifStack.length - 1].active;
        const conditionMet = parentActive && evaluateCondition(expr, defines);
        ifStack.push({ active: conditionMet, branchTaken: conditionMet });
        continue;
      } else if (trimmed.startsWith('#elif')) {
        const expr = trimmed.slice(5).trim();
        if (ifStack.length > 0) {
          const current = ifStack[ifStack.length - 1];
          const parentActive = ifStack.length === 1 || ifStack[ifStack.length - 2].active;
          if (parentActive && !current.branchTaken && evaluateCondition(expr, defines)) {
            current.active = true;
            current.branchTaken = true;
          } else {
            current.active = false;
          }
        }
        continue;
      } else if (trimmed.startsWith('#else')) {
        if (ifStack.length > 0) {
          const current = ifStack[ifStack.length - 1];
          const parentActive = ifStack.length === 1 || ifStack[ifStack.length - 2].active;
          current.active = parentActive && !current.branchTaken;
        }
        continue;
      } else if (trimmed.startsWith('#endif')) {
        if (ifStack.length > 0) {
          ifStack.pop();
        }
        continue;
      }

      // Check if current block is active
      const isBlockActive = ifStack.length === 0 || ifStack[ifStack.length - 1].active;
      if (!isBlockActive) {
        continue;
      }

      // #define directive
      if (trimmed.startsWith('#define')) {
        const match = /^#define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/.exec(trimmed);
        if (match) {
          const dName = match[1];
          const dVal = match[2] !== undefined ? match[2].trim() : '';
          defines.set(dName, dVal);
        }
        outputLines.push(line);
        continue;
      }

      // #undef directive
      if (trimmed.startsWith('#undef')) {
        const match = /^#undef\s+([A-Za-z_]\w*)/.exec(trimmed);
        if (match) {
          defines.delete(match[1]);
        }
        outputLines.push(line);
        continue;
      }

      // #include directive
      if (trimmed.startsWith('#include')) {
        const incMatch = /^#include\s+["<]([^">]+)[">]/.exec(trimmed);
        if (incMatch) {
          const incPath = incMatch[1];

          // Check circular inclusion
          if (includeStack.includes(incPath)) {
            diagnostics.push({
              severity: 'warning',
              message: `Circular include detected: ${incPath} in [${includeStack.join(' -> ')}]`,
              file: filePath,
            });
            outputLines.push(`// [Skipped circular include: ${incPath}]`);
            continue;
          }

          const fileDir = path.dirname(filePath);
          const resolved = resolver.resolveInclude(incPath, fileDir);

          const graphNode = {
            file: incPath,
            resolvedPath: resolved.path,
            isBuiltin: resolved.isBuiltin || false,
            depth: depth + 1,
            parent: filePath,
          };
          graph.push(graphNode);

          if (resolved.unresolved) {
            unresolved.push({ includePath: incPath, file: filePath, line: lineIdx + 1 });
            outputLines.push(`// [Unresolved include: ${incPath}]`);
          } else {
            resolvedFiles.set(incPath, resolved.content);

            includeStack.push(incPath);
            const nestedProcessed = processText(resolved.content, resolved.path, depth + 1);
            includeStack.pop();

            outputLines.push(`// --- BEGIN INCLUDE: ${incPath} ---`);
            outputLines.push(nestedProcessed);
            outputLines.push(`// --- END INCLUDE: ${incPath} ---`);
          }
          continue;
        }
      }

      outputLines.push(line);
    }

    return outputLines.join('\n');
  }

  const processedSource = processText(source, currentFile, 0);

  return {
    processedSource,
    result: {
      resolvedFiles,
      unresolved,
      graph,
      includeDepth: graph.reduce((max, n) => Math.max(max, n.depth), 0),
      diagnostics,
      defines: Object.fromEntries(defines),
    },
  };
}

/**
 * Extracts global CGINCLUDE / HLSLINCLUDE blocks and injects them into SubShader passes
 */
function extractAndSpliceIncludes(source) {
  const includeBlocks = [];

  // Match CGINCLUDE ... ENDCG
  const cgIncRegex = /\bCGINCLUDE\b([\s\S]*?)\bENDCG\b/g;
  let match;
  while ((match = cgIncRegex.exec(source)) !== null) {
    includeBlocks.push(match[1]);
  }

  // Match HLSLINCLUDE ... ENDHLSL
  const hlslIncRegex = /\bHLSLINCLUDE\b([\s\S]*?)\bENDHLSL\b/g;
  while ((match = hlslIncRegex.exec(source)) !== null) {
    includeBlocks.push(match[1]);
  }

  if (includeBlocks.length === 0) {
    return source;
  }

  const joinedIncludes = includeBlocks.join('\n\n');

  // Strip top-level include blocks from source
  let cleanSource = source.replace(/\bCGINCLUDE\b[\s\S]*?\bENDCG\b/g, '');
  cleanSource = cleanSource.replace(/\bHLSLINCLUDE\b[\s\S]*?\bENDHLSL\b/g, '');

  // Inject into CGPROGRAM / HLSLPROGRAM blocks
  cleanSource = cleanSource.replace(/\bCGPROGRAM\b/g, `CGPROGRAM\n${joinedIncludes}\n`);
  cleanSource = cleanSource.replace(/\bHLSLPROGRAM\b/g, `HLSLPROGRAM\n${joinedIncludes}\n`);

  return cleanSource;
}

module.exports = {
  DEFAULT_PLATFORM_DEFINES,
  evaluateCondition,
  preprocessShaderSource,
  extractAndSpliceIncludes,
};
