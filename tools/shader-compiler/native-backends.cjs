'use strict';

/**
 * Native Shader Compiler Adapters (DXC, SPIRV-Cross, spirv-val)
 * for UCShaderTranspiler
 *
 * Checks tool availability and wraps external toolchains behind clean interfaces.
 */

const { safeExecTool } = require('./security-hardening.cjs');

function checkTool(executable, args = ['--version']) {
  try {
    const res = safeExecTool(executable, args, { timeout: 3000 });
    return res.status === 0 || (res.stdout && res.stdout.length > 0) || (res.stderr && !res.error);
  } catch (err) {
    return false;
  }
}

function probeNativeBackends() {
  const dxcAvailable = checkTool('dxc', ['--version']) || checkTool('dxc', ['-?']);
  const spirvCrossAvailable = checkTool('spirv-cross', ['--version']) || checkTool('spirv-cross', ['--help']);
  const spirvValAvailable = checkTool('spirv-val', ['--version']);

  return {
    dxc: {
      available: dxcAvailable,
      name: 'DirectXShaderCompiler (DXC)',
    },
    spirvCross: {
      available: spirvCrossAvailable,
      name: 'SPIRV-Cross',
    },
    spirvVal: {
      available: spirvValAvailable,
      name: 'spirv-val (SPIRV-Tools)',
    },
    fallbackEngine: {
      available: true,
      name: 'Pure Node.js AST Lowering Engine (Built-in)',
    },
  };
}

module.exports = {
  probeNativeBackends,
};
