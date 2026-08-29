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
