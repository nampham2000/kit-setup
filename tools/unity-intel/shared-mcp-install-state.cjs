'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The shared kit's own live scanner. Evidence gates only trust this pair;
// another Unity MCP in the project (Unity AI Assistant, community servers) is
// never a substitute because it cannot answer playable-port-scan.
const SCANNER_PACKAGE = 'com.ccplayable.unity-intelligence';
const UPSTREAM_PACKAGE = 'com.ivanmurzak.unity.mcp';
const THIRD_PARTY_MCP_PACKAGES = [
  'com.unity.ai.assistant',
  'com.coplaydev.unity-mcp',
  'com.justinpbarnett.unity-mcp',
  'com.gamelovers.mcp-unity',
];

function readManifestDependencies(projectRoot) {
  const file = path.join(projectRoot, 'Packages', 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    return manifest && typeof manifest.dependencies === 'object' && manifest.dependencies ? manifest.dependencies : {};
  } catch {
    return null;
  }
}

/**
 * Manifest-level view of the shared Unity MCP. `installed` only means the
 * packages are declared; import/compile/readiness still needs doctor/setup.
 */
function sharedUnityMcpInstallState(projectRoot) {
  const dependencies = readManifestDependencies(projectRoot);
  if (!dependencies) {
    return { manifestReadable: false, installed: false, scannerDeclared: false, upstreamDeclared: false, thirdPartyMcp: [] };
  }
  const scannerDeclared = Object.prototype.hasOwnProperty.call(dependencies, SCANNER_PACKAGE);
  const upstreamDeclared = Object.prototype.hasOwnProperty.call(dependencies, UPSTREAM_PACKAGE);
  return {
    manifestReadable: true,
    installed: scannerDeclared && upstreamDeclared,
    scannerDeclared,
    upstreamDeclared,
    thirdPartyMcp: THIRD_PARTY_MCP_PACKAGES.filter(name => Object.prototype.hasOwnProperty.call(dependencies, name)),
  };
}

// Commands that may install the shared scanner on their own. The user
// assigned the port, so a missing scanner is set up first rather than letting
// the agent fall back to static evidence or a third-party MCP.
function shouldAutoBootstrap(options, state) {
  if (!state || !state.manifestReadable || state.installed) return false;
  if (options.noBootstrap || options.bootstrap) return false;
  if (options.provider === 'static') return false;
  return options.command === 'preflight' || options.command === 'scan';
}

module.exports = {
  SCANNER_PACKAGE,
  UPSTREAM_PACKAGE,
  THIRD_PARTY_MCP_PACKAGES,
  sharedUnityMcpInstallState,
  shouldAutoBootstrap,
};
