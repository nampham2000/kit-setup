'use strict';

/**
 * Universal Unity Projects Batch Shader & Material Test Runner
 *
 * Scans and tests all Unity projects in d:\_Projects\Unity\
 * - HoleScrum4
 * - MarbleSort
 * - MyCozyHome
 * - SmashFest
 * - Tank3d
 * - TestGamePackages
 */

const fs = require('fs');
const path = require('path');
const { parseShaderLab } = require('./shaderlab-parser.cjs');
const { analyzeHlslProgram } = require('./hlsl-ast-parser.cjs');
const { emitCocosEffect } = require('./cocos-effect-generator.cjs');
const { validateCceffectStructure, lintPlayableShader } = require('./shader-validator.cjs');
const { scoreConfidence } = require('./shader-reporter.cjs');
const { convertUnityMatToCocosMtl } = require('./unity-material-converter.cjs');

const UNITY_ROOT = 'd:\\_Projects\\Unity';

function findFilesRecursive(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip Library, Temp, obj, Logs, Packages cache to be fast
        if (['Library', 'Temp', 'obj', 'Logs', '.git', 'Build', 'Builds'].includes(entry.name)) {
          continue;
        }
        results.push(...findFilesRecursive(fullPath, extensions));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Ignore access errors
  }
  return results;
}

function testProject(projectName, projectDir) {
  console.log(`\n=================================================================`);
  console.log(`🔍 Testing Project: ${projectName} (${projectDir})`);
  console.log(`=================================================================`);

  const shaderFiles = findFilesRecursive(projectDir, ['.shader']);
  const matFiles = findFilesRecursive(projectDir, ['.mat']);

  console.log(`Found ${shaderFiles.length} shaders and ${matFiles.length} materials.\n`);

  const stats = {
    totalShaders: shaderFiles.length,
    passedShaders: 0,
    failedShaders: 0,
    totalScore: 0,
    grades: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    families: {},
    shadersResults: [],
    testedMaterials: 0,
    passedMaterials: 0,
  };

  // Test Shaders
  for (const sPath of shaderFiles) {
    const relPath = path.relative(projectDir, sPath);
    try {
      const source = fs.readFileSync(sPath, 'utf8');
      const docIR = parseShaderLab(source, sPath);

      // Analyze HLSL
      for (const sub of docIR.subShaders) {
        for (const pass of sub.passes) {
          analyzeHlslProgram(pass.program);
        }
      }

      // Emit Effect
      const effectCode = emitCocosEffect(docIR);

      // Validate
      const validation = validateCceffectStructure(effectCode);
      const lintResult = lintPlayableShader(docIR, effectCode);
      for (const issue of (lintResult.issues || [])) {
        validation.warnings.push(`[${issue.severity.toUpperCase()}] ${issue.message}`);
      }

      const scoreInfo = scoreConfidence(docIR, effectCode, validation);

      stats.families[docIR.family] = (stats.families[docIR.family] || 0) + 1;
      stats.grades[scoreInfo.grade] = (stats.grades[scoreInfo.grade] || 0) + 1;
      stats.totalScore += scoreInfo.score;

      if (validation.valid) {
        stats.passedShaders++;
      } else {
        stats.failedShaders++;
      }

      stats.shadersResults.push({
        path: relPath,
        name: docIR.shaderName,
        family: docIR.family,
        score: scoreInfo.score,
        grade: scoreInfo.grade,
        valid: validation.valid,
        errors: validation.errors,
      });

      const icon = validation.valid ? '✅' : '❌';
      console.log(`  ${icon} [${scoreInfo.grade.padEnd(2)} ${String(scoreInfo.score).padStart(3)}/100] [${docIR.family.padEnd(8)}] ${relPath}`);
      if (validation.errors.length > 0) {
        for (const err of validation.errors) {
          console.log(`     └─ ❌ ${err}`);
        }
      }
    } catch (e) {
      stats.failedShaders++;
      stats.grades.F++;
      console.log(`  ❌ [F    0/100] [CRASH   ] ${relPath}: ${e.message}`);
      stats.shadersResults.push({
        path: relPath,
        name: path.basename(sPath),
        family: 'Error',
        score: 0,
        grade: 'F',
        valid: false,
        errors: [e.message],
      });
    }
  }

  // Test Sample Materials (up to 20 per project for speed)
  const sampleMats = matFiles.slice(0, 20);
  for (const mPath of sampleMats) {
    stats.testedMaterials++;
    try {
      const matYaml = fs.readFileSync(mPath, 'utf8');
      const mtlJson = convertUnityMatToCocosMtl(matYaml, {
        materialName: path.basename(mPath, '.mat'),
      });
      const parsed = JSON.parse(mtlJson);
      if (parsed.__type__ === 'cc.Material' && Array.isArray(parsed._props)) {
        stats.passedMaterials++;
      }
    } catch (err) {
      // Failed material
    }
  }

  const avgScore = stats.totalShaders > 0 ? (stats.totalScore / stats.totalShaders).toFixed(1) : 'N/A';
  console.log(`\n--- Summary for ${projectName} ---`);
  console.log(`Shaders:   ${stats.passedShaders}/${stats.totalShaders} valid, Avg Score: ${avgScore}`);
  console.log(`Grades:    A: ${stats.grades.A}, B: ${stats.grades.B}, C: ${stats.grades.C}, D: ${stats.grades.D}, F: ${stats.grades.F}`);
  console.log(`Materials: ${stats.passedMaterials}/${stats.testedMaterials} successfully converted`);

  return stats;
}

function runAll() {
  const targetRoot = process.argv[2] || UNITY_ROOT;
  console.log(`🚀 Starting Universal Unity Projects Shader & Material Verification in: ${targetRoot}\n`);

  if (!fs.existsSync(targetRoot)) {
    console.error(`Unity root not found: ${targetRoot}`);
    process.exit(1);
  }

  const projectDirs = fs.readdirSync(targetRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, path: path.join(targetRoot, d.name) }));

  console.log(`Found ${projectDirs.length} projects in ${targetRoot}:`);
  for (const p of projectDirs) {
    console.log(`  - ${p.name}`);
  }

  const allStats = {};
  for (const p of projectDirs) {
    allStats[p.name] = testProject(p.name, p.path);
  }

  // Grand Total Summary
  console.log(`\n=================================================================`);
  console.log(`📊 GRAND SUMMARY ACROSS ALL UNITY PROJECTS`);
  console.log(`=================================================================`);

  let totalShadersAll = 0;
  let passedShadersAll = 0;
  let totalScoreAll = 0;
  let totalMatsTestedAll = 0;
  let totalMatsPassedAll = 0;

  console.log(`| Project Name | Total Shaders | Valid | Pass Rate | Avg Score | Grades (A/B/C/D/F) | Materials Tested |`);
  console.log(`|---|---|---|---|---|---|---|`);

  for (const [pName, st] of Object.entries(allStats)) {
    totalShadersAll += st.totalShaders;
    passedShadersAll += st.passedShaders;
    totalScoreAll += st.totalScore;
    totalMatsTestedAll += st.testedMaterials;
    totalMatsPassedAll += st.passedMaterials;

    const rate = st.totalShaders > 0 ? ((st.passedShaders / st.totalShaders) * 100).toFixed(1) + '%' : 'N/A';
    const avg = st.totalShaders > 0 ? (st.totalScore / st.totalShaders).toFixed(1) : 'N/A';
    const gradesStr = `${st.grades.A}/${st.grades.B}/${st.grades.C}/${st.grades.D}/${st.grades.F}`;
    console.log(`| **${pName}** | ${st.totalShaders} | ${st.passedShaders} | ${rate} | ${avg} | ${gradesStr} | ${st.passedMaterials}/${st.testedMaterials} |`);
  }

  const totalRate = totalShadersAll > 0 ? ((passedShadersAll / totalShadersAll) * 100).toFixed(1) + '%' : '100%';
  const totalAvg = totalShadersAll > 0 ? (totalScoreAll / totalShadersAll).toFixed(1) : '100';

  console.log(`| **TOTAL** | **${totalShadersAll}** | **${passedShadersAll}** | **${totalRate}** | **${totalAvg}** | - | **${totalMatsPassedAll}/${totalMatsTestedAll}** |`);
  console.log(`=================================================================\n`);
}

if (require.main === module) {
  runAll();
}

module.exports = {
  testProject,
  runAll,
};
