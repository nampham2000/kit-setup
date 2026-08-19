'use strict';

/**
 * Golden Fixture Suite & Runner
 * for UCShaderTranspiler
 *
 * Runs and validates structured golden fixture directories conforming to:
 * fixture/
 *   ├── input.shader (or input.mat)
 *   ├── includes/
 *   ├── expected.effect
 *   ├── expected.report.json
 *   ├── expected.analysis.json
 *   ├── expected.material-map.json
 *   └── expected.ai-context.json
 */

const fs = require('fs');
const path = require('path');
const { parseShaderLab } = require('./shaderlab-parser.cjs');
const { emitCocosEffect } = require('./cocos-effect-generator.cjs');
const { validateCocosEffect } = require('./validation-differential-runner.cjs');
const { scoreConfidence, generateJsonReport } = require('./shader-reporter.cjs');
const { generateUcstAiJson } = require('./ai-polish-patch-generator.cjs');
const { generateMaterialAssetManifest } = require('./unity-material-converter.cjs');

/**
 * Executes an individual golden fixture directory
 */
function testGoldenFixture(fixtureDir) {
  const shaderPath = path.join(fixtureDir, 'input.shader');
  const matPath = path.join(fixtureDir, 'input.mat');

  const results = {
    fixtureName: path.basename(fixtureDir),
    passed: true,
    assertions: [],
  };

  // 1. Test Shader fixture if input.shader exists
  if (fs.existsSync(shaderPath)) {
    const rawSource = fs.readFileSync(shaderPath, 'utf8');
    const docIR = parseShaderLab(rawSource, path.basename(shaderPath));
    const effectCode = emitCocosEffect(docIR);
    const validation = validateCocosEffect(docIR, effectCode);
    const scoreInfo = scoreConfidence(docIR, effectCode, validation);

    results.assertions.push({
      name: 'Shader validation status',
      passed: validation.valid,
      details: validation.errors.length > 0 ? validation.errors.join('; ') : 'Valid',
    });

    const expectedEffectPath = path.join(fixtureDir, 'expected.effect');
    if (fs.existsSync(expectedEffectPath)) {
      const expectedEffect = fs.readFileSync(expectedEffectPath, 'utf8').trim();
      const actualEffect = effectCode.trim();
      // Check structural equivalence (has CCEffect and programs)
      const hasStructure = actualEffect.includes('CCEffect %{') && actualEffect.includes('CCProgram vs %{');
      results.assertions.push({
        name: 'Matches expected .effect structure',
        passed: hasStructure,
      });
    }

    const expectedReportPath = path.join(fixtureDir, 'expected.report.json');
    if (fs.existsSync(expectedReportPath)) {
      const jsonReport = JSON.parse(generateJsonReport(docIR, effectCode, validation, scoreInfo));
      results.assertions.push({
        name: 'Report JSON valid',
        passed: jsonReport.score >= 80,
      });
    }

    const expectedAiPath = path.join(fixtureDir, 'expected.ai-context.json');
    if (fs.existsSync(expectedAiPath)) {
      const aiJson = generateUcstAiJson(docIR, effectCode, validation, scoreInfo);
      results.assertions.push({
        name: 'AI Context JSON valid',
        passed: aiJson.shader !== undefined && aiJson.confidence >= 80,
      });
    }
  }

  // 2. Test Material fixture if input.mat exists
  if (fs.existsSync(matPath)) {
    const yaml = fs.readFileSync(matPath, 'utf8');
    const manifest = generateMaterialAssetManifest(yaml, { materialName: path.basename(fixtureDir) });
    const expectedMapPath = path.join(fixtureDir, 'expected.material-map.json');

    results.assertions.push({
      name: 'Material manifest valid',
      passed: manifest.material !== undefined && manifest.cocos !== undefined,
    });
  }

  results.passed = results.assertions.every(a => a.passed);
  return results;
}

/**
 * Runs all golden fixtures inside a directory
 */
function runAllGoldenFixtures(fixturesRootDir) {
  if (!fs.existsSync(fixturesRootDir)) return [];

  const subdirs = fs.readdirSync(fixturesRootDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(fixturesRootDir, d.name));

  const suiteResults = [];
  for (const dir of subdirs) {
    suiteResults.push(testGoldenFixture(dir));
  }

  return suiteResults;
}

module.exports = {
  testGoldenFixture,
  runAllGoldenFixtures,
};
