'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const vscode = require('vscode');

const COCOS_MCP_PORT = 3000;
const WAIT_FOR_COCOS_MS = 60000;
const STARTUP_DELAY_MS = 1200;
const COCOS_MONITOR_INTERVAL_MS = 3000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function waitForPort(port, host, timeoutMilliseconds) {
  const expiresAt = Date.now() + timeoutMilliseconds;

  do {
    if (await canConnect(port, host)) {
      return true;
    }
    await delay(1000);
  } while (Date.now() < expiresAt);

  return false;
}

function findWorkspaceConfigIndex() {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.findIndex((folder) => {
    const configFile = path.join(folder.uri.fsPath, '.vscode', 'mcp.json');
    return folder.name.toLowerCase() === 'cocos_game' && fs.existsSync(configFile);
  });
}

async function startServer(output, id) {
  try {
    await vscode.commands.executeCommand('workbench.mcp.startServer', id, {
      autoTrustChanges: true
    });
    output.appendLine(`Started ${id}.`);
  } catch (error) {
    output.appendLine(`Failed to start ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function startCocosMcpMonitor(context, output, id, initialAvailable) {
  let wasAvailable = initialAvailable;
  let checkInFlight = false;

  const checkAndStart = async () => {
    if (checkInFlight) {
      return;
    }

    checkInFlight = true;
    try {
      const isAvailable = await canConnect(COCOS_MCP_PORT, '127.0.0.1');
      if (isAvailable && !wasAvailable) {
        output.appendLine(`Detected localhost:${COCOS_MCP_PORT}; starting ${id}.`);
        await startServer(output, id);
      } else if (!isAvailable && wasAvailable) {
        output.appendLine(`localhost:${COCOS_MCP_PORT} is unavailable; waiting for Cocos MCP to return.`);
      }
      wasAvailable = isAvailable;
    } catch (error) {
      output.appendLine(`Cocos MCP monitor failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      checkInFlight = false;
    }
  };

  const interval = setInterval(() => {
    checkAndStart();
  }, COCOS_MONITOR_INTERVAL_MS);

  context.subscriptions.push({
    dispose: () => clearInterval(interval)
  });

  checkAndStart();
}

async function activate(context) {
  const workspaceIndex = findWorkspaceConfigIndex();
  if (workspaceIndex < 0) {
    return;
  }

  const output = vscode.window.createOutputChannel('Cocos Game MCP Autostart', { log: true });
  context.subscriptions.push(output);

  const prefix = `mcp.config.ws${workspaceIndex}.`;
  const cocosMcpId = `${prefix}cocos-mcp`;
  output.appendLine('Starting workspace MCP servers.');
  await delay(STARTUP_DELAY_MS);

  await Promise.all([
    startServer(output, `${prefix}blender-mcp`),
    startServer(output, `${prefix}gimp-mcp`)
  ]);

  const cocosAvailableAtStartup = await waitForPort(COCOS_MCP_PORT, '127.0.0.1', WAIT_FOR_COCOS_MS);
  if (cocosAvailableAtStartup) {
    await startServer(output, cocosMcpId);
  } else {
    output.appendLine(`Skipped ${cocosMcpId}: localhost:${COCOS_MCP_PORT} was not available within ${WAIT_FOR_COCOS_MS / 1000}s.`);
  }

  output.appendLine(`Monitoring localhost:${COCOS_MCP_PORT} for Cocos MCP restarts.`);
  startCocosMcpMonitor(context, output, cocosMcpId, cocosAvailableAtStartup);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
