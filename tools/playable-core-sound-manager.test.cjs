'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadSoundManager() {
  const filename = path.resolve(__dirname, '../packages/playable-core/SoundManager.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      experimentalDecorators: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;

  const tweenCalls = [];
  const stoppedTweenTargets = [];

  class MockNode {
    constructor(name = 'Node') {
      this.name = name;
      this.parent = null;
      this.destroyed = false;
    }

    addComponent(Type) {
      const component = new Type();
      component.node = this;
      return component;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  class MockComponent {
    constructor() {
      this.node = new MockNode('ComponentNode');
    }
  }

  class MockAudioClip {
    addRef() {}
    decRef() {}
  }

  class MockAudioSource {
    constructor() {
      this.clip = null;
      this.loop = false;
      this.playOnAwake = false;
      this.volume = 1;
      this.currentTime = 0;
      this.playing = false;
      this.playCount = 0;
      this.stopCount = 0;
      this.node = null;
    }

    play() {
      this.playing = true;
      this.playCount++;
    }

    stop() {
      this.playing = false;
      this.currentTime = 0;
      this.stopCount++;
    }

    pause() {
      this.playing = false;
    }

    playOneShot() {}
  }

  class MockTween {
    static stopAllByTarget(target) {
      stoppedTweenTargets.push(target);
    }
  }

  function mockTween(target) {
    const call = { target, duration: 0, props: null, started: false };
    return {
      to(duration, props) {
        call.duration = duration;
        call.props = props;
        return this;
      },
      start() {
        call.started = true;
        tweenCalls.push(call);
        return this;
      },
    };
  }

  const scene = new MockNode('Scene');
  const ccMock = {
    _decorator: { ccclass: () => (Target) => Target },
    Component: MockComponent,
    AudioClip: MockAudioClip,
    AudioSource: MockAudioSource,
    Node: MockNode,
    director: {
      getScene: () => scene,
      addPersistRootNode: () => undefined,
    },
    tween: mockTween,
    Tween: MockTween,
  };

  const compiledModule = new Module(filename, module);
  compiledModule.filename = filename;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalLoad = Module._load;
  Module._load = function loadMock(request, parent, isMain) {
    if (request === 'cc') return ccMock;
    if (request === './utils/GameUtils') {
      return { GameUtils: { loadAsset: async () => null } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    compiledModule._compile(output, filename);
  } finally {
    Module._load = originalLoad;
  }

  return {
    SoundManager: compiledModule.exports.SoundManager,
    MockAudioClip,
    tweenCalls,
    stoppedTweenTargets,
  };
}

test('preloaded BGM starts synchronously with source-backed fade and unlock resume is idempotent', () => {
  const { SoundManager, MockAudioClip, tweenCalls, stoppedTweenTargets } = loadSoundManager();
  const manager = new SoundManager();
  manager.onLoad();
  manager.setBGMVolume(0.6);

  const clip = new MockAudioClip();
  manager._audioCache.set('audio/bgm', clip);
  manager.playBGM('audio/bgm', true, 1);

  const source = manager._bgmAudioSource;
  assert.equal(source.clip, clip);
  assert.equal(source.playCount, 1, 'cache hit must play synchronously in the unlock gesture');
  assert.equal(source.volume, 0, 'fade-in must start at zero');
  assert.equal(tweenCalls.length, 1);
  assert.equal(tweenCalls[0].duration, 1);
  assert.equal(tweenCalls[0].props.volume, 0.6);

  source.currentTime = 7.25;
  manager.playBGM('audio/bgm', true, 1);
  manager.resumeBGM();
  assert.equal(source.playCount, 1, 'active BGM must not restart on later unlock gestures');
  assert.equal(source.currentTime, 7.25);

  source.playing = false;
  manager.resumeBGM();
  assert.equal(source.playCount, 2, 'paused BGM may resume once');
  assert.ok(stoppedTweenTargets.includes(source), 'fade ownership must be cancellable by later controls');
});
