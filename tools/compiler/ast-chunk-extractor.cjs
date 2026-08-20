'use strict';

/**
 * AST-Scoped Chunk Extractor & Splicer
 *
 * Isolates low-confidence (<0.70) code blocks and @MIGRATION_TODO items
 * into compact, targeted payloads (~200-400 tokens) for AI refinement.
 * Provides surgical AST splicing to merge refined snippets back into TS files.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

class AstChunkExtractor {
  /**
   * @param {string} tsCode        emitted TypeScript
   * @param {string} csharpSource  original C#, for the paired context block
   * @param {string} filename
   * @param {{errorLines?: Set<number>}} [options]
   *   errorLines: 1-based lines carrying a resolved type error. Passing these
   *   makes the extractor scope members that FAIL TO COMPILE, not only ones the
   *   emitter marked with a TODO — a file can be entirely TODO-free and still
   *   not type-check, which is the common case.
   */
  extractChunks(tsCode, csharpSource = '', filename = '', options = {}) {
    const errorLines = options.errorLines instanceof Set ? options.errorLines : new Set();
    const sourceFile = ts.createSourceFile(
      filename || 'temp.ts',
      tsCode,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS
    );

    const lines = tsCode.split('\n');
    const chunks = [];

    const visit = node => {
      // Check for methods, properties, and constructors
      if (
        ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isFunctionDeclaration(node)
      ) {
        const nodeText = node.getText(sourceFile);
        const hasTodo = nodeText.includes('@MIGRATION_TODO') || nodeText.includes('// @MIGRATION_TODO');
        const isUnsupported = nodeText.includes('Unsupported Statement') || nodeText.includes('pointer');
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        const memberErrorLines = [];
        for (const line of errorLines) {
          if (line >= start.line + 1 && line <= end.line + 1) memberErrorLines.push(line);
        }

        if (hasTodo || isUnsupported || memberErrorLines.length > 0) {

          let memberName = 'anonymous';
          if (node.name) {
            memberName = node.name.getText(sourceFile);
          } else if (ts.isConstructorDeclaration(node)) {
            memberName = 'constructor';
          }

          // Extract reason
          let reason = memberErrorLines.length > 0
            ? `${memberErrorLines.length} TypeScript type error(s) inside this member`
            : 'Construct requires semantic refinement';
          const todoMatch = nodeText.match(/@MIGRATION_TODO(?::|\s+\[)?([^\]\n*]+)/);
          if (todoMatch) {
            reason = todoMatch[1].trim();
          }

          // Extract matching C# context if provided
          let csContext = '';
          if (csharpSource && memberName !== 'anonymous') {
            const csLines = csharpSource.split('\n');
            const pattern = new RegExp(`\\b${memberName}\\b`);
            for (let i = 0; i < csLines.length; i++) {
              if (pattern.test(csLines[i])) {
                const chunkStart = Math.max(0, i - 2);
                const chunkEnd = Math.min(csLines.length, i + 15);
                csContext = csLines.slice(chunkStart, chunkEnd).join('\n');
                break;
              }
            }
          }

          const chunkId = `${path.basename(filename || 'File')}:${memberName}:${start.line + 1}`;
          chunks.push({
            id: chunkId,
            astNodeId: chunkId,
            filePath: filename,
            memberName,
            startLine: start.line + 1,
            endLine: end.line + 1,
            startPos: node.getStart(sourceFile),
            endPos: node.getEnd(),
            sourceMap: {
              startLine: start.line + 1,
              startCol: start.character + 1,
              endLine: end.line + 1,
              endCol: end.character + 1,
              startOffset: node.getStart(sourceFile),
              endOffset: node.getEnd(),
            },
            emittedCode: nodeText,
            csharpContext: csContext,
            reason,
            trigger: hasTodo ? 'migration-todo' : (isUnsupported ? 'unsupported-construct' : 'type-error'),
            errorLines: memberErrorLines,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return chunks;
  }

  spliceChunk(originalTsCode, chunk, replacementTsCode) {
    const before = originalTsCode.slice(0, chunk.startPos);
    const after = originalTsCode.slice(chunk.endPos);
    return before + replacementTsCode + after;
  }

  buildRefinementPrompt(chunk, filename) {
    return [
      `// === AI Refinement Target: ${filename} ===`,
      `// Method: ${chunk.memberName} (Lines ${chunk.startLine}-${chunk.endLine})`,
      `// Issue: ${chunk.reason}`,
      '',
      chunk.csharpContext ? `// Original C# Source Context:\n/*\n${chunk.csharpContext}\n*/\n` : '',
      `// Current Cocos Creator 3.8.8 Emitted Code:`,
      chunk.emittedCode,
      '',
      `// Instruction: Return ONLY the corrected TypeScript method implementation complying with Cocos Creator 3.8.8 Zero-GC rules.`,
    ].join('\n');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { ts: '', cs: '', outJson: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ts' && args[i + 1]) options.ts = args[++i];
    else if (args[i] === '--cs' && args[i + 1]) options.cs = args[++i];
    else if (args[i] === '--out-json' && args[i + 1]) options.outJson = args[++i];
  }
  return options;
}

function main() {
  const options = parseArgs();
  if (!options.ts) {
    console.log('Usage: node ast-chunk-extractor.cjs --ts <file.ts> [--cs <file.cs>] [--out-json <out.json>]');
    return;
  }

  const tsCode = fs.readFileSync(options.ts, 'utf8');
  const csSource = options.cs && fs.existsSync(options.cs) ? fs.readFileSync(options.cs, 'utf8') : '';
  const extractor = new AstChunkExtractor();
  const chunks = extractor.extractChunks(tsCode, csSource, path.basename(options.ts));

  console.log(`Extracted ${chunks.length} refinement chunk(s) from ${options.ts}`);
  if (options.outJson) {
    fs.writeFileSync(options.outJson, JSON.stringify(chunks, null, 2), 'utf8');
    console.log(`Chunks saved to ${options.outJson}`);
  } else {
    for (const chunk of chunks) {
      console.log(`\n--- Chunk: ${chunk.memberName} (Lines ${chunk.startLine}-${chunk.endLine}) ---`);
      console.log(`Reason: ${chunk.reason}`);
      console.log(extractor.buildRefinementPrompt(chunk, path.basename(options.ts)));
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  AstChunkExtractor,
};
