'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GUIDS = Object.freeze({
  scene: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  mainPrefab: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  childPrefab: 'cccccccccccccccccccccccccccccccc',
  script: 'dddddddddddddddddddddddddddddddd',
  sampleScene: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  pluginScene: 'ffffffffffffffffffffffffffffffff',
  packageAsset: '1234567890abcdef1234567890abcdef',
});

function createUnityFixture(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-fixture-'));
  const write = (relative, content) => {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return file;
  };
  const meta = guid => `fileFormatVersion: 2\nguid: ${guid}\n`;

  write('ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 6000.0.66f2\n');
  write('ProjectSettings/EditorBuildSettings.asset', [
    'EditorBuildSettings:',
    '  m_Scenes:',
    '  - enabled: 1',
    '    path: Assets/Game/Scenes/Main.unity',
    `    guid: ${GUIDS.scene}`,
    '  - enabled: 0',
    '    path: Assets/Samples/Test.unity',
    `    guid: ${GUIDS.sampleScene}`,
    '  - enabled: 1',
    '    path: Assets/Plugins/Console.unity',
    `    guid: ${GUIDS.pluginScene}`,
    '',
  ].join('\n'));
  write('Packages/manifest.json', JSON.stringify({
    dependencies: {
      'com.unity.addressables': '2.8.1',
      'com.unity.inputsystem': '1.18.0',
    },
  }, null, 2));

  write('Assets/Game/Scenes/Main.unity', [
    '%YAML 1.1',
    '--- !u!1 &1',
    'GameObject:',
    '  m_Name: Main',
    '--- !u!1001 &2',
    'PrefabInstance:',
    `  m_SourcePrefab: {fileID: 100100000, guid: ${GUIDS.mainPrefab.toUpperCase()}, type: 3}`,
    '',
  ].join('\n'));
  write('Assets/Game/Scenes/Main.unity.meta', meta(GUIDS.scene));
  write('Assets/Game/Prefabs/Main.prefab', [
    '%YAML 1.1',
    '--- !u!1 &10',
    'GameObject:',
    '  m_Name: MainPrefab',
    '--- !u!1001 &11',
    'PrefabInstance:',
    `  m_SourcePrefab: {fileID: 100100000, guid: ${GUIDS.childPrefab}, type: 3}`,
    '--- !u!114 &12',
    'MonoBehaviour:',
    `  m_Script: {fileID: 11500000, guid: ${GUIDS.script}, type: 3}`,
    `  m_Config: {fileID: 11400000, guid: ${GUIDS.packageAsset}, type: 2}`,
    '',
  ].join('\n'));
  write('Assets/Game/Prefabs/Main.prefab.meta', meta(GUIDS.mainPrefab));
  write('Assets/Game/Prefabs/Child.prefab', [
    '%YAML 1.1',
    '--- !u!1 &20',
    'GameObject:',
    '  m_Name: ChildPrefab',
    '',
  ].join('\n'));
  write('Assets/Game/Prefabs/Child.prefab.meta', meta(GUIDS.childPrefab.toUpperCase()));
  write('Assets/Game/Scripts/Gameplay.cs', [
    'using DG.Tweening;',
    'public class Gameplay : UnityEngine.MonoBehaviour {',
    '  void Start() { transform.DOMoveX(1f, 1f); }',
    '}',
    '',
  ].join('\n'));
  write('Assets/Game/Scripts/Gameplay.cs.meta', meta(GUIDS.script));

  write('Library/PackageCache/com.unity.addressables@2.8.1/package.json', JSON.stringify({
    name: 'com.unity.addressables', version: '2.8.1',
  }));
  write('Library/PackageCache/com.unity.addressables@2.8.1/Runtime/Config.asset', 'Config:\n  value: 1\n');
  write('Library/PackageCache/com.unity.addressables@2.8.1/Runtime/Config.asset.meta', meta(GUIDS.packageAsset));
  write('Library/PackageCache/com.unity.inputsystem@1.18.0/package.json', JSON.stringify({
    name: 'com.unity.inputsystem', version: '1.18.0',
  }));

  write('Assets/Samples/Test.unity', '%YAML 1.1\n--- !u!1 &30\nGameObject:\n  m_Name: Sample\n');
  write('Assets/Samples/Test.unity.meta', meta(GUIDS.sampleScene));
  write('Assets/Samples/SampleCoroutine.cs', 'class SampleCoroutine { System.Collections.IEnumerator Run() { yield return null; } }\n');
  write('Assets/Plugins/Console.unity', '%YAML 1.1\n--- !u!1 &40\nGameObject:\n  m_Name: Console\n');
  write('Assets/Plugins/Console.unity.meta', meta(GUIDS.pluginScene));
  write('Assets/Editor/OnlyEditor.cs', 'class OnlyEditor {}\n');

  if (testContext && typeof testContext.after === 'function') {
    testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  }
  return { root, assets: path.join(root, 'Assets'), write, GUIDS };
}

module.exports = { GUIDS, createUnityFixture };
