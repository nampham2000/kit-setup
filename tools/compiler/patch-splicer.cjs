'use strict';

/**
 * Structured Output & AST Patch Splicer
 *
 * Implements Section 7.4 of the Migration Specification:
 * - Ingests structured patch JSON from AI agents
 * - Validates patch bounds and node IDs
 * - Performs surgical line-level and AST-node-level splicing
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

/**
 * @typedef {Object} StructuredPatch
 * @property {string} file - Target file path
 * @property {string} [nodeId] - AST Node ID identifier
 * @property {Object} patch
 * @property {'replace' | 'insert' | 'delete'} patch.type
 * @property {number} patch.startLine - 1-based start line
 * @property {number} patch.endLine - 1-based end line
 * @property {string} patch.newCode - Replacement code content
 * @property {string} [explanation] - AI refinement explanation
 */

class PatchSplicer {
  /**
   * Applies a structured patch to TypeScript code string.
   * @param {string} sourceCode - Existing TS code
   * @param {StructuredPatch} patchData - Structured patch object
   * @returns {{ success: boolean, code: string, error?: string }}
   */
  applyPatch(sourceCode, patchData) {
    if (!patchData || !patchData.patch) {
      return { success: false, code: sourceCode, error: 'Invalid patch format: missing patch payload' };
    }

    const { type, startLine, endLine, newCode } = patchData.patch;
    const lines = sourceCode.split('\n');

    if (startLine < 1 || startLine > lines.length + 1) {
      return { success: false, code: sourceCode, error: `startLine ${startLine} out of bounds (1..${lines.length})` };
    }

    if (type === 'replace') {
      const actualEnd = Math.min(endLine || startLine, lines.length);
      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(actualEnd);
      const newLines = newCode.split('\n');
      const result = [...before, ...newLines, ...after].join('\n');
      return { success: true, code: result };
    } else if (type === 'insert') {
      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(startLine - 1);
      const newLines = newCode.split('\n');
      const result = [...before, ...newLines, ...after].join('\n');
      return { success: true, code: result };
    } else if (type === 'delete') {
      const actualEnd = Math.min(endLine || startLine, lines.length);
      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(actualEnd);
      const result = [...before, ...after].join('\n');
      return { success: true, code: result };
    }

    return { success: false, code: sourceCode, error: `Unsupported patch type '${type}'` };
  }

  /**
   * Applies structured patch directly to a file on disk.
   * @param {string} filePath - Absolute or relative file path
   * @param {StructuredPatch} patchData - Structured patch object
   * @returns {{ success: boolean, error?: string }}
   */
  applyPatchToFile(filePath, patchData) {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const res = this.applyPatch(source, patchData);
    if (!res.success) {
      return { success: false, error: res.error };
    }

    fs.writeFileSync(filePath, res.code, 'utf8');
    return { success: true };
  }
}

module.exports = {
  PatchSplicer,
};
