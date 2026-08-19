'use strict';

/**
 * Unity Include Resolver & Virtual Package Map v2
 * for Unity HLSL/ShaderLab -> Cocos Creator 3.8.8 Transpiler
 *
 * Implements:
 * - Search paths from Assets, Packages, Library/PackageCache, --include-root, and UCST_INCLUDE_PATH
 * - Built-in Unity include virtual package map (compat/unity, compat/urp, compat/shadergraph)
 * - Include guard detection and single-inclusion caching to avoid duplicate declarations
 * - In-Memory Virtual File System (VFS)
 */

const fs = require('fs');
const path = require('path');
const { VIRTUAL_PACKAGE_MAP } = require('./compat/index.cjs');
const { validateSafeIncludePath, validateSymlinkTarget, MAX_INCLUDE_DEPTH } = require('./security-hardening.cjs');

class UnityIncludeResolver {
  constructor(options = {}) {
    this.searchRoots = [];
    this.vfs = new Map(); // In-Memory Virtual File System
    this.includedGuards = new Set(); // Include guard cache per translation unit

    // 1. Add configured search roots
    if (options.searchRoots) {
      for (const root of options.searchRoots) {
        this.addSearchRoot(root);
      }
    }

    // 2. Add UCST_INCLUDE_PATH environment variable if present
    const envPaths = process.env.UCST_INCLUDE_PATH;
    if (envPaths) {
      const sep = process.platform === 'win32' ? ';' : ':';
      for (const p of envPaths.split(sep)) {
        if (p.trim()) this.addSearchRoot(p.trim());
      }
    }
  }

  addSearchRoot(dir) {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!this.searchRoots.includes(resolved)) {
      this.searchRoots.push(resolved);

      // Also automatically discover Packages/ and Library/PackageCache if root is a Unity Project folder
      const pkgDir = path.join(resolved, 'Packages');
      if (fs.existsSync(pkgDir) && !this.searchRoots.includes(pkgDir)) {
        this.searchRoots.push(pkgDir);
      }
      const pkgCacheDir = path.join(resolved, 'Library', 'PackageCache');
      if (fs.existsSync(pkgCacheDir) && !this.searchRoots.includes(pkgCacheDir)) {
        this.searchRoots.push(pkgCacheDir);
      }
      const assetsDir = path.join(resolved, 'Assets');
      if (fs.existsSync(assetsDir) && !this.searchRoots.includes(assetsDir)) {
        this.searchRoots.push(assetsDir);
      }
    }
  }

  registerVirtualFile(virtualPath, content) {
    const norm = virtualPath.replace(/\\/g, '/').toLowerCase();
    this.vfs.set(norm, content);
  }

  getVirtualFile(virtualPath) {
    const norm = virtualPath.replace(/\\/g, '/').toLowerCase();
    return this.vfs.get(norm) || null;
  }

  resetGuards() {
    this.includedGuards.clear();
  }

  resolveInclude(includePath, currentFileDir, depth = 0) {
    if (depth > MAX_INCLUDE_DEPTH) {
      throw new Error(`Maximum include recursion depth (${MAX_INCLUDE_DEPTH}) exceeded on: '${includePath}'`);
    }

    const normPath = includePath.replace(/\\/g, '/');
    const normKey = normPath.toLowerCase();

    // 0. Check Virtual File System first
    if (this.vfs.has(normKey)) {
      return { path: `vfs:${normPath}`, content: this.vfs.get(normKey), isBuiltin: false, isVfs: true };
    }

    // 1. Check Virtual Package Map
    if (VIRTUAL_PACKAGE_MAP[normKey]) {
      return {
        path: `builtin:${normPath}`,
        content: VIRTUAL_PACKAGE_MAP[normKey],
        isBuiltin: true,
      };
    }

    // Also match basename in virtual package map (e.g. "UnityCG.cginc" from any relative path)
    const baseKey = path.basename(normKey);
    if (VIRTUAL_PACKAGE_MAP[baseKey]) {
      return {
        path: `builtin:${baseKey}`,
        content: VIRTUAL_PACKAGE_MAP[baseKey],
        isBuiltin: true,
      };
    }

    // Validate path against allowlisted roots if searchRoots configured
    if (this.searchRoots.length > 0) {
      try {
        validateSafeIncludePath(includePath, this.searchRoots, currentFileDir);
      } catch (err) {
        // Return null if path escapes allowed roots
        return null;
      }
    }

    // 2. Search locally relative to current file
    if (currentFileDir) {
      const candidate = path.resolve(currentFileDir, includePath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const safePath = validateSymlinkTarget(candidate, this.searchRoots);
        const content = fs.readFileSync(safePath, 'utf8');
        return { path: safePath, content, isBuiltin: false };
      }
    }

    // 3. Search in configured roots (Assets, Packages, Library/PackageCache, etc.)
    for (const root of this.searchRoots) {
      // Direct join
      const candidate1 = path.resolve(root, includePath);
      if (fs.existsSync(candidate1) && fs.statSync(candidate1).isFile()) {
        return { path: candidate1, content: fs.readFileSync(candidate1, 'utf8'), isBuiltin: false };
      }

      // Try stripping "Packages/com.unity.render-pipelines.universal/" or similar package prefix
      const strippedPackage = includePath.replace(/^Packages\/([^\/]+)\//i, '');
      const candidate2 = path.resolve(root, strippedPackage);
      if (fs.existsSync(candidate2) && fs.statSync(candidate2).isFile()) {
        return { path: candidate2, content: fs.readFileSync(candidate2, 'utf8'), isBuiltin: false };
      }

      // Try searching inside package folders in Library/PackageCache
      if (root.includes('PackageCache') && fs.existsSync(root)) {
        try {
          const pkgEntries = fs.readdirSync(root, { withFileTypes: true });
          for (const pkg of pkgEntries) {
            if (pkg.isDirectory()) {
              const candidatePkg = path.resolve(root, pkg.name, strippedPackage);
              if (fs.existsSync(candidatePkg) && fs.statSync(candidatePkg).isFile()) {
                return { path: candidatePkg, content: fs.readFileSync(candidatePkg, 'utf8'), isBuiltin: false };
              }
            }
          }
        } catch (_) {}
      }
    }

    // Fallback: return dummy shim to prevent compiler crash
    return {
      path: `unresolved:${includePath}`,
      content: `// Unresolved include: ${includePath}\n`,
      isBuiltin: true,
      unresolved: true,
    };
  }
}

module.exports = {
  UnityIncludeResolver,
};
