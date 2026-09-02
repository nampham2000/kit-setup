'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scaffoldCSharpToTypeScript } = require('./script-scaffolder.js');

test('expression-bodied C# properties are not misread as serialized fields', () => {
  const source = `
public class GameManager : MonoBehaviour
{
  [SerializeField] private float speed = 4.5f;
  public bool IsPlaying => CurGameState == GameState.Playing;
}
`;
  const result = scaffoldCSharpToTypeScript(source);

  assert.equal(result.fieldCount, 1);
  assert.match(result.tsCode, /public speed: number = 4\.5;/);
  assert.doesNotMatch(result.tsCode, /IsPlaying/);
  assert.doesNotMatch(result.tsCode, /=\s*>/);
});

test('numeric arrays and lists use Cocos numeric serialization decorators', () => {
  const source = `
using System.Collections.Generic;
public class TapeLevel : MonoBehaviour
{
  public int[] levelColorIndexes;
  [SerializeField] private List<int> colorNumList;
  public float[] weights;
  [SerializeField] private List<double> thresholds;
}
`;
  const result = scaffoldCSharpToTypeScript(source);

  assert.equal(result.fieldCount, 4);
  assert.equal((result.tsCode.match(/@property\(\[CCInteger\]\)/g) || []).length, 2);
  assert.equal((result.tsCode.match(/@property\(\[CCFloat\]\)/g) || []).length, 2);
  assert.doesNotMatch(result.tsCode, /\[Number\]/);
});

test('generated scripts import shared Components and services from concrete modules', () => {
  const result = scaffoldCSharpToTypeScript('public class PortedGame : MonoBehaviour {}');

  assert.match(result.tsCode, /from 'playable-core\/GameManager'/);
  assert.match(result.tsCode, /from 'playable-core\/config\/PlayableConfigManager'/);
  assert.match(result.tsCode, /from 'playable-sdk\/platform\/SuperHtmlPlayable'/);
  assert.doesNotMatch(result.tsCode, /from 'playable-core';/);
  assert.doesNotMatch(result.tsCode, /from 'playable-sdk';/);
});
