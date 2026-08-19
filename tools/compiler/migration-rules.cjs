'use strict';

/**
 * Migration Rules Engine for Unity C# to Cocos Creator 3.8.8 TypeScript
 *
 * Implements high-fidelity AST-to-IR transforms, Unity API rewrites,
 * Zero-GC scratch vector optimizations, and confidence scoring.
 */

const { SemanticResolver } = require('./semantic-resolver.cjs');
const { IRCompilationUnit, IRClass, IRField, IRProperty, IRMethod, IREnum, IRInterface, IRTypeAlias } = require('./migration-ir.cjs');

const TYPESCRIPT_RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'implements', 'interface', 'let',
  'package', 'private', 'protected', 'public', 'static', 'await',
]);

const NESTED_TYPE_KINDS = new Set([
  'ClassDeclaration',
  'StructDeclaration',
  'EnumDeclaration',
  'InterfaceDeclaration',
  'DelegateDeclaration',
]);

function sanitizeIdentifier(name) {
  const value = String(name || '_');
  return TYPESCRIPT_RESERVED_WORDS.has(value) ? `_${value}` : value;
}

function splitInterpolationFormat(value) {
  let depth = 0;
  let hasTernary = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === '?') hasTernary = true;
    else if (depth === 0 && ch === ':' && !hasTernary) {
      return { expression: value.slice(0, i).trim(), format: value.slice(i + 1).trim() };
    }
  }
  return { expression: value.trim(), format: '' };
}

function normalizeInterpolationExpression(value) {
  const runtimeType = typeName => {
    const normalized = typeName.replace(/\s+/g, '');
    if (/^(?:s?byte|u?short|u?int|u?long|float|double|decimal)$/.test(normalized)) return 'Number';
    if (normalized === 'bool') return 'Boolean';
    if (normalized === 'string' || normalized === 'char') return 'String';
    if (normalized === 'void') return 'undefined';
    if (normalized.endsWith('[]')) return 'Array';
    if (/^(?:Action|Func)(?:<.*>)?$/.test(normalized)) return 'Function';
    if (/^(?:List|IList|IReadOnlyList|IEnumerable|ICollection)<.*>$/.test(normalized)) return 'Array';
    if (/^(?:Dictionary|IDictionary)<.*>$/.test(normalized)) return 'Map';
    if (/^(?:HashSet|ISet)<.*>$/.test(normalized)) return 'Set';
    return normalized.replace(/<.*>$/, '');
  };

  const trimmed = value
    .trim()
    // Do this before cast normalization: `(float)` in `typeof(float)` is a
    // type operand, not a numeric cast.
    .replace(/\btypeof\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*<[^()]*>)?(?:\s*\[\s*\])?)\s*\)/g,
      (_match, typeName) => runtimeType(typeName))
    // Primitive casts can appear anywhere inside an interpolation expression,
    // for example `new TimeSpan(0, (int)seconds)`. Keep integral truncation
    // semantics for the common identifier/member/index operand shape.
    .replace(/(?<![\w$])\((?:s?byte|u?short|u?int|u?long)\)\s*([A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[[^\]]+\]))*)/g,
      (_match, operand) => `Math.trunc(${operand})`)
    .replace(/(?<![\w$])\((?:float|double|decimal)\)\s*/g, '')
    .replace(/\b(\d[\d_]*(?:\.\d[\d_]*)?)(?:[fFdDmM])\b/g, '$1')
    .replace(/\b(\d[\d_]*)(?:[uUlL]+)\b/g, '$1');
  const cast = trimmed.match(/^\((?:s?byte|u?short|u?int|u?long)\)\s*(.+)$/s);
  return cast ? `Math.trunc(${cast[1]})` : trimmed;
}

function transformInterpolatedString(value) {
  const openBrace = '\u0000OPEN_BRACE\u0000';
  const closeBrace = '\u0000CLOSE_BRACE\u0000';
  const escaped = value
    .replace(/`/g, '\\`')
    .replace(/\{\{/g, openBrace)
    .replace(/\}\}/g, closeBrace);
  const transformed = escaped.replace(/\{([^{}]+)\}/g, (_match, placeholder) => {
    const { expression: rawExpression, format } = splitInterpolationFormat(placeholder);
    const expression = normalizeInterpolationExpression(rawExpression);
    if (/^0+$/.test(format)) {
      return `\${String(Math.trunc(Number(${expression}))).padStart(${format.length}, '0')}`;
    }
    if (/^0\.0+$/.test(format)) {
      return `\${Number(${expression}).toFixed(${format.length - 2})}`;
    }
    if (format) return `\${String(${expression})}`;
    return `\${${expression}}`;
  });
  return `\`${transformed.replaceAll(openBrace, '{').replaceAll(closeBrace, '}')}\``;
}

class MigrationRulesEngine {
  constructor() {
    this.resolver = new SemanticResolver();
  }

  transform(compilationUnitAst) {
    const irUnit = new IRCompilationUnit(compilationUnitAst.filename);
    irUnit.rawComments = compilationUnitAst.comments || [];

    // Always import ccclass, property, Component, _decorator from 'cc'
    irUnit.addImport('cc', '_decorator');
    irUnit.addImport('cc', 'Component');
    irUnit.addImport('cc', 'Node');

    // Register all classes in the compilation unit
    for (const cls of compilationUnitAst.classes || []) {
      this.resolver.registerCustomClass(cls.name);
    }
    for (const ns of compilationUnitAst.namespaces || []) {
      for (const cls of ns.classes || []) {
        this.resolver.registerCustomClass(cls.name);
      }
    }

    // Process top-level and namespaced declarations
    const allClasses = [...(compilationUnitAst.classes || [])];
    const allStructs = [...(compilationUnitAst.structs || [])];
    const allEnums = [...(compilationUnitAst.enums || [])];
    const allInterfaces = [...(compilationUnitAst.interfaces || [])];
    const allDelegates = [...(compilationUnitAst.delegates || [])];

    for (const ns of compilationUnitAst.namespaces || []) {
      if (ns.classes) allClasses.push(...ns.classes);
      if (ns.structs) allStructs.push(...ns.structs);
      if (ns.enums) allEnums.push(...ns.enums);
      if (ns.interfaces) allInterfaces.push(...ns.interfaces);
      if (ns.delegates) allDelegates.push(...ns.delegates);
    }

    // Transform Enums
    for (const enumAst of allEnums) {
      const irEnum = this.transformEnum(enumAst);
      irUnit.declarations.push(irEnum);
    }

    // Transform Interfaces
    for (const ifaceAst of allInterfaces) {
      const irIface = this.transformInterface(ifaceAst, irUnit);
      irUnit.declarations.push(irIface);
    }

    for (const delegateAst of allDelegates) {
      irUnit.declarations.push(this.transformDelegate(delegateAst, irUnit));
    }

    for (const structAst of allStructs) {
      const irStruct = this.transformClass(structAst, irUnit);
      irStruct.baseClass = '';
      irStruct.isCCClass = false;
      irUnit.declarations.push(irStruct);
      irUnit.todoNotes.push({
        kind: 'struct-value-semantics',
        symbol: structAst.name,
        reason: 'C# struct was emitted as a TypeScript class; copy/value semantics require review.',
      });
    }

    // Transform Classes
    for (const classAst of allClasses) {
      const irClass = this.transformClass(classAst, irUnit);
      irUnit.declarations.push(irClass);
    }

    // TypeScript has no class-nested type declarations. Preserve C# nested
    // types with declaration-merging namespaces (`Outer.Inner`) so their AST,
    // members, and qualified identity survive for the AI refinement pass.
    for (const declaration of [...allEnums, ...allInterfaces, ...allStructs, ...allClasses]) {
      this.transformNestedDeclarations(declaration, [sanitizeIdentifier(declaration.name)], irUnit);
    }

    return irUnit;
  }

  transformNestedDeclarations(containerAst, namespacePath, irUnit) {
    for (const member of containerAst.members || []) {
      if (!NESTED_TYPE_KINDS.has(member.kind)) continue;
      let nestedIr;
      if (member.kind === 'EnumDeclaration') {
        nestedIr = this.transformEnum(member);
      } else if (member.kind === 'InterfaceDeclaration') {
        nestedIr = this.transformInterface(member, irUnit);
      } else if (member.kind === 'DelegateDeclaration') {
        nestedIr = this.transformDelegate(member, irUnit);
      } else {
        nestedIr = this.transformClass(member, irUnit);
        if (member.kind === 'StructDeclaration') {
          nestedIr.baseClass = '';
          nestedIr.isCCClass = false;
          irUnit.todoNotes.push({
            kind: 'struct-value-semantics',
            symbol: [...namespacePath, member.name].join('.'),
            reason: 'C# struct was emitted as a TypeScript class; copy/value semantics require review.',
          });
        }
      }
      nestedIr.namespacePath = namespacePath;
      irUnit.declarations.push(nestedIr);
      this.transformNestedDeclarations(
        member,
        [...namespacePath, sanitizeIdentifier(member.name)],
        irUnit
      );
    }
  }

  transformEnum(enumAst) {
    const irEnum = new IREnum(enumAst.name);
    for (let i = 0; i < enumAst.members.length; i++) {
      const m = enumAst.members[i];
      let val = i;
      if (m.value && m.value.value !== undefined) {
        val = m.value.value;
      }
      irEnum.members.push({ name: sanitizeIdentifier(m.name), value: val });
    }
    return irEnum;
  }

  transformInterface(ifaceAst, irUnit) {
    const irIface = new IRInterface(ifaceAst.name);
    for (const member of ifaceAst.members || []) {
      if (member.kind === 'MethodDeclaration') {
        const resolvedRet = this.resolver.resolveType(member.returnType);
        if (resolvedRet.import) irUnit.addImport('cc', resolvedRet.import);
        const params = (member.parameters || []).map(p => {
          const pType = this.resolver.resolveType(p.type);
          if (pType.import) irUnit.addImport('cc', pType.import);
          return { name: sanitizeIdentifier(p.name), type: pType.ts };
        });
        let methodName = member.name;
        if (methodName.includes('.')) {
          irUnit.todoNotes.push({
            kind: 'explicit-interface-implementation',
            symbol: methodName,
            reason: 'Qualified C# interface member was emitted with its final identifier only.',
          });
          methodName = methodName.split('.').pop();
        }
        irIface.methods.push({ name: sanitizeIdentifier(methodName), returnType: resolvedRet.ts, parameters: params });
      } else if (member.kind === 'PropertyDeclaration') {
        const resolvedType = this.resolver.resolveType(member.type);
        if (resolvedType.import) irUnit.addImport('cc', resolvedType.import);
        let propertyName = member.name;
        if (propertyName.includes('.')) propertyName = propertyName.split('.').pop();
        const accessors = member.accessors || [];
        irIface.properties.push({
          name: sanitizeIdentifier(propertyName),
          type: resolvedType.ts,
          readonly: accessors.length > 0 && !accessors.some(accessor => accessor.name === 'set'),
        });
      } else if (member.kind === 'FieldDeclaration') {
        const resolvedType = this.resolver.resolveType(member.type);
        if (resolvedType.import) irUnit.addImport('cc', resolvedType.import);
        for (const declaration of member.declarations || []) {
          irIface.properties.push({
            name: sanitizeIdentifier(declaration.name),
            type: resolvedType.ts,
            readonly: member.modifiers.includes('readonly') || member.modifiers.includes('const'),
          });
          if (declaration.initializer) {
            irUnit.todoNotes.push({
              kind: 'interface-field-initializer',
              symbol: `${ifaceAst.name}.${declaration.name}`,
              reason: 'TypeScript interfaces cannot preserve a C# field initializer; review the implementing/static value.',
            });
          }
        }
      }
    }
    return irIface;
  }

  transformDelegate(delegateAst, irUnit) {
    const alias = new IRTypeAlias(sanitizeIdentifier(delegateAst.name));
    alias.genericParams = (delegateAst.genericParams || []).map(param => sanitizeIdentifier(param.name));
    alias.parameters = (delegateAst.parameters || []).map(param => {
      const type = this.resolver.resolveType(param.type);
      if (type.import) irUnit.addImport('cc', type.import);
      return { name: sanitizeIdentifier(param.name), type: type.ts };
    });
    const returnType = this.resolver.resolveType(delegateAst.returnType);
    if (returnType.import) irUnit.addImport('cc', returnType.import);
    alias.returnType = returnType.ts;
    return alias;
  }

  transformClass(classAst, irUnit) {
    const irClass = new IRClass(sanitizeIdentifier(classAst.name));
    irClass.isStatic = classAst.modifiers.includes('static');

    // Base class resolution
    let hasMonoBehaviour = false;
    if (classAst.baseTypes && classAst.baseTypes.length > 0) {
      const firstBase = classAst.baseTypes[0].name;
      if (firstBase === 'MonoBehaviour') {
        irClass.baseClass = 'Component';
        hasMonoBehaviour = true;
      } else if (firstBase) {
        irClass.baseClass = firstBase;
      }
    } else {
      irClass.baseClass = '';
    }
    irClass.isCCClass = hasMonoBehaviour;
    if (irClass.isStatic) {
      irClass.baseClass = '';
      irClass.isCCClass = false;
    }

    // Members (Fields, Properties, Methods)
    for (const member of classAst.members || []) {
      if (member.kind === 'FieldDeclaration') {
        this.transformField(member, irClass, irUnit);
      } else if (member.kind === 'PropertyDeclaration') {
        this.transformProperty(member, irClass, irUnit);
      } else if (member.kind === 'MethodDeclaration') {
        this.transformMethod(member, irClass, irUnit, hasMonoBehaviour);
      } else if (member.kind === 'ConstructorDeclaration') {
        this.transformConstructor(member, irClass, irUnit);
      } else if (NESTED_TYPE_KINDS.has(member.kind)) {
        // Emitted separately under a declaration-merging namespace by
        // transformNestedDeclarations().
      } else {
        irUnit.todoNotes.push({
          kind: 'unsupported-member',
          symbol: `${classAst.name}.${member.name || member.kind}`,
          memberKind: member.kind,
          reason: `C# member kind '${member.kind}' requires manual migration.`,
        });
      }
    }

    return irClass;
  }

  transformField(fieldAst, irClass, irUnit) {
    const resolvedType = this.resolver.resolveType(fieldAst.type);
    if (resolvedType.import) irUnit.addImport('cc', resolvedType.import);

    const isSerialized = fieldAst.attributes.some(a =>
      a.name === 'SerializeField' || a.name === 'UnityEngine.SerializeField' || a.name === 'Header' || a.name === 'Range' || a.name === 'Tooltip'
    );
    const isPublic = fieldAst.modifiers.includes('public');
    const isStatic = fieldAst.modifiers.includes('static');
    const isReadonly = fieldAst.modifiers.includes('readonly') || fieldAst.modifiers.includes('const');
    let fixedBufferInitializer = '';
    if (fieldAst.fixedSize) {
      const size = this.transformExpression(fieldAst.fixedSize, irUnit);
      const elementType = this.resolver.resolveType({ ...fieldAst.type, isArray: false });
      fixedBufferInitializer = `new Array(${size}).fill(${elementType.defaultVal ?? '0'})`;
      irUnit.todoNotes.push({
        kind: 'unsafe-fixed-buffer',
        severity: 'high',
        symbol: fieldAst.declarations.map(declaration => declaration.name).join(', '),
        reason: 'C# fixed buffer was emitted as a JavaScript array; memory layout and unsafe access require review.',
      });
    }

    for (const decl of fieldAst.declarations) {
      const irField = new IRField(sanitizeIdentifier(decl.name), resolvedType.ts, resolvedType.cocos);
      irField.isStatic = isStatic;
      irField.isReadonly = isReadonly;

      if (isStatic) {
        irField.modifiers = isPublic ? ['public', 'static'] : ['private', 'static'];
      } else {
        irField.modifiers = isPublic ? ['public'] : ['private'];
      }

      // Check if should have @property decorator
      if ((isSerialized || isPublic) && !isStatic && !isReadonly && resolvedType.cocos) {
        irField.isProperty = true;
        irField.propertyOptions = { type: resolvedType.cocos };
        if (resolvedType.cocos === 'CCFloat' || resolvedType.cocos === 'CCInteger' || resolvedType.cocos === 'CCBoolean' || resolvedType.cocos === 'CCString') {
          irUnit.addImport('cc', resolvedType.cocos);
        }
      }

      if (fixedBufferInitializer) {
        irField.initializer = fixedBufferInitializer;
      } else if (decl.initializer) {
        irField.initializer = this.transformExpression(decl.initializer, irUnit);
      } else {
        irField.initializer = resolvedType.defaultVal || 'null';
      }

      irClass.fields.push(irField);
    }
  }

  transformProperty(propAst, irClass, irUnit) {
    const resolvedType = this.resolver.resolveType(propAst.type);
    if (resolvedType.import) irUnit.addImport('cc', resolvedType.import);

    let propertyName = propAst.name;
    if (propertyName.includes('.')) {
      irUnit.todoNotes.push({
        kind: 'explicit-interface-implementation',
        symbol: propertyName,
        reason: 'Explicit C# interface property was emitted as a normal TypeScript property.',
      });
      propertyName = propertyName.split('.').pop();
    }
    const irProp = new IRProperty(sanitizeIdentifier(propertyName), resolvedType.ts);
    irProp.isStatic = propAst.modifiers.includes('static');
    irProp.modifiers = propAst.modifiers.includes('public') ? ['public'] : ['private'];

    if (propAst.isExpressionBodied && propAst.expression) {
      irProp.expression = this.transformExpression(propAst.expression, irUnit);
    } else {
      const accessors = propAst.accessors || [];
      const getter = accessors.find(accessor => accessor.name === 'get');
      const setter = accessors.find(accessor => accessor.name === 'set' || accessor.name === 'init');
      const hasAccessorBody = accessors.some(accessor => accessor.body);
      if (!hasAccessorBody) {
        irProp.isAuto = true;
        irProp.initializer = propAst.initializer
          ? this.transformExpression(propAst.initializer, irUnit)
          : (resolvedType.defaultVal || 'null');
      } else {
        if (getter && getter.body) {
          irProp.getter = getter.body.kind === 'ExpressionBody'
            ? [`return ${this.transformExpression(getter.body.expr, irUnit)};`]
            : this.transformStatements(getter.body.statements || [], irUnit, `get_${irProp.name}`);
        }
        if (setter && setter.body) {
          irProp.setter = setter.body.kind === 'ExpressionBody'
            ? [`${this.transformExpression(setter.body.expr, irUnit)};`]
            : this.transformStatements(setter.body.statements || [], irUnit, `set_${irProp.name}`);
        }
      }
    }

    irClass.properties.push(irProp);
  }

  transformConstructor(ctorAst, irClass, irUnit) {
    const irMethod = new IRMethod('constructor', '');
    irMethod.parameters = (ctorAst.parameters || []).map(p => {
      const pType = this.resolver.resolveType(p.type);
      if (pType.import) irUnit.addImport('cc', pType.import);
      return { name: sanitizeIdentifier(p.name), type: pType.ts, defaultValue: p.defaultValue ? this.transformExpression(p.defaultValue, irUnit) : null };
    });

    if (ctorAst.body && ctorAst.body.statements) {
      irMethod.body = this.transformStatements(ctorAst.body.statements, irUnit, 'constructor');
    }
    irClass.constructors.push(irMethod);
  }

  transformMethod(methodAst, irClass, irUnit, isComponent) {
    let methodName = methodAst.name;
    if (methodName.includes('.')) {
      irUnit.todoNotes.push({
        kind: 'explicit-interface-implementation',
        symbol: methodName,
        reason: 'Explicit C# interface implementation was emitted as a normal TypeScript method.',
      });
      methodName = methodName.split('.').pop();
    }
    methodName = sanitizeIdentifier(methodName);
    let isLifecycle = false;

    // Check Unity Lifecycle methods
    if (isComponent) {
      const lifecycle = this.resolver.resolveLifecycleMethod(methodName);
      if (lifecycle) {
        methodName = lifecycle.name;
        isLifecycle = true;
        if (lifecycle.import) irUnit.addImport('cc', lifecycle.import);
      }
    }

    const resolvedRet = this.resolver.resolveType(methodAst.returnType);
    if (resolvedRet.import) irUnit.addImport('cc', resolvedRet.import);

    const irMethod = new IRMethod(methodName, resolvedRet.ts);
    irMethod.isLifecycle = isLifecycle;
    irMethod.isStatic = methodAst.modifiers.includes('static');
    irMethod.isAsync = methodAst.modifiers.includes('async');
    irMethod.modifiers = methodAst.modifiers.includes('public') ? ['public'] : (methodAst.modifiers.includes('protected') ? ['protected'] : ['private']);

    // Check IEnumerator -> Coroutine
    if (methodAst.returnType && (methodAst.returnType.name === 'IEnumerator' || methodAst.returnType.name === 'System.Collections.IEnumerator')) {
      irMethod.isCoroutine = true;
      irMethod.returnType = 'Generator<any, void, any>';
    }

    irMethod.parameters = (methodAst.parameters || []).map(p => {
      const pType = this.resolver.resolveType(p.type);
      if (pType.import) irUnit.addImport('cc', pType.import);
      return {
        name: sanitizeIdentifier(p.name),
        type: pType.ts,
        defaultValue: p.defaultValue ? this.transformExpression(p.defaultValue, irUnit) : null
      };
    });

    if (methodAst.body) {
      if (methodAst.body.kind === 'ExpressionBody') {
        const retExpr = this.transformExpression(methodAst.body.expr, irUnit, methodName);
        irMethod.body = [`return ${retExpr};`];
      } else if (methodAst.body.statements) {
        irMethod.body = this.transformStatements(methodAst.body.statements, irUnit, methodName);
      }
    }

    irClass.methods.push(irMethod);
  }

  transformStatements(statements, irUnit, currentMethodName) {
    const lines = [];
    for (const stmt of statements) {
      const transformed = this.transformStatement(stmt, irUnit, currentMethodName);
      if (transformed) {
        if (Array.isArray(transformed)) {
          lines.push(...transformed);
        } else {
          lines.push(transformed);
        }
      }
    }
    return lines;
  }

  transformStatement(stmt, irUnit, currentMethodName) {
    if (!stmt) return '';

    switch (stmt.kind) {
      case 'BlockStatement': {
        const inner = this.transformStatements(stmt.statements, irUnit, currentMethodName);
        return [`{`, ...inner.map(l => '  ' + l), `}`];
      }

      case 'LocalDeclarationStatement': {
        const declarationKeyword = (stmt.modifiers || []).includes('const') ? 'const' : 'let';
        const decls = stmt.declarations.map(d => {
          if (d.initializer) {
            const init = this.transformExpression(d.initializer, irUnit, currentMethodName);
            return `${declarationKeyword} ${sanitizeIdentifier(d.name)} = ${init};`;
          }
          const resType = this.resolver.resolveType(stmt.type);
          return `${declarationKeyword} ${sanitizeIdentifier(d.name)}: ${resType.ts} = ${resType.defaultVal || 'null'};`;
        });
        return decls.join('\n');
      }

      case 'TupleDeconstructionDeclaration': {
        const names = (stmt.type && stmt.type.elements || []).map(e => sanitizeIdentifier(e.name || '_'));
        const init = stmt.initializer ? this.transformExpression(stmt.initializer, irUnit, currentMethodName) : 'null';
        return `let [${names.join(', ')}] = ${init};`;
      }

      case 'IfStatement': {
        const cond = this.transformExpression(stmt.condition, irUnit, currentMethodName);
        const thenBody = this.transformStatement(stmt.thenStatement, irUnit, currentMethodName);
        const lines = [`if (${cond}) {`];
        if (Array.isArray(thenBody)) {
          lines.push(...thenBody.map(l => '  ' + l));
        } else {
          lines.push('  ' + thenBody);
        }
        lines.push('}');
        if (stmt.elseStatement) {
          const elseBody = this.transformStatement(stmt.elseStatement, irUnit, currentMethodName);
          lines[lines.length - 1] += ' else {';
          if (Array.isArray(elseBody)) {
            lines.push(...elseBody.map(l => '  ' + l));
          } else {
            lines.push('  ' + elseBody);
          }
          lines.push('}');
        }
        return lines;
      }

      case 'ForStatement': {
        let initStr = '';
        if (stmt.initializer) {
          if (stmt.initializer.kind === 'LocalDeclarationStatement') {
            initStr = 'let ' + stmt.initializer.declarations.map(d => `${sanitizeIdentifier(d.name)} = ${this.transformExpression(d.initializer, irUnit, currentMethodName)}`).join(', ');
          } else {
            initStr = this.transformExpression(stmt.initializer, irUnit, currentMethodName);
          }
        }
        const condStr = stmt.condition ? this.transformExpression(stmt.condition, irUnit, currentMethodName) : '';
        const incStr = stmt.incrementors ? stmt.incrementors.map(inc => this.transformExpression(inc, irUnit, currentMethodName)).join(', ') : '';
        const bodyStr = this.transformStatement(stmt.body, irUnit, currentMethodName);
        const lines = [`for (${initStr}; ${condStr}; ${incStr}) {`];
        if (Array.isArray(bodyStr)) lines.push(...bodyStr.map(l => '  ' + l));
        else lines.push('  ' + bodyStr);
        lines.push('}');
        return lines;
      }

      case 'ForEachStatement': {
        const elemName = sanitizeIdentifier(stmt.identifier);
        const iterExpr = this.transformExpression(stmt.expression, irUnit, currentMethodName);
        const bodyStr = this.transformStatement(stmt.body, irUnit, currentMethodName);
        const lines = [`for (const ${elemName} of ${iterExpr}) {`];
        if (Array.isArray(bodyStr)) lines.push(...bodyStr.map(l => '  ' + l));
        else lines.push('  ' + bodyStr);
        lines.push('}');
        return lines;
      }

      case 'WhileStatement': {
        const cond = this.transformExpression(stmt.condition, irUnit, currentMethodName);
        const body = this.transformStatement(stmt.body, irUnit, currentMethodName);
        const lines = [`while (${cond}) {`];
        if (Array.isArray(body)) lines.push(...body.map(l => '  ' + l));
        else lines.push('  ' + body);
        lines.push('}');
        return lines;
      }

      case 'DoWhileStatement': {
        const body = this.transformStatement(stmt.body, irUnit, currentMethodName);
        const cond = this.transformExpression(stmt.condition, irUnit, currentMethodName);
        const lines = [`do {`];
        if (Array.isArray(body)) lines.push(...body.map(l => '  ' + l));
        else lines.push('  ' + body);
        lines.push(`} while (${cond});`);
        return lines;
      }

      case 'SwitchStatement': {
        const expr = this.transformExpression(stmt.expression, irUnit, currentMethodName);
        const lines = [`switch (${expr}) {`];
        for (const sec of stmt.sections || []) {
          for (const lbl of sec.labels || []) {
            if (lbl.kind === 'CaseLabel') {
              lines.push(`  case ${this.transformExpression(lbl.expr, irUnit, currentMethodName)}:`);
            } else {
              lines.push(`  default:`);
            }
          }
          const sStmts = this.transformStatements(sec.statements || [], irUnit, currentMethodName);
          lines.push(...sStmts.map(l => '    ' + l));
        }
        lines.push('}');
        return lines;
      }

      case 'ReturnStatement': {
        if (stmt.expression) {
          return `return ${this.transformExpression(stmt.expression, irUnit, currentMethodName)};`;
        }
        return 'return;';
      }

      case 'YieldReturnStatement': {
        const yieldExpr = this.transformExpression(stmt.expression, irUnit, currentMethodName);
        return `yield ${yieldExpr};`;
      }

      case 'YieldBreakStatement': {
        return 'return;';
      }

      case 'GotoStatement': {
        if (stmt.target === 'default') {
          return '/* goto default; */';
        }
        if (stmt.target === 'case') {
          return `/* goto case ${this.transformExpression(stmt.caseExpr, irUnit, currentMethodName)}; */`;
        }
        return `/* goto ${stmt.target}; */`;
      }

      case 'BreakStatement': return 'break;';
      case 'ContinueStatement': return 'continue;';
      case 'EmptyStatement': return ';';

      case 'ExpressionStatement': {
        return `${this.transformExpression(stmt.expression, irUnit, currentMethodName)};`;
      }

      default:
        return `// @MIGRATION_TODO [Unsupported Statement: ${stmt.kind}]`;
    }
  }

  transformExpression(expr, irUnit, currentMethodName) {
    if (!expr) return 'null';

    switch (expr.kind) {
      case 'NumericLiteral': {
        // Strip C# literal suffixes (f, F, d, D, m, M, u, U, l, L)
        const isNonDecimal = /^0[xXbB]/.test(expr.value);
        let numVal = isNonDecimal
          ? expr.value.replace(/[uUlL]+$/, '')
          : expr.value.replace(/[fFdDmMuUlL]+$/, '');
        if (!isNonDecimal && /^0\d+$/.test(numVal)) {
          numVal = String(Number.parseInt(numVal, 10));
        }
        return numVal.replace(/_/g, '');
      }

      case 'StringLiteral': {
        if (expr.isInterpolated) {
          return transformInterpolatedString(expr.value);
        }
        return JSON.stringify(expr.value);
      }

      case 'CharLiteral': {
        return JSON.stringify(expr.value);
      }

      case 'BooleanLiteral': {
        return expr.value ? 'true' : 'false';
      }

      case 'NullLiteral': return 'null';
      case 'ThisExpression': return 'this';
      case 'BaseExpression': return 'super';
      case 'DiscardExpression': return '_';

      case 'Identifier': {
        const idName = expr.name;
        // Check global Unity Singletons / Math
        if (idName === 'Mathf') return 'Math';
        if (idName === 'Time') {
          if (currentMethodName === 'update' || currentMethodName === 'lateUpdate') return 'dt';
          return 'UnityTime';
        }
        if (idName === 'Random') return 'UnityRandom';
        if (idName === 'Vector3') { irUnit.addImport('cc', 'Vec3'); return 'Vec3'; }
        if (idName === 'Vector2') { irUnit.addImport('cc', 'Vec2'); return 'Vec2'; }
        if (idName === 'Quaternion') { irUnit.addImport('cc', 'Quat'); return 'Quat'; }
        if (idName === 'Color') { irUnit.addImport('cc', 'Color'); return 'Color'; }
        if (idName === 'GameObject') { irUnit.addImport('cc', 'Node'); return 'Node'; }
        if (idName === 'transform') return 'this.node';
        if (idName === 'gameObject') return 'this.node';
        return sanitizeIdentifier(idName);
      }

      case 'MemberAccessExpression': {
        return this.transformMemberAccess(expr, irUnit, currentMethodName);
      }

      case 'InvocationExpression': {
        return this.transformInvocation(expr, irUnit, currentMethodName);
      }

      case 'BinaryExpression': {
        const op = expr.operator;
        const left = this.transformExpression(expr.left, irUnit, currentMethodName);
        const right = this.transformExpression(expr.right, irUnit, currentMethodName);
        return `${left} ${op} ${right}`;
      }

      case 'AssignmentExpression': {
        return this.transformAssignment(expr, irUnit, currentMethodName);
      }

      case 'PrefixUnaryExpression': {
        const op = expr.operator;
        const operand = this.transformExpression(expr.operand, irUnit, currentMethodName);
        if (op === '&' || op === '*') {
          irUnit.todoNotes.push({
            kind: 'unsafe-pointer',
            reason: `C# pointer operator '${op}' requires manual migration.`,
          });
          return `/* @MIGRATION_TODO: pointer '${op}' */ (${operand} as any)`;
        }
        return `${op}${operand}`;
      }

      case 'PostfixUnaryExpression': {
        const op = expr.operator;
        const operand = this.transformExpression(expr.operand, irUnit, currentMethodName);
        return `${operand}${op}`;
      }

      case 'CastExpression': {
        // TypeScript type assertion: (expr as Type)
        const innerExpr = this.transformExpression(expr.operand, irUnit, currentMethodName);
        const targetType = this.resolver.resolveType(expr.type);
        if (targetType.import) irUnit.addImport('cc', targetType.import);
        return `(${innerExpr} as ${targetType.ts})`;
      }

      case 'ParenthesizedExpression': {
        return `(${this.transformExpression(expr.expression, irUnit, currentMethodName)})`;
      }

      case 'SuppressNullableWarningExpression': {
        return this.transformExpression(expr.operand, irUnit, currentMethodName);
      }

      case 'GenericNameExpression': {
        return expr.name;
      }

      case 'DefaultExpression':
      case 'DefaultLiteral': {
        return 'null';
      }

      case 'AwaitExpression': {
        return `await ${this.transformExpression(expr.expression, irUnit, currentMethodName)}`;
      }

      case 'ThrowExpression': {
        const value = this.transformExpression(expr.expression, irUnit, currentMethodName);
        return `(() => { throw ${value}; })()`;
      }

      case 'RangeExpression': {
        const left = expr.left ? this.transformExpression(expr.left, irUnit, currentMethodName) : '0';
        const right = expr.right ? this.transformExpression(expr.right, irUnit, currentMethodName) : '';
        return `/* range */ [${left}, ${right}]`;
      }

      case 'SwitchExpression': {
        const cond = this.transformExpression(expr.expression, irUnit, currentMethodName);
        const arms = (expr.arms || []).map(a => {
          const pat = this.transformExpression(a.pattern, irUnit, currentMethodName);
          const armExp = this.transformExpression(a.expression, irUnit, currentMethodName);
          if (pat === '_' || pat === 'null') return `default: return ${armExp};`;
          return `case ${pat}: return ${armExp};`;
        });
        return `((() => { switch (${cond}) { ${arms.join(' ')} } })())`;
      }

      case 'PropertyPatternExpression': {
        return `true /* property pattern */`;
      }

      case 'AnonymousMethodExpression': {
        const params = (expr.parameters || []).map(p => sanitizeIdentifier(p.name)).join(', ');
        if (expr.body && expr.body.kind === 'BlockStatement') {
          const body = this.transformStatements(expr.body.statements || [], irUnit, currentMethodName);
          return `((${params}) => {\n${body.map(line => '  ' + line).join('\n')}\n})`;
        }
        const body = expr.body ? this.transformExpression(expr.body, irUnit, currentMethodName) : 'undefined';
        return `((${params}) => ${body})`;
      }

      case 'SequenceExpression': {
        return (expr.expressions || []).map(e => this.transformExpression(e, irUnit, currentMethodName)).join(', ');
      }

      case 'ConditionalExpression': {
        const cond = this.transformExpression(expr.condition, irUnit, currentMethodName);
        const thenE = this.transformExpression(expr.thenExpr, irUnit, currentMethodName);
        const elseE = this.transformExpression(expr.elseExpr, irUnit, currentMethodName);
        return `${cond} ? ${thenE} : ${elseE}`;
      }

      case 'ObjectCreationExpression': {
        return this.transformObjectCreation(expr, irUnit, currentMethodName);
      }

      case 'ArrayInitializerExpression': {
        const elems = expr.elements.map(e => this.transformExpression(e, irUnit, currentMethodName));
        return `[${elems.join(', ')}]`;
      }

      case 'TupleExpression': {
        const elems = (expr.elements || []).map(element =>
          this.transformExpression(element.expr, irUnit, currentMethodName)
        );
        return `[${elems.join(', ')}]`;
      }

      case 'IndexerInitializer': {
        const key = this.transformExpression(expr.key, irUnit, currentMethodName);
        const value = this.transformExpression(expr.value, irUnit, currentMethodName);
        return `[${key}, ${value}]`;
      }

      case 'ElementAccessExpression': {
        const target = this.transformExpression(expr.expression, irUnit, currentMethodName);
        if (expr.indices.length === 1 && expr.indices[0].kind === 'RangeExpression') {
          const range = expr.indices[0];
          const start = range.left ? this.transformExpression(range.left, irUnit, currentMethodName) : '0';
          let end = '';
          if (range.right) {
            if (range.right.kind === 'PrefixUnaryExpression' && range.right.operator === '^') {
              const offset = this.transformExpression(range.right.operand, irUnit, currentMethodName);
              end = `${target}.length - ${offset}`;
            } else {
              end = this.transformExpression(range.right, irUnit, currentMethodName);
            }
          }
          return `${target}.slice(${start}${end ? `, ${end}` : ''})`;
        }
        const indices = expr.indices.map(index => {
          if (index.kind === 'PrefixUnaryExpression' && index.operator === '^') {
            const offset = this.transformExpression(index.operand, irUnit, currentMethodName);
            return `${target}.length - ${offset}`;
          }
          return this.transformExpression(index, irUnit, currentMethodName);
        });
        return `${target}[${indices.join('][')}]`;
      }

      case 'LambdaExpression': {
        const params = (expr.parameters || []).map(p => sanitizeIdentifier(p.name || 'arg')).join(', ');
        if (expr.body.kind === 'BlockStatement') {
          const bodyStmts = this.transformStatements(expr.body.statements, irUnit, currentMethodName);
          return `(${params}) => {\n${bodyStmts.map(l => '  ' + l).join('\n')}\n}`;
        }
        return `(${params}) => ${this.transformExpression(expr.body, irUnit, currentMethodName)}`;
      }

      case 'TypeOfExpression': {
        const typeRef = this.resolver.resolveType(expr.type);
        if (typeRef.import) irUnit.addImport('cc', typeRef.import);
        if (expr.type && expr.type.isArray) return 'Array';
        if (typeRef.ts.endsWith('[]')) return 'Array';
        if (typeRef.ts === 'number') return 'Number';
        if (typeRef.ts === 'boolean') return 'Boolean';
        if (typeRef.ts === 'string') return 'String';
        if (typeRef.ts === 'void') return 'undefined';
        if (typeRef.ts === 'any') return 'Object';
        if (typeRef.ts.includes('=>')) return 'Function';
        if (typeRef.ts.startsWith('Map<')) return 'Map';
        if (typeRef.ts.startsWith('Set<')) return 'Set';
        return (typeRef.import || typeRef.ts)
          .replace(/\s*\|\s*null/g, '')
          .replace(/<.*>$/, '')
          .replace(/\[\]$/, 'Array');
      }

      case 'AnonymousObjectCreationExpression': {
        const props = (expr.properties || []).map(p => {
          if (p.kind === 'MemberInitializer') {
            return `${p.name}: ${this.transformExpression(p.value, irUnit, currentMethodName)}`;
          }
          if (p.kind === 'MemberAccessExpression') {
            return `${sanitizeIdentifier(p.member)}: ${this.transformExpression(p, irUnit, currentMethodName)}`;
          }
          if (p.kind === 'Identifier') {
            return sanitizeIdentifier(p.name);
          }
          return this.transformExpression(p, irUnit, currentMethodName);
        });
        return `({ ${props.join(', ')} })`;
      }

      case 'LinqQueryExpression': {
        const source = this.transformExpression(expr.source, irUnit, currentMethodName);
        const item = expr.itemName || 'item';
        let result = source;
        if (expr.clauses) {
          for (const c of expr.clauses) {
            if (c.kind === 'WhereClause') {
              const cond = this.transformExpression(c.condition, irUnit, currentMethodName);
              result = `${result}.filter(${item} => ${cond})`;
            }
          }
        }
        if (expr.select) {
          const sel = this.transformExpression(expr.select, irUnit, currentMethodName);
          result = `${result}.map(${item} => ${sel})`;
        }
        return result;
      }

      default:
        return `/* @MIGRATION_TODO: [${expr.kind}] */ null`;
    }
  }

  transformMemberAccess(expr, irUnit, currentMethodName) {
    const member = expr.member;
    let targetStr = this.transformExpression(expr.expression, irUnit, currentMethodName);
    if (expr.expression && expr.expression.kind === 'NumericLiteral') {
      targetStr = `(${targetStr})`;
    }

    // Transform member mappings
    if (targetStr === 'this.node' || targetStr === 'transform' || targetStr === 'node') {
      if (member === 'position') return 'this.node.worldPosition';
      if (member === 'localPosition') return 'this.node.position';
      if (member === 'rotation') return 'this.node.worldRotation';
      if (member === 'localRotation') return 'this.node.rotation';
      if (member === 'localScale') return 'this.node.scale';
      if (member === 'parent') return 'this.node.parent';
      if (member === 'childCount') return 'this.node.children.length';
      if (member === 'forward') return 'this.node.forward';
      if (member === 'right') return 'this.node.right';
      if (member === 'up') return 'this.node.up';
      if (member === 'activeSelf') return 'this.node.active';
      if (member === 'name') return 'this.node.name';
    }

    // Time.deltaTime
    if (targetStr === 'Time' || targetStr === 'UnityTime') {
      if (member === 'deltaTime') {
        if (currentMethodName === 'update' || currentMethodName === 'lateUpdate') return 'dt';
        return 'UnityTime.deltaTime';
      }
      if (member === 'time') return 'UnityTime.time';
    }

    // Vector constants
    if (targetStr === 'Vec3' || targetStr === 'Vector3') {
      irUnit.addImport('cc', 'Vec3');
      if (member === 'zero') return 'Vec3.ZERO';
      if (member === 'one') return 'Vec3.ONE';
      if (member === 'up') return 'Vec3.UP';
      if (member === 'forward') return 'Vec3.FORWARD';
      if (member === 'right') return 'Vec3.RIGHT';
    }

    if (targetStr === 'Quat' || targetStr === 'Quaternion') {
      irUnit.addImport('cc', 'Quat');
      if (member === 'identity') return 'Quat.IDENTITY';
    }

    if (targetStr === 'Color') {
      irUnit.addImport('cc', 'Color');
      if (member === 'white') return 'Color.WHITE';
      if (member === 'black') return 'Color.BLACK';
      if (member === 'red') return 'Color.RED';
      if (member === 'green') return 'Color.GREEN';
      if (member === 'blue') return 'Color.BLUE';
      if (member === 'yellow') return 'Color.YELLOW';
    }

    // Mathf constants
    if (targetStr === 'Math' || targetStr === 'Mathf') {
      if (member === 'Deg2Rad') return '(Math.PI / 180)';
      if (member === 'Rad2Deg') return '(180 / Math.PI)';
      if (member === 'PI') return 'Math.PI';
      if (member === 'Infinity') return 'Infinity';
    }

    return `${targetStr}.${member}`;
  }

  transformInvocation(expr, irUnit, currentMethodName) {
    let target = expr.target;
    let targetStr = this.transformExpression(target, irUnit, currentMethodName);
    const args = (expr.arguments || []).map(a => this.transformExpression(a.expr, irUnit, currentMethodName));

    // Mathf methods -> Math or math
    if (targetStr.startsWith('Mathf.') || targetStr.startsWith('Math.')) {
      const funcName = targetStr.split('.')[1];
      if (funcName === 'Clamp') { irUnit.addImport('cc', 'math'); return `math.clamp(${args.join(', ')})`; }
      if (funcName === 'Clamp01') { irUnit.addImport('cc', 'math'); return `math.clamp01(${args.join(', ')})`; }
      if (funcName === 'Lerp') { irUnit.addImport('cc', 'math'); return `math.lerp(${args.join(', ')})`; }
      if (funcName === 'Abs') return `Math.abs(${args.join(', ')})`;
      if (funcName === 'Min') return `Math.min(${args.join(', ')})`;
      if (funcName === 'Max') return `Math.max(${args.join(', ')})`;
      if (funcName === 'Sin') return `Math.sin(${args.join(', ')})`;
      if (funcName === 'Cos') return `Math.cos(${args.join(', ')})`;
      if (funcName === 'Tan') return `Math.tan(${args.join(', ')})`;
      if (funcName === 'Sqrt') return `Math.sqrt(${args.join(', ')})`;
      if (funcName === 'Floor') return `Math.floor(${args.join(', ')})`;
      if (funcName === 'Ceil') return `Math.ceil(${args.join(', ')})`;
      if (funcName === 'Round') return `Math.round(${args.join(', ')})`;
      if (funcName === 'SmoothDamp') {
        irUnit.addScratchVar('UnityMathf');
        return `UnityMathf.smoothDamp(${args.join(', ')}, ${currentMethodName === 'update' ? 'dt' : '0.016'})`;
      }
    }

    // Vector3 methods
    if (targetStr.startsWith('Vec3.') || targetStr.startsWith('Vector3.')) {
      irUnit.addImport('cc', 'Vec3');
      const funcName = targetStr.split('.')[1];
      if (funcName === 'Distance') return `Vec3.distance(${args[0]}, ${args[1]})`;
      if (funcName === 'Dot') return `Vec3.dot(${args[0]}, ${args[1]})`;
      if (funcName === 'Angle') return `Vec3.angle(${args[0]}, ${args[1]})`;
    }

    // GetComponent<T>() -> this.getComponent(T)
    if (targetStr.endsWith('.GetComponent') || targetStr === 'GetComponent') {
      const typeArg = expr.typeArgs && expr.typeArgs[0] ? expr.typeArgs[0].name : 'Component';
      const caller = targetStr === 'GetComponent' ? 'this' : targetStr.replace(/\.GetComponent$/, '');
      return `${caller}.getComponent(${typeArg})`;
    }

    // GetComponentInChildren<T>() -> this.getComponentInChildren(T)
    if (targetStr.endsWith('.GetComponentInChildren') || targetStr === 'GetComponentInChildren') {
      const typeArg = expr.typeArgs && expr.typeArgs[0] ? expr.typeArgs[0].name : 'Component';
      const caller = targetStr === 'GetComponentInChildren' ? 'this' : targetStr.replace(/\.GetComponentInChildren$/, '');
      return `${caller}.getComponentInChildren(${typeArg})`;
    }

    // SetActive(val) -> this.node.active = val
    if (targetStr.endsWith('.SetActive') || targetStr === 'SetActive') {
      const caller = targetStr === 'SetActive' ? 'this.node' : targetStr.replace(/\.SetActive$/, '');
      return `${caller}.active = ${args[0]}`;
    }

    // Destroy(obj) -> obj.destroy()
    if (targetStr === 'Destroy' || targetStr === 'GameObject.Destroy') {
      if (args.length === 1) return `${args[0]}?.destroy()`;
      return `this.scheduleOnce(() => ${args[0]}?.destroy(), ${args[1]})`;
    }

    // Instantiate(prefab) -> instantiate(prefab)
    if (targetStr === 'Instantiate' || targetStr === 'GameObject.Instantiate') {
      irUnit.addImport('cc', 'instantiate');
      return `instantiate(${args[0]})`;
    }

    // Debug.Log -> console.log
    if (targetStr === 'Debug.Log') return `console.log(${args.join(', ')})`;
    if (targetStr === 'Debug.LogWarning') return `console.warn(${args.join(', ')})`;
    if (targetStr === 'Debug.LogError') return `console.error(${args.join(', ')})`;

    return `${targetStr}(${args.join(', ')})`;
  }

  transformAssignment(expr, irUnit, currentMethodName) {
    const leftStr = this.transformExpression(expr.left, irUnit, currentMethodName);
    const rightStr = this.transformExpression(expr.right, irUnit, currentMethodName);

    // Transform Node position/rotation/scale setters
    if (leftStr === 'this.node.worldPosition') {
      return `this.node.setWorldPosition(${rightStr})`;
    }
    if (leftStr === 'this.node.position') {
      return `this.node.setPosition(${rightStr})`;
    }
    if (leftStr === 'this.node.worldRotation') {
      return `this.node.setWorldRotation(${rightStr})`;
    }
    if (leftStr === 'this.node.rotation') {
      return `this.node.setRotation(${rightStr})`;
    }
    if (leftStr === 'this.node.scale') {
      return `this.node.setScale(${rightStr})`;
    }

    return `${leftStr} ${expr.operator} ${rightStr}`;
  }

  transformObjectCreation(expr, irUnit, currentMethodName) {
    const typeName = (expr.type && expr.type.name) || '';
    const typeRef = expr.type ? this.resolver.resolveType(expr.type) : { ts: 'Object', isCustom: false };
    if (typeRef.import) irUnit.addImport('cc', typeRef.import);

    const args = (expr.arguments || []).map(a => this.transformExpression(a.expr, irUnit, currentMethodName));

    if (typeRef.ts === 'Vec3' || typeName === 'Vector3') {
      irUnit.addImport('cc', 'Vec3');
      return `new Vec3(${args.join(', ')})`;
    }
    if (typeRef.ts === 'Vec2' || typeName === 'Vector2') {
      irUnit.addImport('cc', 'Vec2');
      return `new Vec2(${args.join(', ')})`;
    }
    if (typeRef.ts === 'Color' || typeName === 'Color') {
      irUnit.addImport('cc', 'Color');
      return `new Color(${args.join(', ')})`;
    }

    if (expr.type && expr.type.isArray) {
      if (expr.initializer) {
        const elems = expr.initializer.map(e => this.transformExpression(e, irUnit, currentMethodName));
        return `[${elems.join(', ')}]`;
      }
      return `[]`;
    }

    if (typeName === 'List' || typeName === 'System.Collections.Generic.List') {
      if (expr.initializer) {
        const elems = expr.initializer.map(e => this.transformExpression(e, irUnit, currentMethodName));
        return `[${elems.join(', ')}]`;
      }
      return '[]';
    }
    if (typeName === 'Dictionary' || typeName === 'System.Collections.Generic.Dictionary') {
      if (expr.initializer) {
        const entries = expr.initializer.map(e => this.transformExpression(e, irUnit, currentMethodName));
        return `new Map([${entries.join(', ')}])`;
      }
      return `new Map(${args.join(', ')})`;
    }
    if (typeName === 'HashSet' || typeName === 'System.Collections.Generic.HashSet') {
      return `new Set(${args.join(', ')})`;
    }

    if (!expr.type) {
      if (expr.initializer) {
        const elems = expr.initializer.map(e => this.transformExpression(e, irUnit, currentMethodName));
        if (expr.initializer.every(e => e.kind === 'IndexerInitializer')) {
          return `new Map([${elems.join(', ')}])`;
        }
        if (expr.initializer.every(e => e.kind === 'MemberInitializer')) {
          const props = expr.initializer.map(e => `${e.name}: ${this.transformExpression(e.value, irUnit, currentMethodName)}`);
          return `({ ${props.join(', ')} })`;
        }
        return `[${elems.join(', ')}]`;
      }
      return `new Object(${args.join(', ')})`;
    }

    // Nullable unions describe storage, not constructor expressions. Use the
    // source type name for project/.NET types so `new Foo | null()` is never
    // emitted.
    return `new ${typeRef.import || typeName || 'Object'}(${args.join(', ')})`;
  }
}

module.exports = {
  MigrationRulesEngine,
};
