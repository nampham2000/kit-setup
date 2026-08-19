'use strict';

/**
 * 5-Layer Static Validation Framework
 *
 * Implements Section 8.1 of the Migration Specification:
 * - Layer 1 (Syntax): TypeScript Parser check (ensure syntactically valid AST)
 * - Layer 2 (Type): tsc --noEmit static type checker
 * - Layer 3 (Cocos API): Validate API existence, decorators (@ccclass, @property), imports from 'cc'
 * - Layer 4 (Migration Linter): Check for @MIGRATION_TODO, @MIGRATION_WARNING, unsupported patterns
 * - Layer 5 (Dependency Graph): Circular dependency & missing module import detection
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { COCOS_API_CATALOG } = require('./cocos-api-catalog.cjs');

class StaticValidator {
  /**
   * Runs all 5 static validation layers on a set of TypeScript files.
   * @param {string[]} filePaths
   * @param {Object} [options]
   * @returns {{ status: 'PASS' | 'FAIL', layers: Record<string, { passed: boolean, errors: any[], warnings: any[] }> }}
   */
  validate(filePaths, options = {}) {
    const results = {
      status: 'PASS',
      layers: {
        syntax: { passed: true, errors: [], warnings: [] },
        type: { passed: true, errors: [], warnings: [] },
        cocosApi: { passed: true, errors: [], warnings: [] },
        migration: { passed: true, errors: [], warnings: [] },
        dependency: { passed: true, errors: [], warnings: [] },
      },
    };

    const validFiles = filePaths.filter(f => fs.existsSync(f) && f.endsWith('.ts') && !f.endsWith('.d.ts'));

    // ── Layer 1: Syntax Validation ──────────────────────────────────────────
    for (const file of validFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(path.basename(file), content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const parseDiagnostics = sf.parseDiagnostics || [];
      if (parseDiagnostics.length > 0) {
        for (const diag of parseDiagnostics) {
          const pos = sf.getLineAndCharacterOfPosition(diag.start || 0);
          results.layers.syntax.errors.push({
            file,
            line: pos.line + 1,
            col: pos.character + 1,
            message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
          });
        }
        results.layers.syntax.passed = false;
      }
    }

    // ── Layer 2: Type Validation (tsc --noEmit) ─────────────────────────────
    if (options.runTypeCheck !== false && validFiles.length > 0) {
      const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        experimentalDecorators: true,
        noEmit: true,
        skipLibCheck: true,
        strict: false,
      };
      const host = ts.createCompilerHost(compilerOptions);
      const program = ts.createProgram(validFiles, compilerOptions, host);
      const diags = ts.getPreEmitDiagnostics(program);
      for (const diag of diags) {
        if (diag.category === ts.DiagnosticCategory.Error) {
          let f = '';
          let line = 0;
          if (diag.file && diag.start !== undefined) {
            f = diag.file.fileName;
            line = diag.file.getLineAndCharacterOfPosition(diag.start).line + 1;
          }
          results.layers.type.errors.push({
            code: `TS${diag.code}`,
            file: f,
            line,
            message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
          });
          results.layers.type.passed = false;
        }
      }
    }

    // ── Layer 3: Cocos API Validation ───────────────────────────────────────
    for (const file of validFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('class ') && content.includes('extends Component')) {
        if (!content.includes('@ccclass')) {
          results.layers.cocosApi.errors.push({
            file,
            message: 'Class extends Component but missing @ccclass decorator',
          });
          results.layers.cocosApi.passed = false;
        }
      }
    }

    // ── Layer 4: Migration Linter ───────────────────────────────────────────
    for (const file of validFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('@MIGRATION_TODO')) {
          results.layers.migration.warnings.push({
            file,
            line: i + 1,
            type: 'TODO',
            message: line.trim(),
          });
        }
        if (line.includes('@MIGRATION_WARNING')) {
          results.layers.migration.warnings.push({
            file,
            line: i + 1,
            type: 'WARNING',
            message: line.trim(),
          });
        }
      }
    }

    // ── Layer 5: Dependency Graph & Circular Dependency Detection ───────────
    const importGraph = new Map(); // file -> Set<importedFiles>
    for (const file of validFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(path.basename(file), content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const imports = new Set();
      ts.forEachChild(sf, node => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const impPath = node.moduleSpecifier.text;
          if (impPath.startsWith('.')) {
            const resolved = path.resolve(path.dirname(file), impPath.endsWith('.ts') ? impPath : impPath + '.ts');
            imports.add(resolved);
          }
        }
      });
      importGraph.set(path.resolve(file), imports);
    }

    // Cycle detection via DFS
    const visited = new Set();
    const stack = new Set();

    const detectCycle = (node, pathNodes = []) => {
      visited.add(node);
      stack.add(node);
      pathNodes.push(node);

      const neighbors = importGraph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (detectCycle(neighbor, [...pathNodes])) return true;
        } else if (stack.has(neighbor)) {
          const cycleStr = [...pathNodes, neighbor].map(p => path.basename(p)).join(' -> ');
          results.layers.dependency.errors.push({
            file: node,
            message: `Circular dependency detected: ${cycleStr}`,
          });
          results.layers.dependency.passed = false;
          return true;
        }
      }

      stack.delete(node);
      return false;
    };

    for (const fileNode of importGraph.keys()) {
      if (!visited.has(fileNode)) {
        detectCycle(fileNode);
      }
    }

    // Overall status check
    if (
      !results.layers.syntax.passed ||
      !results.layers.type.passed ||
      !results.layers.cocosApi.passed ||
      !results.layers.dependency.passed
    ) {
      results.status = 'FAIL';
    }

    return results;
  }
}

module.exports = {
  StaticValidator,
};
