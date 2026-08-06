#!/usr/bin/env node
'use strict';

// Thin CLI wrapper: dọn TOÀN BỘ unused assets trong Cocos project hiện tại.
// Delegate sang unused-prefab-cleanup.cjs với --scope all và chặn override.

const path = require('path');
const { spawnSync } = require('child_process');

const HELP = `
Cocos Unused Asset Cleanup (all assets)

Usage:
  node playable-shared-kit/tools/unused-asset-cleanup.cjs [options]

Options:
  --project-root <path>  Cocos project root. Default: auto-detect from cwd.
  --prefab-dir <path>    Prefab folder khi audit. Default: assets/prefabs.
  --scene <path>         Runtime scene root. Repeatable. Default: all *.scene.
  --root <path>          Extra runtime asset root. Repeatable.
  --delete               Xóa asset và .meta không dùng (mặc định chỉ audit).
  --json                 In báo cáo JSON đầy đủ.
  --help, -h             Show help.

Examples:
  node playable-shared-kit/tools/unused-asset-cleanup.cjs
  node playable-shared-kit/tools/unused-asset-cleanup.cjs --json
  node playable-shared-kit/tools/unused-asset-cleanup.cjs --delete
`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  if (args.includes('--scope')) {
    console.error('[unused-asset-cleanup] ERROR: --scope không được hỗ trợ. Tool này luôn dùng scope=all.');
    process.exit(1);
  }

  const target = path.join(__dirname, 'unused-prefab-cleanup.cjs');
  const result = spawnSync(process.execPath, [target, '--scope', 'all', ...args], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

main();
