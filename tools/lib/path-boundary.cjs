'use strict';

const fs = require('fs');
const path = require('path');

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function createPathBoundary(root) {
  const resolvedRoot = path.resolve(root);
  const realRoot = fs.realpathSync.native(resolvedRoot);
  return { resolvedRoot, realRoot };
}

function inspectContainedPath(boundary, candidate) {
  try {
    const resolvedPath = path.resolve(candidate);
    if (!isPathInside(boundary.resolvedRoot, resolvedPath)) return null;

    const stat = fs.lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) return null;

    const realPath = fs.realpathSync.native(resolvedPath);
    if (!isPathInside(boundary.realRoot, realPath)) return null;

    return { resolvedPath, realPath, stat };
  } catch {
    return null;
  }
}

module.exports = {
  createPathBoundary,
  inspectContainedPath,
  isPathInside,
};
