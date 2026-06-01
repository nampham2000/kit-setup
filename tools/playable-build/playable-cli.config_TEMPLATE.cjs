'use strict';

/**
 * Centralized configuration for playable-shared-kit/tools/playable-build.cjs.
 * Keep this file dependency-free (no fs reads) so it can be required safely.
 */

// Default Cocos Creator discovery locations by platform.
// The CLI will use these when neither --cocos nor env COCOS_CREATOR/COCOS_PATH are set.
const COCOS_DEFAULTS = {
  win32: {
    versionBaseDir: 'C:/ProgramData/cocos/editors/Creator',
    versionExecutable: 'CocosCreator.exe',
    fallbackPaths: [
      'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe',
    ],
  },
  darwin: {
    versionBaseDir: '/Applications/CocosCreator',
    // This is relative to each version folder under versionBaseDir.
    versionExecutable: 'CocosCreator.app/Contents/MacOS/CocosCreator',
    fallbackPaths: [
      '/Applications/CocosCreator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator',
    ],
  },
  linux: {
    fallbackPaths: [
      '/opt/CocosCreator/CocosCreator',
      '/usr/local/bin/CocosCreator',
    ],
  },
};

const INSTALL_DIRS = [
  '.',
  'extensions/particles-converter',
  'extensions/super-html',
];

// Only these ad platform folders are kept after export.
// "common" is always retained automatically.
const RETAINED_AD_PLATFORMS = [
  'applovin',
  'google',
  'facebook',
  'mintegral',
  'unity',
];

const SUBTREE_DEFAULTS = {
  prefix: 'assets/script/playable_core',
  remote: 'https://github.com/minhdangphamthe/cc_playable_core.git',
  branch: 'release/v001',
  squash: true,
};

// Build concurrency + runtime defaults
const DEFAULT_MEM_PER_JOB_GB = 2.5;
const DEFAULT_MEM_HEADROOM_GB = 1.5;
const MIN_AUTO_FREE_MEM_GB = 1.0;

const UV_THREADPOOL_AUTO = -1;
const PRIORITY_CHOICES = ['low', 'normal', 'high'];

module.exports = {
  RETAINED_AD_PLATFORMS,
  INSTALL_DIRS,
  SUBTREE_DEFAULTS,

  DEFAULT_MEM_PER_JOB_GB,
  DEFAULT_MEM_HEADROOM_GB,
  MIN_AUTO_FREE_MEM_GB,

  UV_THREADPOOL_AUTO,
  PRIORITY_CHOICES,

  COCOS_DEFAULTS,
};
