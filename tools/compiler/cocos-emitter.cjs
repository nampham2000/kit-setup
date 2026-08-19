'use strict';

/**
 * Cocos Creator 3.8.8+ TypeScript Emitter
 *
 * Generates production-ready, typed, Zero-GC compliant TypeScript source code
 * from the Migration Intermediate Representation (IR).
 */

class CocosEmitter {
  emit(irUnit) {
    const lines = [];

    // JSDoc Header
    lines.push('/**');
    lines.push(' * Cocos Creator 3.8.8+ TypeScript Component');
    if (irUnit.filename) {
      lines.push(` * @unity-source ${irUnit.filename.replace(/\\/g, '/')}`);
    }
    lines.push(' * @migration-stage static-first-pass');
    lines.push(' * Generated automatically; use the migration report for AI refinement risks');
    lines.push(' */');
    lines.push('');

    // Imports from 'cc'
    const ccImports = irUnit.imports.get('cc') || new Set(['_decorator', 'Component', 'Node']);
    ccImports.add('_decorator');
    ccImports.add('Component');
    ccImports.add('Node');

    // Check if Enum registration is needed
    if (irUnit.registeredEnums && irUnit.registeredEnums.size > 0) {
      ccImports.add('Enum');
    }

    const sortedCcImports = Array.from(ccImports).sort();
    lines.push(`import { ${sortedCcImports.join(', ')} } from 'cc';`);

    // Non-cc ES Module imports (e.g. cross-namespace / folder imports)
    for (const [modulePath, symbols] of irUnit.imports.entries()) {
      if (modulePath === 'cc' || modulePath === './shared/compat') continue;
      if (symbols && symbols.size > 0) {
        const sorted = Array.from(symbols).sort();
        lines.push(`import { ${sorted.join(', ')} } from '${modulePath}';`);
      }
    }

    // Shared compat layer import if needed
    const compatImports = [];
    const compatSymbols = ['UnityMathf', 'UnityTime', 'UnityRandom', 'UnityCoroutine', 'UnityPlayerPrefs', 'UnityLayerMask', 'UnityDebug', 'UnityPhysics', 'UnityVector3', 'UnityQuaternion', 'UnityTransform', 'UnityGameObject', 'UnityInput', 'UnitySceneManager', 'UnityResources', 'UnityUI'];
    for (const sym of compatSymbols) {
      const isReferenced = irUnit.declarations.some(d =>
        (d.fields && d.fields.some(f => f.type && f.type.includes(sym))) ||
        (d.methods && d.methods.some(m => (m.returnType && m.returnType.includes(sym)) || (m.body && m.body.some(stmt => stmt.includes(sym)))))
      );
      if (irUnit.scratchVariables.has(sym) || isReferenced || (irUnit.imports.has('./shared/compat') && irUnit.imports.get('./shared/compat').has(sym))) {
        compatImports.push(sym);
      }
    }
    if (compatImports.length > 0) {
      lines.push(`import { ${compatImports.sort().join(', ')} } from './shared/compat';`);
    }
    lines.push('');

    // Decorator aliases
    const decoratorSymbols = new Set(['ccclass', 'property']);
    for (const decl of irUnit.declarations) {
      if (decl.constructor.name === 'IRClass') {
        if (decl.disallowMultiple) decoratorSymbols.add('disallowMultiple');
        if (decl.executionOrder !== null && decl.executionOrder !== undefined) decoratorSymbols.add('executionOrder');
        if (decl.executeInEditMode) decoratorSymbols.add('executeInEditMode');
        if (decl.requireComponents && decl.requireComponents.length > 0) decoratorSymbols.add('requireComponent');
      }
    }
    const sortedDecorators = Array.from(decoratorSymbols);
    lines.push(`const { ${sortedDecorators.join(', ')} } = _decorator;`);
    lines.push('');

    // Module-level Scratch Variables (Zero-GC Rule)
    if (ccImports.has('Vec3')) {
      lines.push('// Auto-generated module-level scratch variables to prevent GC allocations');
      lines.push('const _tempV3_0 = new Vec3();');
      lines.push('const _tempV3_1 = new Vec3();');
      lines.push('const _tempV3_2 = new Vec3();');
    }
    if (ccImports.has('Quat')) {
      lines.push('const _tempQuat_0 = new Quat();');
    }
    if (ccImports.has('Vec3') || ccImports.has('Quat')) {
      lines.push('');
    }

    // Declarations (Enums, Interfaces, Classes)
    for (const decl of irUnit.declarations) {
      let declarationLines = [];
      if (decl.constructor.name === 'IREnum') {
        declarationLines = this.emitEnum(decl, irUnit);
      } else if (decl.constructor.name === 'IRInterface') {
        declarationLines = this.emitInterface(decl);
      } else if (decl.constructor.name === 'IRTypeAlias') {
        declarationLines = this.emitTypeAlias(decl);
      } else if (decl.constructor.name === 'IRClass') {
        declarationLines = this.emitClass(decl, irUnit);
      }
      for (const namespaceName of [...(decl.namespacePath || [])].reverse()) {
        declarationLines = [
          `export namespace ${namespaceName} {`,
          ...declarationLines.map(line => `  ${line}`),
          '}',
        ];
      }
      if (declarationLines.length > 0) lines.push(...declarationLines, '');
    }

    return lines.join('\n').trim() + '\n';
  }

  emitEnum(irEnum, irUnit) {
    const lines = [`export enum ${irEnum.name} {`];
    for (const m of irEnum.members) {
      lines.push(`  ${m.name} = ${typeof m.value === 'string' ? JSON.stringify(m.value) : m.value},`);
    }
    lines.push('}');
    if (irUnit && irUnit.registeredEnums && irUnit.registeredEnums.has(irEnum.name)) {
      lines.push(`Enum(${irEnum.name});`);
    }
    return lines;
  }

  emitInterface(irIface) {
    const lines = [`export interface ${irIface.name} {`];
    for (const property of irIface.properties) {
      lines.push(`  ${property.readonly ? 'readonly ' : ''}${property.name}: ${property.type};`);
    }
    for (const m of irIface.methods) {
      const params = m.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      lines.push(`  ${m.name}(${params}): ${m.returnType};`);
    }
    lines.push('}');
    return lines;
  }

  emitTypeAlias(irAlias) {
    const generics = irAlias.genericParams.length > 0 ? `<${irAlias.genericParams.join(', ')}>` : '';
    const params = irAlias.parameters.map(param => `${param.name}: ${param.type}`).join(', ');
    return [`export type ${irAlias.name}${generics} = (${params}) => ${irAlias.returnType};`];
  }

  emitClass(irClass, irUnit) {
    const lines = [];

    // Class decorators
    if (irClass.isCCClass) {
      lines.push(`@ccclass('${irClass.name}')`);
    }
    if (irClass.disallowMultiple) {
      lines.push('@disallowMultiple');
    }
    if (irClass.executeInEditMode) {
      lines.push('@executeInEditMode');
    }
    if (irClass.executionOrder !== null && irClass.executionOrder !== undefined) {
      lines.push(`@executionOrder(${irClass.executionOrder})`);
    }
    for (const req of irClass.requireComponents || []) {
      lines.push(`@requireComponent(${req})`);
    }

    const baseClause = irClass.baseClass ? ` extends ${irClass.baseClass}` : '';
    lines.push(`export class ${irClass.name}${baseClause} {`);

    // Fields
    for (const field of irClass.fields) {
      if (field.isEvent) {
        lines.push(`  public readonly ${field.name}: EventTarget = new EventTarget();`);
        lines.push('');
        continue;
      }

      if (field.isProperty) {
        const opts = field.propertyOptions || {};
        const optEntries = [];
        if (opts.type) optEntries.push(`type: ${opts.type}`);
        if (opts.tooltip) optEntries.push(`tooltip: '${opts.tooltip.replace(/'/g, "\\'")}'`);
        if (opts.min !== undefined) optEntries.push(`min: ${opts.min}`);
        if (opts.max !== undefined) optEntries.push(`max: ${opts.max}`);
        if (opts.slide) optEntries.push(`slide: true`);
        if (opts.visible !== undefined) optEntries.push(`visible: ${opts.visible}`);

        if (optEntries.length === 0) {
          lines.push(`  @property`);
        } else if (optEntries.length === 1 && opts.type && !opts.type.includes(':') && !opts.tooltip && opts.visible === undefined && opts.min === undefined && opts.max === undefined) {
          lines.push(`  @property(${opts.type})`);
        } else {
          lines.push(`  @property({ ${optEntries.join(', ')} })`);
        }
      }
      const mods = field.modifiers.join(' ');
      const init = field.initializer !== null ? ` = ${field.initializer}` : '';
      lines.push(`  ${mods} ${field.name}: ${field.type}${init};`);
      lines.push('');
    }

    // Properties (Getters / Setters)
    for (const prop of irClass.properties) {
      const staticModifier = prop.isStatic ? ' static' : '';
      const visibility = prop.modifiers.includes('private') ? 'private' : 'public';
      if (prop.expression) {
        lines.push(`  ${visibility}${staticModifier} get ${prop.name}(): ${prop.type} {`);
        lines.push(`    return ${prop.expression};`);
        lines.push(`  }`);
        lines.push('');
      } else if (prop.isAuto) {
        const init = prop.initializer !== null ? ` = ${prop.initializer}` : '';
        lines.push(`  ${visibility}${staticModifier} ${prop.name}: ${prop.type}${init};`);
        lines.push('');
      } else {
        if (prop.getter) {
          lines.push(`  ${visibility}${staticModifier} get ${prop.name}(): ${prop.type} {`);
          for (const stmt of prop.getter) lines.push(`    ${stmt}`);
          lines.push('  }');
          lines.push('');
        }
        if (prop.setter) {
          lines.push(`  ${visibility}${staticModifier} set ${prop.name}(value: ${prop.type}) {`);
          for (const stmt of prop.setter) lines.push(`    ${stmt}`);
          lines.push('  }');
          lines.push('');
        }
      }
    }

    // Constructors
    for (const ctor of irClass.constructors) {
      const params = ctor.parameters.map(p => `${p.name}: ${p.type}${p.defaultValue ? ' = ' + p.defaultValue : ''}`).join(', ');
      lines.push(`  constructor(${params}) {`);
      lines.push(`    super();`);
      for (const stmt of ctor.body) {
        lines.push(`    ${stmt}`);
      }
      lines.push(`  }`);
      lines.push('');
    }

    // Methods
    for (const method of irClass.methods) {
      if (method.contextMenu) {
        lines.push(`  // @contextMenu: ${method.contextMenu}`);
      }
      const isGenerator = method.isCoroutine ? '*' : '';
      const isAsync = method.isAsync ? 'async ' : '';
      const mods = method.isStatic ? 'public static ' : (method.modifiers.includes('private') ? 'private ' : 'public ');
      const params = method.parameters.map(p => `${p.name}: ${p.type}${p.defaultValue ? ' = ' + p.defaultValue : ''}`).join(', ');
      
      lines.push(`  ${mods}${isAsync}${isGenerator}${method.name}(${params}): ${method.returnType} {`);
      if (method.body.length === 0) {
        lines.push(`    // @MIGRATION_TODO: Verify empty implementation`);
      } else {
        for (const stmt of method.body) {
          lines.push(`    ${stmt}`);
        }
      }
      lines.push(`  }`);
      lines.push('');
    }

    lines.push('}');
    return lines;
  }
}

module.exports = {
  CocosEmitter,
};

