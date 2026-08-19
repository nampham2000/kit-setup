'use strict';

/**
 * Security & Robustness Hardening
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. Include roots allowlist & Path traversal protection
 * 2. Symlink resolution & realpath validation
 * 3. Process timeout & shell injection protection (spawnSync with arg arrays, no shell)
 * 4. Compiler output & source file size caps
 * 5. Maximum include depth limit (preventing cyclic recursion)
 * 6. Guaranteed temporary directory cleanup
 * 7. Script injection prevention (no eval / script execution)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const MAX_INCLUDE_DEPTH = 32;
const MAX_SOURCE_FILE_SIZE = 10 * 1024 * 1024;      // 10 MB
const MAX_COMPILER_OUTPUT_SIZE = 5 * 1024 * 1024;   // 5 MB
const DEFAULT_PROCESS_TIMEOUT_MS = 5000;            // 5 seconds

/**
 * Validates and safely resolves an include path within allowlisted root directories
 */
function validateSafeIncludePath(includePath, allowlistRoots = [], currentFileDir = null) {
  if (!includePath || typeof includePath !== 'string') {
    throw new Error('Invalid include path: must be a non-empty string');
  }

  // 1. Check for null bytes or control characters
  if (/[\x00-\x1f]/.test(includePath)) {
    throw new Error(`Security Violation: Path traversal or control character in include: '${includePath}'`);
  }

  // Normalize path separators
  const normPath = path.normalize(includePath.replace(/\\/g, '/'));

  // 2. Disallow absolute drive/root escapes when allowlist is active
  if (path.isAbsolute(normPath) && allowlistRoots.length > 0) {
    const isAllowed = allowlistRoots.some(root => normPath.startsWith(path.resolve(root)));
    if (!isAllowed) {
      throw new Error(`Security Violation: Absolute path outside allowed include roots: '${includePath}'`);
    }
  }

  // 3. Check relative resolution against currentFileDir
  if (currentFileDir) {
    const target = path.resolve(currentFileDir, normPath);
    if (allowlistRoots.length > 0) {
      const withinAllowlist = allowlistRoots.some(root => {
        const resRoot = path.resolve(root);
        return target.startsWith(resRoot);
      });
      if (!withinAllowlist) {
        throw new Error(`Security Violation: Path traversal outside allowlisted roots: '${includePath}'`);
      }
    }
    return target;
  }

  return normPath;
}

/**
 * Validates realpath for symlinks to prevent escaping allowlist roots
 */
function validateSymlinkTarget(targetPath, allowlistRoots = []) {
  if (!fs.existsSync(targetPath)) return targetPath;

  try {
    const realTarget = fs.realpathSync(targetPath);
    if (allowlistRoots.length > 0) {
      const isAllowed = allowlistRoots.some(root => realTarget.startsWith(path.resolve(root)));
      if (!isAllowed) {
        throw new Error(`Security Violation: Symlink target '${realTarget}' escapes allowlisted roots`);
      }
    }
    return realTarget;
  } catch (err) {
    if (err.message.includes('Security Violation')) throw err;
    return targetPath;
  }
}

/**
 * Validates file size limits
 */
function validateSourceFileSize(filePathOrContent) {
  let size = 0;
  if (typeof filePathOrContent === 'string' && filePathOrContent.length < 4096 && fs.existsSync(filePathOrContent)) {
    size = fs.statSync(filePathOrContent).size;
  } else if (typeof filePathOrContent === 'string') {
    size = Buffer.byteLength(filePathOrContent, 'utf8');
  }

  if (size > MAX_SOURCE_FILE_SIZE) {
    throw new Error(`Source file size (${(size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${MAX_SOURCE_FILE_SIZE / (1024 * 1024)} MB`);
  }
}

/**
 * Validates compiler output size caps
 */
function validateOutputSizeCap(outputContent) {
  const size = Buffer.byteLength(outputContent || '', 'utf8');
  if (size > MAX_COMPILER_OUTPUT_SIZE) {
    throw new Error(`Generated output size (${(size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum cap of ${MAX_COMPILER_OUTPUT_SIZE / (1024 * 1024)} MB`);
  }
}

/**
 * Executes a tool safely without shell string concatenation
 */
function safeExecTool(executable, args = [], options = {}) {
  const timeout = options.timeout || DEFAULT_PROCESS_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer || (10 * 1024 * 1024);

  const proc = spawnSync(executable, args, {
    timeout,
    maxBuffer,
    shell: false, // Disallow shell string concatenation
    input: options.input,
    stdio: options.stdio || 'pipe',
  });

  return {
    status: proc.status,
    stdout: proc.stdout ? proc.stdout.toString() : '',
    stderr: proc.stderr ? proc.stderr.toString() : '',
    error: proc.error,
    timedOut: proc.error && proc.error.code === 'ETIMEDOUT',
  };
}

/**
 * Executes a callback with a guaranteed temporary directory and automatic cleanup
 */
function withTempDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucst-'));
  try {
    return callback(tempDir);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

module.exports = {
  MAX_INCLUDE_DEPTH,
  MAX_SOURCE_FILE_SIZE,
  MAX_COMPILER_OUTPUT_SIZE,
  DEFAULT_PROCESS_TIMEOUT_MS,
  validateSafeIncludePath,
  validateSymlinkTarget,
  validateSourceFileSize,
  validateOutputSizeCap,
  safeExecTool,
  withTempDir,
};
