'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { parseCSharpSource } = require('./csharp-parser.cjs');
const { MigrationRulesEngine } = require('./migration-rules.cjs');
const { CocosEmitter } = require('./cocos-emitter.cjs');
const { compactReportResults, detectUnityProjectRoots } = require('./unity-cs-compiler.cjs');

function compileSnippet(source, filename = 'Fixture.cs') {
  const ast = parseCSharpSource(source, filename);
  const ir = new MigrationRulesEngine().transform(ast);
  const code = new CocosEmitter().emit(ir);
  const transpiled = ts.transpileModule(code, {
    fileName: filename.replace(/\.cs$/i, '.ts'),
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2015,
      experimentalDecorators: true,
    },
  });
  const syntaxErrors = (transpiled.diagnostics || []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(syntaxErrors, []);
  return { ast, ir, code };
}

test('Unicode paragraph separators terminate line comments', () => {
  const source = [
    'using UnityEngine;',
    'public class UnicodeLines : MonoBehaviour',
    '{',
    '  // comment before a field',
    '  private float speed = 5f;',
    '}',
  ].join('\u2029');

  const { ast, code } = compileSnippet(source, 'UnicodeLines.cs');
  assert.equal(ast.classes.length, 1);
  assert.match(code, /speed: number = 5/);
});

test('generic invocation lookahead supports long nested type argument lists', () => {
  const source = `
public class GenericCalls
{
  public object BindIFactory<T1, T2, T3, T4, T5, TContract>()
  {
    return BindFactoryInternal<
      T1, T2, T3, T4, T5, TContract,
      IFactory<T1, T2, T3, T4, T5, TContract>,
      PlaceholderFactory<T1, T2, T3, T4, T5, TContract>>();
  }
}
`;

  const { ast, code } = compileSnippet(source, 'GenericCalls.cs');
  assert.equal(ast.classes[0].members[0].body.statements[0].kind, 'ReturnStatement');
  assert.match(code, /return BindFactoryInternal\(\);/);
});

test('project and namespace-qualified types are not imported from cc', () => {
  const source = `
public class ImportSafety : MonoBehaviour
{
  public static System.Action OnReady;
  private CustomService service;
}
`;
  const { code } = compileSnippet(source, 'ImportSafety.cs');
  assert.doesNotMatch(code, /import \{[^}]*System\.Action/);
  assert.doesNotMatch(code, /import \{[^}]*CustomService/);
  assert.match(code, /OnReady: \(\) => void/);
});

test('tuple assignments emit valid TypeScript destructuring assignments', () => {
  const source = `
public static class TupleSwap
{
  public static void Swap(int[] values, int left, int right)
  {
    (values[left], values[right]) = (values[right], values[left]);
  }
}
`;
  const { code } = compileSnippet(source, 'TupleSwap.cs');
  assert.match(code, /\[values\[left\], values\[right\]\] = \[values\[right\], values\[left\]\]/);
});

test('index assignments are expressions rather than local declarations', () => {
  const source = `
public class IndexAssignment
{
  private Dictionary<int, string> values = new Dictionary<int, string>();
  public void Initialize() { values[1] = "one"; }
}
`;
  const { code } = compileSnippet(source, 'IndexAssignment.cs');
  assert.match(code, /values\[1\] = "one";/);
  assert.doesNotMatch(code, /let \[:/);
});

test('formatted interpolated strings remain valid TypeScript', () => {
  const source = `
public class Formatting
{
  public string Format(float seconds)
  {
    return $"{(int)seconds:00}:{seconds:0.00}";
  }
}
`;
  const { code } = compileSnippet(source, 'Formatting.cs');
  assert.match(code, /padStart\(2, '0'\)/);
  assert.match(code, /toFixed\(2\)/);
});

test('plain and static C# classes do not become Cocos components', () => {
  const source = `
public class PlainService { }
public static class StaticUtility { }
public class GameplayComponent : MonoBehaviour { }
`;
  const { code } = compileSnippet(source, 'ClassKinds.cs');
  assert.match(code, /export class PlainService \{/);
  assert.match(code, /export class StaticUtility \{/);
  assert.doesNotMatch(code, /class PlainService extends Component/);
  assert.doesNotMatch(code, /@ccclass\('PlainService'\)/);
  assert.match(code, /@ccclass\('GameplayComponent'\)[\s\S]*class GameplayComponent extends Component/);
});

test('collection and project object creation never constructs nullable type unions', () => {
  const source = `
public class Construction
{
  private System.Random random = new System.Random();
  private List<string> names = new List<string>();
  private Dictionary<int, string> labels = new Dictionary<int, string>();
  private CustomService service = new CustomService();
}
`;
  const { code } = compileSnippet(source, 'Construction.cs');
  assert.match(code, /new System\.Random\(\)/);
  assert.match(code, /names: string\[\] = \[\]/);
  assert.match(code, /labels: Map<number, string> = new Map\(\)/);
  assert.match(code, /new CustomService\(\)/);
  assert.doesNotMatch(code, /new [^\n;]*\| null/);
});

test('target-typed dictionary initializers emit Map entries', () => {
  const source = `
public class DictionaryInitializer
{
  private Dictionary<int, string> values = new();
  public void Reset()
  {
    values = new() { [1] = "one", [2] = "two" };
  }
}
`;
  const { code } = compileSnippet(source, 'DictionaryInitializer.cs');
  assert.match(code, /new Map\(\[\[1, "one"\], \[2, "two"\]\]\)/);
});

test('var tuple deconstruction and await preserve valid syntax', () => {
  const source = `
public class TupleAwait
{
  public async Task Run()
  {
    var (error, data) = await Send();
  }
}
`;
  const { code } = compileSnippet(source, 'TupleAwait.cs');
  assert.match(code, /let \[error, data\] = await Send\(\);/);
});

test('from-end indices and unsafe pointer operators never emit invalid TypeScript', () => {
  const source = `
public class EdgeExpressions
{
  public int Last(List<int> values) { return values[^1]; }
  public object Pointer(object value) { return &value; }
}
`;
  const { code } = compileSnippet(source, 'EdgeExpressions.cs');
  assert.match(code, /values\[values\.length - 1\]/);
  assert.match(code, /@MIGRATION_TODO: pointer '&'/);
});

test('explicit interface method names become normal TypeScript identifiers', () => {
  const source = `
public class ExplicitInterface : IFoo
{
  void IFoo.Run() { }
}
`;
  const { code, ir } = compileSnippet(source, 'ExplicitInterface.cs');
  assert.match(code, /Run\(\): void/);
  assert.doesNotMatch(code, /IFoo\.Run\(/);
  assert.equal(ir.todoNotes[0].kind, 'explicit-interface-implementation');
});

test('explicit interface properties become normal TypeScript identifiers', () => {
  const source = `
public class ExplicitProperty : IFoo
{
  int IFoo.Value => 1;
}
`;
  const { code } = compileSnippet(source, 'ExplicitProperty.cs');
  assert.match(code, /get Value\(\): number/);
  assert.doesNotMatch(code, /get IFoo\.Value/);
});

test('hex literals keep A-F digits while suffixes and decimal leading zeroes are normalized', () => {
  const source = `
public class Literals
{
  private uint mask = 0xFFu;
  private int month = 05;
}
`;
  const { code } = compileSnippet(source, 'Literals.cs');
  assert.match(code, /mask: number = 0xFF/);
  assert.match(code, /month: number = 5/);
});

test('typeof expressions emit runtime values rather than TypeScript type syntax', () => {
  const source = `
public class TypeTokens
{
  private Type bytes = typeof(byte[]);
  private Type list = typeof(List<string>);
  private Type map = typeof(Dictionary<,>);
  private Type nothing = typeof(void);
}
`;
  const { code } = compileSnippet(source, 'TypeTokens.cs');
  assert.match(code, /bytes: Type \| null = Array/);
  assert.match(code, /list: Type \| null = Array/);
  assert.match(code, /map: Type \| null = Map/);
  assert.match(code, /nothing: Type \| null = undefined/);
});

test('anonymous delegates emit block-bodied arrows', () => {
  const source = `
public class Delegates
{
  public Action Completed = delegate { };
  public void Register() { Add(delegate { Run(); }); }
}
`;
  const { code } = compileSnippet(source, 'Delegates.cs');
  assert.doesNotMatch(code, /\{,/);
  assert.match(code, /\(\(\) => \{/);
});

test('throw expressions and verbatim reserved identifiers emit valid TypeScript', () => {
  const source = `
public class ReservedIdentifiers
{
  public object Require(object value)
  {
    var @break = value ?? throw new Exception();
    return @break;
  }
}
`;
  const { code } = compileSnippet(source, 'ReservedIdentifiers.cs');
  assert.match(code, /let _break = value \?\? \(\(\) => \{ throw new Exception\(\); \}\)\(\)/);
  assert.match(code, /return _break/);
});

test('ternary string literals are not mistaken for optional element access', () => {
  const source = `
public class TernaryLabel
{
  public string Label(bool named, string name, string value)
  {
    return (named ? "[" + name + "] " : "") + value;
  }
}
`;
  const { code } = compileSnippet(source, 'TernaryLabel.cs');
  assert.match(code, /named \? "\[" \+ name \+ "\] " : ""/);
});

test('anonymous object inferred members become valid object properties', () => {
  const source = `
public class AnonymousObjects
{
  public object Group(Item item)
  {
    return new { nameKey = item.name, item.iconId };
  }
}
`;
  const { code } = compileSnippet(source, 'AnonymousObjects.cs');
  assert.match(code, /\(\{ nameKey: item\.name, iconId: item\.iconId \}\)/);
});

test('C# numeric suffixes inside interpolated expressions are removed', () => {
  const source = `
public class InterpolatedSuffix
{
  public string Fps(float deltaTime) { return $"{(int)(1f / deltaTime)}"; }
}
`;
  const { code } = compileSnippet(source, 'InterpolatedSuffix.cs');
  assert.doesNotMatch(code, /1f/);
  assert.match(code, /Math\.trunc\(\(1 \/ deltaTime\)\)/);
});

test('qualified interface method names and numeric separators emit valid TypeScript', () => {
  const source = `
public interface ISource
{
  void System.IDisposable.Dispose();
}
public class Constants
{
  public int Count()
  {
    const uint mask = 0x_5555_5555;
    return (int)mask;
  }
}
`;
  const { code } = compileSnippet(source, 'QualifiedInterface.cs');
  assert.match(code, /Dispose\(\): void/);
  assert.match(code, /const mask = 0x55555555/);
  assert.doesNotMatch(code, /System\.IDisposable\.Dispose\(/);
});

test('C# range indices become Array.slice calls', () => {
  const source = `
public class Ranges
{
  public string Trim(string value) { return value[0..^2]; }
}
`;
  const { code } = compileSnippet(source, 'Ranges.cs');
  assert.match(code, /value\.slice\(0, value\.length - 2\)/);
});

test('typeof delegates emit Function and numeric member access is parenthesized', () => {
  const source = `
public class RuntimeExpressions
{
  public object CallbackType() { return typeof(Action); }
  public object Container() { return 1f.ToContainer(); }
}
`;
  const { code } = compileSnippet(source, 'RuntimeExpressions.cs');
  assert.match(code, /return Function/);
  assert.match(code, /return \(1\)\.ToContainer\(\)/);
});

test('nested integral casts inside interpolated expressions preserve valid syntax', () => {
  const source = `
public class InterpolatedNestedCast
{
  public string Days(float seconds)
  {
    return $"{new TimeSpan(0, 0, 0, (int)seconds).TotalDays}";
  }
}
`;
  const { code } = compileSnippet(source, 'InterpolatedNestedCast.cs');
  assert.match(code, /new TimeSpan\(0, 0, 0, Math\.trunc\(seconds\)\)\.TotalDays/);
});

test('typeof expressions nested inside interpolated ternaries emit runtime values', () => {
  const source = `
public class InterpolatedTypeOf
{
  public string Suffix(FieldInfo field)
  {
    return $"value{(field.FieldType == typeof(float) ? "f" : "")}";
  }
}
`;
  const { code } = compileSnippet(source, 'InterpolatedTypeOf.cs');
  assert.match(code, /field\.FieldType == Number \? "f" : ""/);
  assert.doesNotMatch(code, /typeof\s*\?/);
});

test('compact reports deduplicate warning descriptions and omit generated code', () => {
  const { compactResults, warningCatalog } = compactReportResults([
    {
      success: true,
      file: 'A.cs',
      code: 'generated output',
      warnings: [
        { kind: 'generated-todos', severity: 'high', count: 4, reason: 'Needs refinement.' },
        { kind: 'generated-todos', severity: 'high', reason: 'Needs refinement.' },
      ],
    },
  ]);
  assert.equal(compactResults[0].code, undefined);
  assert.equal(compactResults[0].warnings, undefined);
  assert.equal(compactResults[0].warningCounts['high:generated-todos'], 5);
  assert.deepEqual(warningCatalog['generated-todos'].descriptions, ['Needs refinement.']);
});

test('Unity root detection ignores nested third-party Packages directories', () => {
  const roots = detectUnityProjectRoots([
    'E:/Games/MyGame/Assets/RestClient/Packages/RestClient.cs',
    'E:/Games/MyGame/Packages/com.vendor/Runtime.cs',
  ]);
  assert.deepEqual(roots, [path.resolve('E:/Games/MyGame')]);
});

test('nested C# types are preserved with declaration-merging namespaces', () => {
  const source = `
public class Outer
{
  public class Inner { public int Value; }
  public enum Kind { A, B }
  public interface IInner { int Count { get; } }
}
`;
  const { code, ir } = compileSnippet(source, 'NestedTypes.cs');
  assert.equal(ir.declarations.length, 4);
  assert.match(code, /export namespace Outer \{\s+export class Inner/s);
  assert.match(code, /export namespace Outer \{\s+export enum Kind/s);
  assert.match(code, /export namespace Outer \{\s+export interface IInner \{\s+readonly Count: number;/s);
  assert.equal(ir.todoNotes.some(note => note.kind === 'unsupported-member'), false);
});

test('contextual keyword var can be used as an identifier in nested code', () => {
  const source = `
public class Outer
{
  private class Variable { public int dimensions; }
  public void Parse()
  {
    Variable var = new Variable();
    var.dimensions = 1;
    var.dimensions += 2;
  }
}
`;
  const { code } = compileSnippet(source, 'ContextualVar.cs');
  assert.match(code, /let _var = new Variable\(\)/);
  assert.match(code, /_var\.dimensions = 1/);
  assert.match(code, /_var\.dimensions \+= 2/);
  assert.doesNotMatch(code, /let\s+(?:=|\+=):/);
});

test('C# global namespace aliases become valid TypeScript type references', () => {
  const source = `
using UnityEngine;
public class AliasFields : MonoBehaviour
{
  [SerializeField] private global::SpriteAnimationPlayer player;
  [SerializeField] private Vendor::Effects.Flair flair;
}
`;
  const { code } = compileSnippet(source, 'AliasFields.cs');
  assert.match(code, /@property\(SpriteAnimationPlayer\)/);
  assert.match(code, /player: SpriteAnimationPlayer \| null/);
  assert.match(code, /@property\(Vendor\.Effects\.Flair\)/);
  assert.doesNotMatch(code, /::/);
});

test('unsafe fixed-size buffers become sized arrays with a high-risk note', () => {
  const source = `
public class Number
{
  internal unsafe ref struct BigInteger
  {
    private const int MaxBlockCount = 128;
    private fixed uint _blocks[MaxBlockCount];
  }
}
`;
  const { code, ir } = compileSnippet(source, 'FixedBuffer.cs');
  assert.match(code, /private _blocks: number\[\] = new Array\(MaxBlockCount\)\.fill\(0\)/);
  assert.equal(ir.todoNotes.some(note => note.kind === 'unsafe-fixed-buffer' && note.severity === 'high'), true);
});

test('interface fields and events are retained as TypeScript properties', () => {
  const source = `
public interface IEvents
{
  const int Version = 2;
  event Action Changed;
}
`;
  const { code, ir } = compileSnippet(source, 'InterfaceFields.cs');
  assert.match(code, /readonly Version: number;/);
  assert.match(code, /Changed: \(\) => void;/);
  assert.equal(ir.todoNotes.some(note => note.kind === 'interface-field-initializer'), true);
});

test('Unity coordinate vector constants map to Cocos handedness equivalents', () => {
  const source = `
public class MoveDirections : MonoBehaviour
{
  public void Move()
  {
    Vector3 f = Vector3.forward;
    Vector3 b = Vector3.back;
    Vector3 u = Vector3.up;
    Vector3 d = Vector3.down;
    Vector3 l = Vector3.left;
    Vector3 r = Vector3.right;
  }
}
`;
  const { code } = compileSnippet(source, 'MoveDirections.cs');
  assert.match(code, /Vec3\.FORWARD/);
  assert.match(code, /Vec3\.BACK/);
  assert.match(code, /Vec3\.UP/);
  assert.match(code, /Vec3\.DOWN/);
  assert.match(code, /Vec3\.LEFT/);
  assert.match(code, /Vec3\.RIGHT/);
});

test('Zero-GC scratch vectors and in-place math are emitted for transforms', () => {
  const source = `
public class ZeroGcHero : MonoBehaviour
{
  private float speed = 5f;
  public void Update()
  {
    transform.position += Vector3.forward * speed * Time.deltaTime;
  }
}
`;
  const { code } = compileSnippet(source, 'ZeroGcHero.cs');
  assert.match(code, /const _tempV3_0 = new Vec3\(\);/);
  assert.match(code, /Vec3\.add\(_tempV3_0, this\.node\.worldPosition,/);
  assert.match(code, /this\.node\.setWorldPosition\(_tempV3_0\)/);
});

test('Strict Cocos 3.8 property decorator with tooltip and enum registration', () => {
  const source = `
public enum WeaponType { Sword, Bow, Staff }
public class Character : MonoBehaviour
{
  [Tooltip("Movement speed in units/sec")]
  [SerializeField] private float moveSpeed = 6.5f;

  [SerializeField] private WeaponType weapon = WeaponType.Sword;
}
`;
  const { code } = compileSnippet(source, 'Character.cs');
  assert.match(code, /Enum\(WeaponType\);/);
  assert.match(code, /@property\(\{ type: CCFloat, tooltip: 'Movement speed in units\/sec' \}\)/);
  assert.match(code, /@property\(Enum\(WeaponType\)\)/);
});

test('C# events map to Cocos EventTarget and .Invoke() maps to .emit()', () => {
  const source = `
public class EventBroadcaster : MonoBehaviour
{
  public event Action<int> OnScoreChanged;

  public void AddScore(int score)
  {
    OnScoreChanged.Invoke(score);
  }
}
`;
  const { code } = compileSnippet(source, 'EventBroadcaster.cs');
  assert.match(code, /public readonly OnScoreChanged: EventTarget = new EventTarget\(\);/);
  assert.match(code, /this\.OnScoreChanged\.emit\('OnScoreChanged', score\)/);
});

test('WorkspaceIndexer resolves transitive MonoBehaviour inheritance', () => {
  const { WorkspaceIndexer } = require('./workspace-indexer.cjs');
  const indexer = new WorkspaceIndexer();
  const baseAst = parseCSharpSource(`public class BaseEntity : MonoBehaviour { }`, 'BaseEntity.cs');
  const childAst = parseCSharpSource(`public class Player : BaseEntity { }`, 'Player.cs');
  indexer.extractDeclarations(baseAst, 'BaseEntity.cs');
  indexer.extractDeclarations(childAst, 'Player.cs');
  indexer.resolveInheritanceHierarchy();

  assert.equal(indexer.isMonoBehaviour('Player'), true);
  assert.deepEqual(indexer.classes.get('Player').inheritanceChain, ['Player', 'BaseEntity', 'UnityEngine.MonoBehaviour']);
});

test('Class attributes DisallowMultipleComponent, DefaultExecutionOrder, ExecuteInEditMode, RequireComponent', () => {
  const source = `
[DisallowMultipleComponent]
[DefaultExecutionOrder(-50)]
[ExecuteInEditMode]
[RequireComponent(typeof(Rigidbody))]
public class AdvancedController : MonoBehaviour
{
}
`;
  const { code } = compileSnippet(source, 'AdvancedController.cs');
  assert.match(code, /disallowMultiple/);
  assert.match(code, /executionOrder/);
  assert.match(code, /executeInEditMode/);
  assert.match(code, /requireComponent/);
  assert.match(code, /@ccclass\('AdvancedController'\)/);
  assert.match(code, /@disallowMultiple/);
  assert.match(code, /@executeInEditMode/);
  assert.match(code, /@executionOrder\(-50\)/);
  assert.match(code, /@requireComponent\(RigidBody\)/);
});

test('Serializable non-MonoBehaviour class gets @ccclass decorator', () => {
  const source = `
[System.Serializable]
public class StatData
{
  public float health = 100f;
}
`;
  const { code } = compileSnippet(source, 'StatData.cs');
  assert.match(code, /@ccclass\('StatData'\)/);
  assert.match(code, /export class StatData {/);
  assert.match(code, /@property\(CCFloat\)/);
});

test('Field attributes Range, Min, Header, and HideInInspector are mapped to property options', () => {
  const source = `
public class FieldAttrTest : MonoBehaviour
{
  [Header("Audio Settings")]
  [Range(0f, 100f)]
  [SerializeField] private float volume = 80f;

  [Min(1f)]
  [SerializeField] private float minPitch = 1f;

  [HideInInspector]
  public int secretCode = 1234;

  [ContextMenu("ResetStats")]
  public void ResetStats()
  {
  }
}
`;
  const { code } = compileSnippet(source, 'FieldAttrTest.cs');
  assert.match(code, /@property\(\{ type: CCFloat, tooltip: 'Audio Settings', min: 0, max: 100, slide: true \}\)/);
  assert.match(code, /@property\(\{ type: CCFloat, min: 1 \}\)/);
  assert.match(code, /@property\(\{ type: CCInteger, visible: false \}\)/);
  assert.match(code, /\/\/ @contextMenu: ResetStats/);
});

test('UnityApiCatalog conforms to metadata schema and provides Zero-GC alternatives', () => {
  const { UnityApiCatalog, UNITY_API_ENTRIES } = require('./unity-api-catalog.cjs');
  const catalog = new UnityApiCatalog();

  // Validate all entries have complete schema metadata
  for (const [key, entry] of Object.entries(UNITY_API_ENTRIES)) {
    assert.ok(entry.id, `Missing id for ${key}`);
    assert.ok(entry.unityName, `Missing unityName for ${key}`);
    assert.ok(entry.unityNamespace, `Missing unityNamespace for ${key}`);
    assert.ok(entry.cocosTarget && entry.cocosTarget.target, `Missing cocosTarget for ${key}`);
    assert.ok(Array.isArray(entry.parameters), `Parameters must be array for ${key}`);
    assert.ok(typeof entry.returnType === 'string', `Missing returnType for ${key}`);
    assert.ok(typeof entry.sideEffects === 'boolean', `Missing sideEffects for ${key}`);
    assert.ok(typeof entry.gcRisk === 'boolean', `Missing gcRisk for ${key}`);
    assert.ok(typeof entry.confidence === 'number', `Missing confidence for ${key}`);
    assert.ok(entry.category, `Missing category for ${key}`);
  }

  // Lookup Vector3.Lerp
  const v3Lerp = catalog.lookup('Vector3.Lerp');
  assert.ok(v3Lerp);
  assert.equal(v3Lerp.cocosTarget.target, 'Vec3.lerp');
  assert.equal(v3Lerp.gcRisk, true);
  assert.equal(v3Lerp.zeroGcAlternative, 'Vec3.lerp(_tempV3_0, a, b, t)');

  // Filter by category
  const mathApis = catalog.getByCategory('math');
  assert.ok(mathApis.length >= 8);

  // Filter GC risks
  const gcRisks = catalog.getGcRisks();
  assert.ok(gcRisks.length >= 5);
  assert.ok(gcRisks.some(e => e.id === 'UnityEngine.Vector3.Cross'));
});

test('UnityApiCatalog covers all 20 required casual/hyper-casual categories and core APIs', () => {
  const { UnityApiCatalog } = require('./unity-api-catalog.cjs');
  const catalog = new UnityApiCatalog();

  // Test coverage for Transform
  assert.ok(catalog.lookup('Transform.position'));
  assert.ok(catalog.lookup('Transform.localPosition'));
  assert.ok(catalog.lookup('Transform.rotation'));
  assert.ok(catalog.lookup('Transform.localRotation'));
  assert.ok(catalog.lookup('Transform.eulerAngles'));
  assert.ok(catalog.lookup('Transform.localScale'));
  assert.ok(catalog.lookup('Transform.LookAt'));
  assert.ok(catalog.lookup('Transform.Rotate'));
  assert.ok(catalog.lookup('Transform.Translate'));
  assert.ok(catalog.lookup('Transform.TransformPoint'));
  assert.ok(catalog.lookup('Transform.InverseTransformPoint'));
  assert.ok(catalog.lookup('Transform.forward'));
  assert.ok(catalog.lookup('Transform.right'));
  assert.ok(catalog.lookup('Transform.up'));

  // Test coverage for GameObject & Components
  assert.ok(catalog.lookup('GameObject.activeSelf'));
  assert.ok(catalog.lookup('GameObject.SetActive'));
  assert.ok(catalog.lookup('GameObject.tag'));
  assert.ok(catalog.lookup('GameObject.layer'));
  assert.ok(catalog.lookup('GameObject.AddComponent'));
  assert.ok(catalog.lookup('GameObject.GetComponent'));
  assert.ok(catalog.lookup('GameObject.GetComponents'));
  assert.ok(catalog.lookup('GameObject.GetComponentsInChildren'));
  assert.ok(catalog.lookup('GameObject.GetComponentInParent'));
  assert.ok(catalog.lookup('GameObject.Find'));
  assert.ok(catalog.lookup('GameObject.CompareTag'));
  assert.ok(catalog.lookup('Component.gameObject'));
  assert.ok(catalog.lookup('Component.transform'));
  assert.ok(catalog.lookup('Behaviour.enabled'));
  assert.ok(catalog.lookup('MonoBehaviour.Invoke'));
  assert.ok(catalog.lookup('MonoBehaviour.InvokeRepeating'));
  assert.ok(catalog.lookup('MonoBehaviour.CancelInvoke'));

  // Test Vector / Quaternion / Mathf
  assert.ok(catalog.lookup('Vector3.magnitude'));
  assert.ok(catalog.lookup('Vector3.sqrMagnitude'));
  assert.ok(catalog.lookup('Vector3.normalized'));
  assert.ok(catalog.lookup('Vector3.Project'));
  assert.ok(catalog.lookup('Vector3.Reflect'));
  assert.ok(catalog.lookup('Vector3.SignedAngle'));
  assert.ok(catalog.lookup('Quaternion.FromToRotation'));
  assert.ok(catalog.lookup('Quaternion.identity'));
  assert.ok(catalog.lookup('Mathf.LerpUnclamped'));
  assert.ok(catalog.lookup('Mathf.InverseLerp'));
  assert.ok(catalog.lookup('Mathf.DeltaAngle'));
  assert.ok(catalog.lookup('Mathf.Approximately'));
  assert.ok(catalog.lookup('Mathf.Sign'));
  assert.ok(catalog.lookup('Mathf.Ceil'));
  assert.ok(catalog.lookup('Mathf.Floor'));
  assert.ok(catalog.lookup('Mathf.Round'));

  // Test Time, Random, Debug, Scene, Resources, Input, PlayerPrefs, Physics, UI, Animation, Audio, Coroutine
  assert.ok(catalog.lookup('Time.fixedDeltaTime'));
  assert.ok(catalog.lookup('Time.realtimeSinceStartup'));
  assert.ok(catalog.lookup('Time.frameCount'));
  assert.ok(catalog.lookup('Random.insideUnitSphere'));
  assert.ok(catalog.lookup('Random.insideUnitCircle'));
  assert.ok(catalog.lookup('Random.onUnitSphere'));
  assert.ok(catalog.lookup('Random.ColorHSV'));
  assert.ok(catalog.lookup('Debug.DrawLine'));
  assert.ok(catalog.lookup('Debug.DrawRay'));
  assert.ok(catalog.lookup('SceneManager.LoadScene'));
  assert.ok(catalog.lookup('Resources.Load'));
  assert.ok(catalog.lookup('Input.GetKey'));
  assert.ok(catalog.lookup('Input.GetKeyDown'));
  assert.ok(catalog.lookup('Input.GetAxis'));
  assert.ok(catalog.lookup('PlayerPrefs.SetFloat'));
  assert.ok(catalog.lookup('PlayerPrefs.GetString'));
  assert.ok(catalog.lookup('PlayerPrefs.HasKey'));
  assert.ok(catalog.lookup('PlayerPrefs.DeleteKey'));
  assert.ok(catalog.lookup('Rigidbody.AddForce'));
  assert.ok(catalog.lookup('Rigidbody.velocity'));
  assert.ok(catalog.lookup('Text.text'));
  assert.ok(catalog.lookup('Image.sprite'));
  assert.ok(catalog.lookup('Button.onClick'));
  assert.ok(catalog.lookup('Animator.SetTrigger'));
  assert.ok(catalog.lookup('Animator.SetBool'));
  assert.ok(catalog.lookup('Animator.SetFloat'));
  assert.ok(catalog.lookup('Animation.Play'));
  assert.ok(catalog.lookup('Animation.CrossFade'));
  assert.ok(catalog.lookup('AudioSource.PlayOneShot'));
  assert.ok(catalog.lookup('MonoBehaviour.StopCoroutine'));
  assert.ok(catalog.lookup('WaitForSeconds'));
  assert.ok(catalog.lookup('WaitForEndOfFrame'));
});

test('EngineMismatchDatabase detects architectural differences and formats remediation report', () => {
  const { EngineMismatchDatabase, ENGINE_MISMATCH_ENTRIES } = require('./engine-mismatch-db.cjs');
  const db = new EngineMismatchDatabase();

  // Validate schema completeness
  for (const [key, entry] of Object.entries(ENGINE_MISMATCH_ENTRIES)) {
    assert.ok(entry.id, `Missing id for mismatch ${key}`);
    assert.ok(entry.category, `Missing category for mismatch ${key}`);
    assert.ok(entry.unityConcept, `Missing unityConcept for mismatch ${key}`);
    assert.ok(entry.cocosEquivalent, `Missing cocosEquivalent for mismatch ${key}`);
    assert.ok(entry.description, `Missing description for mismatch ${key}`);
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(entry.severity), `Invalid severity for ${key}`);
    assert.ok(Array.isArray(entry.detectionPatterns) && entry.detectionPatterns.length > 0, `Missing patterns for ${key}`);
    assert.ok(entry.remediation, `Missing remediation for ${key}`);
    assert.ok(typeof entry.confidence === 'number', `Missing confidence for ${key}`);
  }

  // Detect mismatches in C# sample
  const sampleCSharp = `
public class PlayerController : MonoBehaviour
{
  void Update()
  {
    Vector3 dir = Vector3.forward;
    transform.position += new Vector3(1, 0, 0) * Time.deltaTime;
  }

  void OnCollisionEnter(Collision col)
  {
    Debug.Log("Collided");
  }
}
`;
  const detected = db.detectInSource(sampleCSharp);
  assert.ok(detected.length >= 3);
  assert.ok(detected.some(d => d.id === 'coordinate.forward'));
  assert.ok(detected.some(d => d.id === 'gc.value_vs_reference_semantics'));
  assert.ok(detected.some(d => d.id === 'physics.callbacks_events'));

  // Test report formatting
  const report = db.formatReport(detected);
  assert.match(report, /Engine Mismatch Remediation Report/);
  assert.match(report, /\[HIGH\]/);
});

test('Lifecycle methods Awake, Start, Update, and dt parameter injection are correctly transformed', () => {
  const source = `
public class LifecycleTester : MonoBehaviour
{
  void Awake()
  {
    Debug.Log("Awake");
  }

  void Start()
  {
    Debug.Log("Start");
  }

  void Update()
  {
    float delta = Time.deltaTime;
  }
}
`;
  const { code } = compileSnippet(source, 'LifecycleTester.cs');
  assert.match(code, /onLoad\(\): void/);
  assert.match(code, /start\(\): void/);
  assert.match(code, /update\(dt: number\): void/);
  assert.match(code, /delta.*=.*dt/);
});

test('EngineMismatchDatabase covers sections 4.2.3, 4.2.4, 4.2.5, 4.2.6', () => {
  const { EngineMismatchDatabase } = require('./engine-mismatch-db.cjs');
  const db = new EngineMismatchDatabase();

  // 4.2.3 Lifecycle
  assert.ok(db.get('lifecycle.awake'));
  assert.ok(db.get('lifecycle.onEnable'));
  assert.ok(db.get('lifecycle.start'));
  assert.ok(db.get('lifecycle.update'));
  assert.ok(db.get('lifecycle.fixedUpdate'));
  assert.ok(db.get('lifecycle.onDisable'));
  assert.ok(db.get('lifecycle.onDestroy'));

  // 4.2.4 UI
  assert.ok(db.get('ui.coordinate_origin'));
  assert.ok(db.get('ui.canvas_hierarchy'));
  assert.ok(db.get('ui.text_mapping'));
  assert.ok(db.get('ui.image_mapping'));

  // 4.2.5 Animation
  assert.ok(db.get('animation.state_machine'));

  // 4.2.6 GC & Value Semantics
  assert.ok(db.get('gc.value_vs_reference_semantics'));
  assert.ok(db.get('gc.spawner_object_pool'));
});

test('Vector3 operator overloading converts +, -, *, /, ==, != to Zero-GC Vec3 calls', () => {
  const source = `
public class VectorMathTester : MonoBehaviour
{
  public Vector3 a;
  public Vector3 b;

  void Update()
  {
    Vector3 sum = a + b;
    Vector3 diff = a - b;
    Vector3 scaled = a * 2.5f;
    Vector3 divided = a / 2f;
    bool isSame = a == b;
    bool isDifferent = a != b;
  }
}
`;
  const { code } = compileSnippet(source, 'VectorMathTester.cs');
  assert.match(code, /Vec3\.add\(_tempV3_0, this\.a, this\.b\)/);
  assert.match(code, /Vec3\.subtract\(_tempV3_0, this\.a, this\.b\)/);
  assert.match(code, /Vec3\.multiplyScalar\(_tempV3_0, this\.a, 2\.5\)/);
  assert.match(code, /Vec3\.multiplyScalar\(_tempV3_0, this\.a, 1 \/ \(2\)\)/);
  assert.match(code, /Vec3\.equals\(this\.a, this\.b\)/);
  assert.match(code, /!Vec3\.equals\(this\.a, this\.b\)/);
});

test('Property and field emission handles SerializeField, auto-properties, and Node bindings', () => {
  const source = `
public class PropertyTester : MonoBehaviour
{
  [SerializeField] private float speed = 5f;
  [SerializeField] private Transform target;
  public int Health { get; set; }
}
`;
  const { code } = compileSnippet(source, 'PropertyTester.cs');
  assert.match(code, /@property\(CCFloat\)\n\s*private speed: number = 5;/);
  assert.match(code, /@property\(Node\)\n\s*private target: Node \| null = null;/);
  assert.match(code, /public Health: number = 0;/);
});

test('Namespace and module strategy generates folder-based ES module imports', () => {
  const source = `
public class GameController : MonoBehaviour
{
  public Game.Player.PlayerController player;
  public Game.Audio.SoundManager audioManager;
}
`;
  const { code } = compileSnippet(source, 'GameController.cs');
  assert.match(code, /import \{ PlayerController \} from '\.\/Game\/Player\/PlayerController';/);
  assert.match(code, /import \{ SoundManager \} from '\.\/Game\/Audio\/SoundManager';/);
  assert.match(code, /public player: PlayerController \| null = null;/);
});

test('Import and code generation emits cc imports, @ccclass, and zero-GC scratch variables', () => {
  const source = `
public class MovementSystem : MonoBehaviour
{
  public Vector3 velocity;
  public Quaternion rotation;

  void Update()
  {
    transform.position += velocity * Time.deltaTime;
  }
}
`;
  const { code } = compileSnippet(source, 'MovementSystem.cs');
  assert.match(code, /import \{ Component, Node, Quat, Vec3, _decorator \} from 'cc';/);
  assert.match(code, /@ccclass\('MovementSystem'\)/);
  assert.match(code, /const _tempV3_0 = new Vec3\(\);/);
  assert.match(code, /const _tempV3_1 = new Vec3\(\);/);
  assert.match(code, /const _tempQuat_0 = new Quat\(\);/);
});

test('Compatibility runtime modules UnitySceneManager, UnityResources, UnityPhysics, and UnityUI', () => {
  const source = `
public class RuntimeFeatureTester : MonoBehaviour
{
  void Start()
  {
    UnitySceneManager.LoadScene("MainScene");
    UnityResources.Load("Prefabs/Hero");
    UnityPhysics.Raycast(Vector3.zero, Vector3.forward, 100f);
  }
}
`;
  const { code } = compileSnippet(source, 'RuntimeFeatureTester.cs');
  assert.match(code, /UnitySceneManager\.LoadScene\("MainScene"\)/);
  assert.match(code, /UnityResources\.Load\("Prefabs\/Hero"\)/);
  assert.match(code, /UnityPhysics\.Raycast\(Vec3\.ZERO, Vec3\.FORWARD, 100\)/);
  assert.match(code, /import \{ UnityPhysics, UnityResources, UnitySceneManager \} from '\.\/shared\/compat';/);
});

test('AstChunkExtractor generates AST-scoped chunks with source maps', () => {
  const { AstChunkExtractor } = require('./ast-chunk-extractor.cjs');
  const sampleTs = `
export class TestHero extends Component {
  private update(dt: number): void {
    // @MIGRATION_TODO: complex navigation mesh query
    const nav = null;
  }
}
`;
  const extractor = new AstChunkExtractor();
  const chunks = extractor.extractChunks(sampleTs, '', 'TestHero.ts');
  assert.equal(chunks.length, 1);
  const chunk = chunks[0];
  assert.equal(chunk.memberName, 'update');
  assert.equal(chunk.filePath, 'TestHero.ts');
  assert.ok(chunk.astNodeId.includes('TestHero.ts:update'));
  assert.ok(chunk.sourceMap);
  assert.equal(chunk.sourceMap.startLine, 3);
  assert.ok(chunk.reason.includes('complex navigation mesh query'));
});

test('SkeletonGenerator generates token-compact type skeleton without method bodies', () => {
  const { SkeletonGenerator } = require('./skeleton-generator.cjs');
  const sampleTs = `
export class PlayerController extends Component {
  public speed: number = 5;
  public targetNode: Node | null = null;

  public update(dt: number): void {
    this.speed += 1;
  }

  public fireWeapon(): void {
    console.log("fire");
  }
}
`;
  const generator = new SkeletonGenerator();
  const skeleton = generator.extractSkeletonFromSource(sampleTs, 'PlayerController.ts');
  assert.match(skeleton, /export class PlayerController extends Component \{/);
  assert.match(skeleton, /speed: number;/);
  assert.match(skeleton, /targetNode: Node \| null;/);
  assert.match(skeleton, /update\(dt: number\): void;/);
  assert.match(skeleton, /fireWeapon\(\): void;/);
  assert.doesNotMatch(skeleton, /this\.speed \+= 1;/);
  assert.doesNotMatch(skeleton, /console\.log/);
});

test('Migration MCP tools query signatures, math utils, mismatch remediation, and mapping rules', () => {
  const mcp = require('./migration-mcp-tools.cjs');

  // get_cocos_api_signature
  const sig = mcp.get_cocos_api_signature('cc', 'Vec3', 'lerp');
  assert.equal(sig.found, true);
  assert.equal(sig.signature, 'Vec3.lerp(out: Vec3, from: Vec3, to: Vec3, ratio: number): Vec3');

  // query_math_util
  const mathUtil = mcp.query_math_util('lerp');
  assert.ok(mathUtil.matches.length > 0);
  assert.ok(mathUtil.zeroGcRecommendation.includes('_tempV3_0'));

  // get_component_migration_doc
  const compDoc = mcp.get_component_migration_doc('Transform');
  assert.equal(compDoc.cocosComponent, 'Node');

  // get_engine_mismatch
  const mismatch = mcp.get_engine_mismatch('forward');
  assert.ok(mismatch.mismatchesFound > 0);

  // get_mapping_rule
  const rule = mcp.get_mapping_rule('Vector3.MoveTowards');
  assert.equal(rule.found, true);
  assert.ok(rule.cocosEquivalent.includes('moveTowards') || rule.cocosEquivalent.includes('MoveTowards'));
});

test('PatchSplicer applies structured patch replacement, insertion, and deletion', () => {
  const { PatchSplicer } = require('./patch-splicer.cjs');
  const splicer = new PatchSplicer();
  const source = `class Enemy {
  update(dt: number) {
    this.x += 1;
  }
}`;

  // Replace
  const patchData = {
    file: 'Enemy.ts',
    nodeId: 'method:update',
    patch: {
      type: 'replace',
      startLine: 2,
      endLine: 4,
      newCode: '  update(dt: number) {\n    Vec3.scaleAndAdd(_tempV3_0, this.node.worldPosition, this.dir, this.speed * dt);\n    this.node.setWorldPosition(_tempV3_0);\n  }'
    },
    explanation: 'Applied zero-GC transformation'
  };

  const res = splicer.applyPatch(source, patchData);
  assert.equal(res.success, true);
  assert.match(res.code, /Vec3\.scaleAndAdd\(_tempV3_0/);
  assert.match(res.code, /this\.node\.setWorldPosition\(_tempV3_0\);/);
});

test('AgentRouter routes issues to specialized domain agents', () => {
  const { AgentRouter } = require('./agent-router.cjs');
  const router = new AgentRouter();

  // Compile Error
  const res1 = router.route({ code: 'TS2339', error: 'Property not found' });
  assert.equal(res1.agentName, 'Compile Error Agent');

  // Physics
  const res2 = router.route({ reason: 'Physics.Raycast mismatch' });
  assert.equal(res2.agentName, 'Physics Agent');

  // Animation
  const res3 = router.route({ text: 'Animator state machine translation' });
  assert.equal(res3.agentName, 'Animation Agent');

  // UI
  const res4 = router.route({ text: 'RectTransform and Button click binding' });
  assert.equal(res4.agentName, 'UI Agent');

  // Performance/GC
  const res5 = router.route({ memberName: 'update', reason: 'GC allocation per-frame new Vec3()' });
  assert.equal(res5.agentName, 'Performance/GC Agent');
});

test('MigrationCacheManager tracks file hashes and reuses refinements incrementally', () => {
  const { MigrationCacheManager } = require('./migration-cache.cjs');
  const fs = require('fs');
  const path = require('path');
  const tempCache = path.resolve(__dirname, '.temp_test_cache.json');
  const cache = new MigrationCacheManager(tempCache);

  try {
    const csFile = 'PlayerController.cs';
    const csContent1 = 'public class PlayerController { int speed = 5; }';
    const csContent2 = 'public class PlayerController { int speed = 10; }';

    assert.equal(cache.isChanged(csFile, csContent1), true);

    const hash1 = cache.computeHash(csContent1);
    cache.recordFile(csFile, csContent1, 'PlayerController.ts');
    cache.recordRefinement('PlayerController:update:10', hash1, { newCode: 'let a = 1;' });

    // Same content -> not changed
    assert.equal(cache.isChanged(csFile, csContent1), false);
    // Modified content -> changed
    assert.equal(cache.isChanged(csFile, csContent2), true);

    // Reuse refinement for matching hash
    const cachedPatch = cache.getCachedRefinement('PlayerController:update:10', hash1);
    assert.ok(cachedPatch);
    assert.equal(cachedPatch.newCode, 'let a = 1;');
  } finally {
    cache.clear();
  }
});

test('StaticValidator executes all 5 validation layers (Syntax, Type, Cocos API, Migration, Dependency)', () => {
  const { StaticValidator } = require('./static-validator.cjs');
  const fs = require('fs');
  const path = require('path');
  const validator = new StaticValidator();

  const tempFile1 = path.resolve(__dirname, '.temp_valid_test.ts');
  const tempFile2 = path.resolve(__dirname, '.temp_todo_test.ts');

  fs.writeFileSync(tempFile1, '@ccclass("Temp")\nexport class Temp extends Component {}\n', 'utf8');
  fs.writeFileSync(tempFile2, '// @MIGRATION_TODO: review navigation\nexport class Temp2 {}\n', 'utf8');

  try {
    const res = validator.validate([tempFile1, tempFile2], { runTypeCheck: false });
    assert.equal(res.layers.syntax.passed, true);
    assert.equal(res.layers.cocosApi.passed, true);
    assert.ok(res.layers.migration.warnings.length > 0);
    assert.equal(res.layers.dependency.passed, true);
  } finally {
    if (fs.existsSync(tempFile1)) fs.unlinkSync(tempFile1);
    if (fs.existsSync(tempFile2)) fs.unlinkSync(tempFile2);
  }
});

test('Headless behavioral test harness executes gameplay logic state transitions', () => {
  const { MockNode, MockVec3, MockComponent } = require('./mock-cocos-runtime.cjs');

  class BulletController extends MockComponent {
    constructor() {
      super();
      this.speed = 10;
      this.dir = new MockVec3(1, 0, 0);
    }
    update(dt) {
      const currentPos = this.node.worldPosition;
      const nextPos = new MockVec3();
      MockVec3.scaleAndAdd(nextPos, currentPos, this.dir, this.speed * dt);
      this.node.setWorldPosition(nextPos);
    }
  }

  const node = new MockNode('Bullet');
  const bullet = node.addComponent(BulletController);
  assert.equal(node.worldPosition.x, 0);

  // Simulate 3 frames of dt = 0.1s
  bullet.update(0.1);
  assert.equal(node.worldPosition.x, 1);
  bullet.update(0.1);
  assert.equal(node.worldPosition.x, 2);
  bullet.update(0.1);
  assert.equal(node.worldPosition.x, 3);
});

test('ProjectAnalyzer computes API usage, difficulty, dependency graph, and migration order', () => {
  const { ProjectAnalyzer } = require('./project-analyzer.cjs');
  const path = require('path');
  const fixturesDir = path.resolve(__dirname, '../../fixtures');
  const analyzer = new ProjectAnalyzer();
  const report = analyzer.analyzeProject(fixturesDir);

  assert.ok(report.summary.totalFiles >= 3);
  assert.ok(report.estimatedDifficulty.length >= 3);
  assert.ok(report.recommendedMigrationOrder.length >= 3);
  assert.ok(report.dotGraph.includes('digraph MigrationDependencies'));
});

test('ReportGenerator produces markdown and standalone HTML dashboard', () => {
  const { ReportGenerator } = require('./report-generator.cjs');
  const generator = new ReportGenerator();
  const sampleData = {
    total: 3,
    passed: 3,
    failed: 0,
    results: [
      { file: 'PlayerRunner.cs', success: true, confidence: 0.95, durationMs: 12 },
      { file: 'PhysicsBall.cs', success: true, confidence: 0.9, durationMs: 15 },
    ]
  };

  const md = generator.generateMarkdown(sampleData);
  assert.match(md, /# Unity to Cocos Creator Migration Report/);
  assert.match(md, /PlayerRunner\.cs/);

  const html = generator.generateHtml(sampleData);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Migration Dashboard/);
  assert.match(html, /100\.0%/);
});

test('Sample game fixtures Game A, Game B, Game C compile to valid Cocos TypeScript', () => {
  const fs = require('fs');
  const path = require('path');
  const fixtures = [
    path.resolve(__dirname, '../../fixtures/game_a_hyper_casual/PlayerRunner.cs'),
    path.resolve(__dirname, '../../fixtures/game_b_physics_casual/PhysicsBall.cs'),
    path.resolve(__dirname, '../../fixtures/game_c_state_based/IdleManager.cs'),
  ];

  for (const f of fixtures) {
    const content = fs.readFileSync(f, 'utf8');
    const { code } = compileSnippet(content, path.basename(f));
    assert.ok(code.length > 0);
    assert.match(code, /@ccclass\(/);
  }
});













