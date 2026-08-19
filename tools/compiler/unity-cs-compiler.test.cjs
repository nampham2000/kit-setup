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
