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

    const sortedCcImports = Array.from(ccImports).sort();
    lines.push(`import { ${sortedCcImports.join(', ')} } from 'cc';`);

    // Shared compat layer import if needed
    if (irUnit.scratchVariables.has('UnityMathf') || irUnit.scratchVariables.has('UnityTime') || irUnit.scratchVariables.has('UnityRandom') || irUnit.scratchVariables.has('UnityCoroutine')) {
      lines.push(`import { UnityMathf, UnityTime, UnityRandom, UnityCoroutine } from './shared/compat';`);
    }
    lines.push('');

    // Decorator aliases
    lines.push('const { ccclass, property } = _decorator;');
    lines.push('');

    // Module-level Scratch Variables (Zero-GC Rule)
    if (ccImports.has('Vec3')) {
      lines.push('const _tempVec3 = new Vec3();');
    }
    if (ccImports.has('Quat')) {
      lines.push('const _tempQuat = new Quat();');
    }
    if (ccImports.has('Vec3') || ccImports.has('Quat')) {
      lines.push('');
    }

    // Declarations (Enums, Interfaces, Classes)
    for (const decl of irUnit.declarations) {
      let declarationLines = [];
      if (decl.constructor.name === 'IREnum') {
        declarationLines = this.emitEnum(decl);
      } else if (decl.constructor.name === 'IRInterface') {
        declarationLines = this.emitInterface(decl);
      } else if (decl.constructor.name === 'IRTypeAlias') {
        declarationLines = this.emitTypeAlias(decl);
      } else if (decl.constructor.name === 'IRClass') {
        declarationLines = this.emitClass(decl);
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

  emitEnum(irEnum) {
    const lines = [`export enum ${irEnum.name} {`];
    for (const m of irEnum.members) {
      lines.push(`  ${m.name} = ${typeof m.value === 'string' ? JSON.stringify(m.value) : m.value},`);
    }
    lines.push('}');
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

  emitClass(irClass) {
    const lines = [];

    // @ccclass decorator
    if (irClass.isCCClass) {
      lines.push(`@ccclass('${irClass.name}')`);
    }

    const baseClause = irClass.baseClass ? ` extends ${irClass.baseClass}` : '';
    lines.push(`export class ${irClass.name}${baseClause} {`);

    // Fields
    for (const field of irClass.fields) {
      if (field.isProperty) {
        if (field.propertyOptions && field.propertyOptions.type) {
          lines.push(`  @property(${field.propertyOptions.type})`);
        } else {
          lines.push(`  @property`);
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
