'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lineRendererContract, cocosLinePositions } = require('./line-renderer-binding');
const { parseUnityRendererDoc } = require('./particle-system-converter');

// Hovl "Laser beam 1": two points, width 0.3, green gradient, View alignment, Stretch UVs.
const yaml = `LineRenderer:
  m_Positions:
  - {x: 0, y: 0, z: 0}
  - {x: 0, y: 0, z: 1}
  m_Parameters:
    serializedVersion: 3
    widthMultiplier: 0.3
    widthCurve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 1
      - serializedVersion: 3
        time: 1
        value: 0.5
    colorGradient:
      serializedVersion: 2
      key0: {r: 0.2688679, g: 1, b: 0.2688679, a: 1}
      key1: {r: 0, g: 1, b: 0, a: 0.5}
      ctime0: 0
      ctime1: 65535
      atime0: 0
      atime1: 65535
      m_NumColorKeys: 2
      m_NumAlphaKeys: 2
    numCornerVertices: 0
    numCapVertices: 0
    alignment: 0
    textureMode: 0
  m_UseWorldSpace: 1
  m_Loop: 0
`;

test('LineRenderer YAML becomes the strip runtime contract with Cocos-space points', () => {
  const parsed = parseUnityRendererDoc(yaml);
  const line = parsed.LineRenderer || parsed;
  const contract = lineRendererContract(line);
  assert.equal(contract.widthMultiplier, 0.3);
  assert.deepEqual(contract.widthKeys, [{ time: 0, value: 1 }, { time: 1, value: 0.5 }]);
  assert.deepEqual(contract.colorKeys, [{ time: 0, r: 0.2688679, g: 1, b: 0.2688679 }, { time: 1, r: 0, g: 1, b: 0 }]);
  assert.deepEqual(contract.alphaKeys, [{ time: 0, a: 1 }, { time: 1, a: 0.5 }]);
  assert.deepEqual([contract.alignment, contract.textureMode, contract.useWorldSpace, contract.loop], [0, 0, true, false]);
  assert.deepEqual(cocosLinePositions(line), [{ __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }, { __type__: 'cc.Vec3', x: 0, y: 0, z: -1 }]);
});
