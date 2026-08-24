'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  analyzeCSharpSource,
  analyzeAsmdefSource,
  buildScriptIndex,
} = require('./script-index.cjs');

const GUIDS = {
  playerA: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  playerB: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  board: 'cccccccccccccccccccccccccccccccc',
  editor: 'dddddddddddddddddddddddddddddddd',
};

test('analyzeCSharpSource emits compact evidence and ignores strings/comments/BCL names', () => {
  const source = [
    '// FakeType should not become evidence',
    'public partial class PlayerController : MonoBehaviour {',
    '  private BoardState state;',
    '  private string label = "StringOnlyType";',
    '}',
    'public record struct MoveResult(int Score);',
  ].join('\n');
  const evidence = analyzeCSharpSource(source);

  assert.deepEqual(evidence.declaredTypes, ['MoveResult', 'PlayerController']);
  assert.deepEqual(evidence.identifierCandidates, ['BoardState', 'MoveResult', 'PlayerController', 'Score']);
  assert.equal(Object.prototype.hasOwnProperty.call(evidence, 'text'), false);
  assert.equal(JSON.stringify(evidence).includes('StringOnlyType'), false);
  assert.equal(JSON.stringify(evidence).includes('FakeType'), false);
});

test('buildScriptIndex supports cached evidence, partial declarations and deterministic references', () => {
  const boardEvidence = analyzeCSharpSource('public class BoardState {}');
  const records = [
    {
      assetPath: 'Assets/Game/Player/PlayerB.cs', guid: GUIDS.playerB, scope: 'runtime',
      scriptEvidence: analyzeCSharpSource('public partial class PlayerController { BoardState board; }'),
    },
    {
      assetPath: 'Assets/Game/BoardState.cs', guid: GUIDS.board, scope: 'runtime',
      scriptEvidence: boardEvidence,
    },
    {
      assetPath: 'Assets/Game/Player/PlayerA.cs', guid: GUIDS.playerA, scope: 'runtime',
      text: 'public partial class PlayerController { BoardState Current; }',
    },
  ];

  const forward = buildScriptIndex(records);
  const index = buildScriptIndex([...records].reverse());
  assert.deepEqual(index, forward);
  assert.deepEqual(index.guidToScript, {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'Assets/Game/Player/PlayerA.cs',
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: 'Assets/Game/Player/PlayerB.cs',
    cccccccccccccccccccccccccccccccc: 'Assets/Game/BoardState.cs',
  });
  assert.deepEqual(index.typeDeclarations, {
    BoardState: ['Assets/Game/BoardState.cs'],
    PlayerController: ['Assets/Game/Player/PlayerA.cs', 'Assets/Game/Player/PlayerB.cs'],
  });
  const player = index.scripts.find(script => script.assetPath.endsWith('PlayerA.cs'));
  assert.deepEqual(player.declaredTypes, ['PlayerController']);
  assert.deepEqual(player.referencedProjectTypes, ['BoardState', 'PlayerController']);
  assert.equal(player.assembly, 'Assembly-CSharp');
  assert.equal(JSON.stringify(index).includes('Current'), false);
});

test('nearest asmdef wins and default Editor assembly remains detectable', () => {
  const records = [
    {
      assetPath: 'Assets/Game/Game.asmdef',
      assemblyEvidence: analyzeAsmdefSource('{"name":"Puzzle.Game"}', 'Assets/Game/Game.asmdef'),
    },
    {
      assetPath: 'Assets/Game/Feature/Feature.asmdef',
      text: '{"name":"Puzzle.Feature","includePlatforms":["Editor"]}',
    },
    { assetPath: 'Assets/Game/Core.cs', text: 'class Core {}', guid: '1'.repeat(32) },
    { assetPath: 'Assets/Game/Feature/Tool.cs', text: 'class Tool {}', guid: '2'.repeat(32) },
    { assetPath: 'Assets/Editor/LooseTool.cs', text: 'class LooseTool {}', guid: GUIDS.editor },
    { assetPath: 'Assets/Loose.cs', text: 'class Loose {}', guid: '3'.repeat(32) },
  ];

  const index = buildScriptIndex(records);
  const byPath = Object.fromEntries(index.scripts.map(script => [script.assetPath, script]));
  assert.deepEqual(
    { assembly: byPath['Assets/Game/Core.cs'].assembly, definition: byPath['Assets/Game/Core.cs'].assemblyDefinition },
    { assembly: 'Puzzle.Game', definition: 'Assets/Game/Game.asmdef' },
  );
  assert.deepEqual(
    {
      assembly: byPath['Assets/Game/Feature/Tool.cs'].assembly,
      definition: byPath['Assets/Game/Feature/Tool.cs'].assemblyDefinition,
      editorOnly: byPath['Assets/Game/Feature/Tool.cs'].editorOnly,
    },
    { assembly: 'Puzzle.Feature', definition: 'Assets/Game/Feature/Feature.asmdef', editorOnly: true },
  );
  assert.equal(byPath['Assets/Editor/LooseTool.cs'].assembly, 'Assembly-CSharp-Editor');
  assert.equal(byPath['Assets/Loose.cs'].assembly, 'Assembly-CSharp');
});

test('invalid asmdef and duplicate script GUIDs are deterministic diagnostics', () => {
  const duplicate = 'f'.repeat(32);
  const index = buildScriptIndex([
    { assetPath: 'Assets/B/B.cs', text: 'class B {}', guid: duplicate },
    { assetPath: 'Assets/A/A.cs', text: 'class A {}', guid: duplicate.toUpperCase() },
    { assetPath: 'Assets/Game/Broken.asmdef', text: '{broken' },
    { assetPath: 'Assets/Game/C.cs', text: 'class C {}', guid: '0'.repeat(32) },
  ]);

  assert.equal(index.guidToScript[duplicate], 'Assets/A/A.cs');
  assert.deepEqual(
    index.diagnostics.map(item => item.code),
    ['UNITY_ASMDEF_INVALID_JSON', 'UNITY_DUPLICATE_SCRIPT_GUID'],
  );
  assert.equal(index.scripts.find(script => script.assetPath.endsWith('/C.cs')).assembly, 'Broken');
});
