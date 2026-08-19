'use strict';

/**
 * Unity Project Pre-Migration Analyzer
 *
 * Implements Section 9.1 of the Migration Specification:
 * - API usage frequency
 * - Dependency graph (JSON + DOT format)
 * - Estimated migration difficulty per class
 * - Unsupported features list
 * - Recommended migration order (topological sort)
 */

const fs = require('fs');
const path = require('path');
const { parseCSharpSource } = require('./csharp-parser.cjs');
const { collectCsFiles } = require('./unity-cs-compiler.cjs');

class ProjectAnalyzer {
  analyzeProject(sourceDir, options = {}) {
    const files = collectCsFiles(sourceDir);
    const apiUsage = new Map();
    const classDetails = [];
    const dependencyGraph = new Map(); // className -> Set<dependencyName>
    const fileToClasses = new Map();

    const knownUnityApis = [
      'Transform', 'GameObject', 'MonoBehaviour', 'Rigidbody', 'Collider', 'BoxCollider',
      'SphereCollider', 'Camera', 'AudioSource', 'AudioClip', 'ParticleSystem', 'Animation',
      'Animator', 'Text', 'Image', 'Button', 'Canvas', 'Physics', 'Input', 'Time', 'Mathf',
      'Random', 'PlayerPrefs', 'SceneManager', 'Resources', 'EventSystem', 'NavMesh', 'Shader'
    ];

    const getAllClasses = (ast) => {
      const classes = [...(ast.classes || [])];
      for (const ns of ast.namespaces || []) {
        classes.push(...(ns.classes || []));
      }
      return classes;
    };

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const ast = parseCSharpSource(content, path.basename(file));
      const declaredClasses = getAllClasses(ast).map(c => c.name);
      fileToClasses.set(file, declaredClasses);

      // Track API usage
      for (const api of knownUnityApis) {
        const regex = new RegExp(`\\b${api}\\b`, 'g');
        const matches = content.match(regex);
        if (matches) {
          apiUsage.set(api, (apiUsage.get(api) || 0) + matches.length);
        }
      }

      // Analyze each class
      for (const cls of getAllClasses(ast)) {
        const className = cls.name;
        const deps = new Set();
        const unsupportedFeatures = [];

        if (content.includes('unsafe') || content.includes('fixed ')) {
          unsupportedFeatures.push('Unsafe / Fixed buffer memory access');
        }
        if (content.includes('Thread') || content.includes('ThreadPool')) {
          unsupportedFeatures.push('Multi-threading (Thread / ThreadPool)');
        }
        if (content.includes('DllImport')) {
          unsupportedFeatures.push('Native C++ DllImport interop');
        }

        // Detect dependencies to other classes in project
        for (const otherFile of files) {
          if (otherFile === file) continue;
          const otherBase = path.basename(otherFile, '.cs');
          const depRegex = new RegExp(`\\b${otherBase}\\b`);
          if (depRegex.test(content)) {
            deps.add(otherBase);
          }
        }

        dependencyGraph.set(className, deps);

        // Calculate difficulty score (0..100)
        let score = 10;
        const lineCount = content.split('\n').length;
        score += Math.min(30, Math.floor(lineCount / 20));
        score += unsupportedFeatures.length * 25;
        if (content.includes('IEnumerator') || content.includes('yield return')) score += 15;
        if (content.includes('Physics') || content.includes('Raycast')) score += 15;
        if (content.includes('Animator') || content.includes('Animation')) score += 10;

        let difficulty = 'Easy';
        if (score >= 60) difficulty = 'Hard';
        else if (score >= 35) difficulty = 'Medium';

        classDetails.push({
          className,
          file: path.relative(sourceDir, file),
          lineCount,
          difficulty,
          score: Math.min(100, score),
          dependencies: Array.from(deps),
          unsupportedFeatures,
        });
      }
    }

    // Recommended migration order (topological sort, least dependencies first)
    const recommendedOrder = this._topologicalSort(dependencyGraph);

    // Generate DOT graph string
    const dotGraph = this._generateDotGraph(dependencyGraph);

    return {
      summary: {
        totalFiles: files.length,
        totalClasses: classDetails.length,
        timestamp: new Date().toISOString(),
      },
      apiUsageFrequency: Object.fromEntries(
        Array.from(apiUsage.entries()).sort((a, b) => b[1] - a[1])
      ),
      estimatedDifficulty: classDetails,
      recommendedMigrationOrder: recommendedOrder,
      dependencyGraph: Object.fromEntries(
        Array.from(dependencyGraph.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      dotGraph,
    };
  }

  _topologicalSort(graph) {
    const visited = new Set();
    const result = [];

    const visit = (node) => {
      if (visited.has(node)) return;
      visited.add(node);
      const deps = graph.get(node) || new Set();
      for (const dep of deps) {
        if (graph.has(dep)) {
          visit(dep);
        }
      }
      result.push(node);
    };

    for (const node of graph.keys()) {
      visit(node);
    }

    return result;
  }

  _generateDotGraph(graph) {
    const lines = ['digraph MigrationDependencies {', '  rankdir=LR;', '  node [shape=box, style=rounded, fontname="Helvetica"];'];
    for (const [node, deps] of graph.entries()) {
      for (const dep of deps) {
        lines.push(`  "${node}" -> "${dep}";`);
      }
    }
    lines.push('}');
    return lines.join('\n');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { src: '', out: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && args[i + 1]) options.src = args[++i];
    else if (args[i] === '--output' && args[i + 1]) options.out = args[++i];
    else if (!args[i].startsWith('--') && !options.src) options.src = args[i];
  }
  return options;
}

function main() {
  const options = parseArgs();
  if (!options.src) {
    console.log('Usage: node project-analyzer.cjs <UnityProjectDir> [--output <report.json>]');
    return;
  }

  const analyzer = new ProjectAnalyzer();
  const report = analyzer.analyzeProject(options.src);

  if (options.out) {
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Analysis saved to ${options.out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ProjectAnalyzer,
};
