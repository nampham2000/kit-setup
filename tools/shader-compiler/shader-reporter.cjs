'use strict';

/**
 * Report, Diagnostics & AI Polish Chunk Extractor for UCShaderTranspiler
 *
 * Produces:
 * - Markdown Report (<Shader>.report.md)
 * - JSON Report (<Shader>.report.json)
 * - AI Polish Context (README.ai-polish.md)
 * - AST-Scoped AI Polish Chunk Extractor (Low Token Consumption)
 * - Confidence Scoring (0-100, Grade A/B/C/D/F)
 */

const { calculateConfidenceBreakdown, detectShaderFamily } = require('./confidence-evaluator.cjs');

function scoreConfidence(docIR, effectText, validationResult) {
  const result = calculateConfidenceBreakdown(docIR, effectText, validationResult);
  return {
    score: result.breakdown.final,
    grade: result.grade,
    breakdown: result.breakdown,
    deductions: result.deductions,
    reasons: result.deductions.map(d => `${d.reason}: ${d.points}`),
  };
}

function generateMarkdownReport(docIR, effectText, validationResult, scoreInfo, variantInfo = null) {
  const breakdown = scoreInfo.breakdown || {
    parse: 20,
    hlslCompile: 25,
    semanticMapping: 25,
    cocosAbi: 15,
    renderState: 15,
    visualRiskPenalty: 0,
    final: scoreInfo.score,
  };

  const lines = [
    `# UCShaderTranspiler Report: ${docIR.shaderName}`,
    '',
    `**Static Conversion Confidence**: ${scoreInfo.score}/100 (Grade ${scoreInfo.grade})`,
    `**Cocos Import / Runtime Variant**: UNVERIFIED`,
    `**Visual Fidelity vs Unity**: UNVERIFIED`,
    `**Shader Family**: \`${docIR.family}\``,
    `**Properties**: ${docIR.properties.length} declared`,
    `**SubShaders / Passes**: ${docIR.subShaders.length} subshaders, ${docIR.subShaders.reduce((acc, s) => acc + s.passes.length, 0)} passes`,
    '',
    'This score measures parser/emitter/static-analysis coverage. It is not a visual similarity percentage.',
    '',
    '## Static Confidence Breakdown',
    `| Component | Max Points | Awarded |`,
    `|---|---|---|`,
    `| ShaderLab Parsing | 20 | ${breakdown.parse} |`,
    `| HLSL/GLSL Compilation | 25 | ${breakdown.hlslCompile} |`,
    `| Semantic Mapping | 25 | ${breakdown.semanticMapping} |`,
    `| Cocos ABI & Bindings | 15 | ${breakdown.cocosAbi} |`,
    `| Render State Fidelity | 15 | ${breakdown.renderState} |`,
    `| Visual Risk Penalty | - | -${breakdown.visualRiskPenalty} |`,
    `| **Final Score** | **100** | **${breakdown.final} (Grade ${scoreInfo.grade})** |`,
    '',
  ];

  if (scoreInfo.deductions && scoreInfo.deductions.length > 0) {
    lines.push('### Score Deduction Details');
    for (const d of scoreInfo.deductions) {
      lines.push(`- **[${d.category}]** ${d.reason} (${d.points} pts)`);
    }
    lines.push('');
  }

  lines.push('## Validation Status');
  lines.push(validationResult.valid ? '✅ **Status: VALID** (Passed static verification)' : '❌ **Status: INVALID** (Static verification failed)');
  lines.push('');

  if (variantInfo) {
    lines.push('## Shader Variants & Keywords Manifest');
    lines.push(`- **Diagnostic**: \`${variantInfo.reportMessage}\``);
    lines.push(`- **Policy**: \`${variantInfo.manifest.policy}\``);
    lines.push(`- **Total Combinations**: ${variantInfo.manifest.totalCombinations}`);
    lines.push(`- **Active Combinations**: ${variantInfo.manifest.activeCombinations}`);
    lines.push('');
  }

  if (validationResult.errors.length > 0) {
    lines.push('### Errors');
    for (const err of validationResult.errors) {
      lines.push(`- ❌ ${err}`);
    }
    lines.push('');
  }

  if (validationResult.warnings.length > 0) {
    lines.push('### Warnings & Notes');
    for (const warn of validationResult.warnings) {
      lines.push(`- ⚠️ ${warn}`);
    }
    lines.push('');
  }

  lines.push('## Properties Mapping');
  lines.push('| Unity Property | Cocos Property | Type | Default Value |');
  lines.push('|---|---|---|---|');
  for (const prop of docIR.properties) {
    const pVal = Array.isArray(prop.defaultValue) ? `[${prop.defaultValue.join(', ')}]` : String(prop.defaultValue);
    lines.push(`| \`${prop.name}\` | \`${prop.cocosName || prop.name}\` | \`${prop.cocosType}\` | \`${pVal}\` |`);
  }
  lines.push('');

  return lines.join('\n');
}

function generateJsonReport(docIR, effectText, validationResult, scoreInfo, variantInfo = null) {
  return JSON.stringify({
    shaderName: docIR.shaderName,
    sourceFile: docIR.sourceFile,
    family: docIR.family,
    // `score` stays for report compatibility. Its scope is made explicit so an
    // agent cannot treat Grade A/100 as Cocos compile or Unity visual parity.
    score: scoreInfo.score,
    staticConfidenceScore: scoreInfo.score,
    grade: scoreInfo.grade,
    evidenceScope: {
      staticAnalysis: validationResult.valid ? 'passed' : 'failed',
      cocosImporter: 'unverified',
      runtimeVariant: 'unverified',
      unityVisualParity: 'unverified',
    },
    valid: validationResult.valid,
    variants: variantInfo ? variantInfo.manifest : null,
    errors: validationResult.errors,
    warnings: validationResult.warnings,
    properties: docIR.properties.map(p => ({
      unityName: p.name,
      cocosName: p.cocosName || p.name,
      unityType: p.type,
      cocosType: p.cocosType,
      defaultValue: p.defaultValue,
    })),
    subShadersCount: docIR.subShaders.length,
    passesCount: docIR.subShaders.reduce((acc, s) => acc + s.passes.length, 0),
  }, null, 2);
}

/**
 * AST-Scoped Chunk Extractor for Low Token AI Polish
 */
function extractFaultyChunk(docIR, effectText, errorMsg = '') {
  const fsMatch = /CCProgram\s+fs\s*%\{([\s\S]*?)\}%/.exec(effectText);
  const fsBody = fsMatch ? fsMatch[1] : '';

  const uniformsList = docIR.properties.map(p => `${p.cocosType} ${p.cocosName}`).join(', ');
  const samplersList = docIR.properties.filter(p => p.type === '2D' || p.type === 'Cube').map(p => `${p.cocosType} ${p.cocosName}`).join(', ');

  return {
    target: 'frag',
    shaderName: docIR.shaderName,
    error: errorMsg,
    availableUniforms: uniformsList,
    availableSamplers: samplersList,
    scopedFragmentGlsl: fsBody.trim(),
    promptInstruction: 'Rewrite only the vec4 frag() body function in GLSL 300 ES using the provided uniform and sampler bindings.',
  };
}

function generateAiPolishContext(docIR, rawSource, effectText, validationResult, scoreInfo) {
  const chunk = extractFaultyChunk(docIR, effectText, validationResult.errors.join('; '));

  return [
    `# AI Polish Context: ${docIR.shaderName}`,
    '',
    `## Summary`,
    `- **Shader Family**: ${docIR.family}`,
    `- **Confidence Score**: ${scoreInfo.score}/100 (Grade ${scoreInfo.grade})`,
    `- **Target Engine**: Cocos Creator 3.8.8+ (.effect GLSL 300 ES)`,
    '',
    `## Scoped AI Payload (Low Token)`,
    '```json',
    JSON.stringify(chunk, null, 2),
    '```',
    '',
    `## Verification Notes`,
    validationResult.warnings.length > 0 ? validationResult.warnings.map(w => `- ${w}`).join('\n') : 'No open warnings.',
    '',
    `## Original Unity Shader Source`,
    '```shaderlab',
    rawSource.trim(),
    '```',
    '',
    `## Generated Cocos .effect Source`,
    '```glsl',
    effectText.trim(),
    '```',
  ].join('\n');
}

module.exports = {
  scoreConfidence,
  generateMarkdownReport,
  generateJsonReport,
  extractFaultyChunk,
  generateAiPolishContext,
};
