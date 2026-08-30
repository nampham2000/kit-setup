'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { detectBlockerIds, aggregateBlockers, diagnosticsFromBlockers } = require('./diagnostics.cjs');

test('pointer APIs become a high completion obligation instead of an easy-to-miss note', () => {
  const first = detectBlockerIds('Assets/Game/HoldController.cs', `
    class HoldController {
      void Update() { if (Input.GetMouseButton(0)) Hold(); }
    }
  `);
  const second = detectBlockerIds('Assets/Game/RotateController.cs', `
    class RotateController : IDragHandler {
      public void OnDrag(PointerEventData e) { Rotate(e.delta); }
    }
  `);
  assert.ok(first.includes('pointer-input-flow'));
  assert.ok(second.includes('pointer-input-flow'));
  const diagnostics = diagnosticsFromBlockers(aggregateBlockers([
    { assetPath: 'Assets/Game/HoldController.cs', blockerIds: first },
    { assetPath: 'Assets/Game/RotateController.cs', blockerIds: second },
  ]));
  const input = diagnostics.find(item => item.code === 'UNITY_POINTER_INPUT_FLOW');
  assert.equal(input.severity, 'high');
  assert.equal(input.count, 2);
  assert.match(input.action, /responsibility graph/);
});

test('non-input C# does not create a pointer-flow obligation', () => {
  assert.equal(detectBlockerIds('Assets/Game/Score.cs', 'class Score { int value; }').includes('pointer-input-flow'), false);
});
