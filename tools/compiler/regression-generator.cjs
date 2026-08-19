'use strict';

/**
 * Regression Test Auto-Generator
 *
 * Generates `.test.cjs` regression fixtures whenever an AI Agent or engineer
 * resolves a compiler edge-case or coordinate bug to prevent future regressions.
 */

const fs = require('fs');
const path = require('path');

class RegressionGenerator {
  constructor(regressionsDir = '') {
    this.regressionsDir = regressionsDir || path.join(__dirname, 'regressions');
  }

  generateTest(testName, csharpSource, expectedMatches = [], forbiddenMatches = []) {
    if (!fs.existsSync(this.regressionsDir)) {
      fs.mkdirSync(this.regressionsDir, { recursive: true });
    }

    const safeName = testName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `regression-${safeName}.test.cjs`;
    const targetFile = path.join(this.regressionsDir, filename);

    const matchLines = expectedMatches.map(m => `  assert.match(code, ${m instanceof RegExp ? m.toString() : JSON.stringify(m)});`).join('\n');
    const forbidLines = forbiddenMatches.map(f => `  assert.doesNotMatch(code, ${f instanceof RegExp ? f.toString() : JSON.stringify(f)});`).join('\n');

    const content = [
      `'use strict';`,
      ``,
      `const test = require('node:test');`,
      `const assert = require('node:assert/strict');`,
      `const { parseCSharpSource } = require('../csharp-parser.cjs');`,
      `const { MigrationRulesEngine } = require('../migration-rules.cjs');`,
      `const { CocosEmitter } = require('../cocos-emitter.cjs');`,
      ``,
      `test(${JSON.stringify(testName)}, () => {`,
      `  const source = ${JSON.stringify(csharpSource)};`,
      `  const ast = parseCSharpSource(source, '${safeName}.cs');`,
      `  const ir = new MigrationRulesEngine().transform(ast);`,
      `  const code = new CocosEmitter().emit(ir);`,
      ``,
      matchLines,
      forbidLines,
      `});`,
      ``,
    ].filter(Boolean).join('\n');

    fs.writeFileSync(targetFile, content, 'utf8');
    return targetFile;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { name: '', cs: '', match: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) options.name = args[++i];
    else if (args[i] === '--cs' && args[i + 1]) options.cs = args[++i];
    else if (args[i] === '--match' && args[i + 1]) options.match.push(args[++i]);
  }
  return options;
}

function main() {
  const options = parseArgs();
  if (!options.name || !options.cs) {
    console.log('Usage: node regression-generator.cjs --name <test_name> --cs <csharp_code> [--match <regex_or_str>...]');
    return;
  }

  const generator = new RegressionGenerator();
  const file = generator.generateTest(options.name, options.cs, options.match);
  console.log(`Generated regression test -> ${file}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  RegressionGenerator,
};
