'use strict';

/**
 * Cocos Creator 3.8.x registers decorated Component subclasses per TypeScript
 * module. More than one such class declared or re-exported by one module can
 * make the importer reject the script (for example with a null `_sealed`
 * class) and leave the preview without its custom components.
 *
 * This analyzer intentionally does not count every @ccclass. Serializable data
 * classes are valid. A class counts only when its extends-chain reaches a known
 * Component type imported from `cc`, including through local or relative-module
 * base classes.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const RULE_ID = 'COCOS_MULTIPLE_COMPONENTS';

// These are Cocos 3.8.8 exports whose runtime class derives from cc.Component
// (including public aliases such as Graphics/Mask/RichText). This list is kept
// in source so the gate is portable when a PC does not have the Editor's
// absolute .declarations path. The import binding is tracked, so a project-local
// class that merely has one of these names is not treated as a Cocos Component.
const COCOS_COMPONENT_EXPORTS = new Set([
  'Component',
  'Animation', 'AnimationController', 'SkeletalAnimation',
  'AudioSource',
  'ArmatureDisplay', 'Billboard', 'BlitScreen', 'Bloom', 'ColorGrading', 'DOF',
  'FSR', 'HBAO', 'PostProcess', 'PostProcessSetting', 'TAA',
  'BlockInputEvents', 'Button', 'Canvas', 'EditBox', 'Graphics', 'GraphicsComponent',
  'Label', 'LabelOutline', 'LabelShadow', 'Layout', 'Mask', 'MaskComponent',
  'MotionStreak', 'PageView', 'PageViewIndicator', 'ProgressBar', 'RichText',
  'RichTextComponent', 'SafeArea', 'ScrollBar', 'ScrollView', 'Slider', 'Sprite',
  'SubContextView', 'Toggle', 'ToggleContainer', 'UIComponent',
  'UICoordinateTracker', 'UIMeshRenderer', 'UIOpacity', 'UIRenderer', 'UISkew',
  'UIStaticBatch', 'UITransform', 'VideoPlayer', 'ViewGroup', 'WebView', 'Widget',
  'Camera', 'DirectionalLight', 'Light', 'LightProbeGroup', 'LODGroup',
  'MeshRenderer', 'MissingScript', 'ModelRenderer', 'PrefabLink', 'ReflectionProbe',
  'RenderRoot2D', 'Renderer', 'SkinnedMeshBatchRenderer', 'SkinnedMeshRenderer',
  'Sorting', 'Sorting2D', 'SphereLight', 'SpotLight', 'SpriteRenderer', 'Terrain',
  'ParticleSystem', 'ParticleSystem2D',
  'Collider', 'Collider2D', 'BoxCollider', 'BoxCollider2D', 'CapsuleCollider',
  'CircleCollider2D', 'ConeCollider', 'CylinderCollider', 'MeshCollider',
  'PolygonCollider2D', 'RigidBody', 'RigidBody2D', 'SphereCollider',
  'ConstantForce', 'DistanceJoint2D', 'FixedJoint2D', 'HingeJoint2D', 'Joint2D',
  'MouseJoint2D', 'RelativeJoint2D', 'SliderJoint2D', 'SpringJoint2D',
  'WheelJoint2D',
  'Skeleton', 'TiledLayer', 'TiledMap', 'TiledObjectGroup', 'TiledTile',
  'TiledUserNodeData',
]);

function canonicalFile(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function scriptKindFor(filePath) {
  return filePath.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function getNodeDecorators(node) {
  if (typeof ts.canHaveDecorators === 'function' && ts.canHaveDecorators(node)) {
    return ts.getDecorators(node) || [];
  }
  return (node.modifiers || []).filter((modifier) => modifier.kind === ts.SyntaxKind.Decorator);
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind));
}

function propertyPath(expression) {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const owner = propertyPath(expression.expression);
  return owner ? owner.concat(expression.name.text) : null;
}

function isCcDecoratorObject(expression, info) {
  if (ts.isIdentifier(expression)) return info.decoratorObjects.has(expression.text);
  const parts = propertyPath(expression);
  return Boolean(parts
    && parts.length === 2
    && info.ccNamespaces.has(parts[0])
    && parts[1] === '_decorator');
}

function isCcclassReference(expression, info) {
  if (ts.isIdentifier(expression)) return info.ccclassBindings.has(expression.text);
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'ccclass') return false;
  return isCcDecoratorObject(expression.expression, info);
}

function isCcclassDecorator(decorator, info) {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  return isCcclassReference(expression, info);
}

function resolveRelativeModule(importerFile, moduleSpecifier, modulesByFile) {
  if (!moduleSpecifier.startsWith('.')) return null;

  const unresolved = path.resolve(path.dirname(importerFile), moduleSpecifier);
  const extension = path.extname(unresolved).toLowerCase();
  const bases = [unresolved];
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    bases.push(unresolved.slice(0, -extension.length));
  }

  const candidates = [];
  for (const base of bases) {
    candidates.push(base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx'));
  }
  for (const candidate of candidates) {
    const match = modulesByFile.get(canonicalFile(candidate));
    if (match) return match.filePath;
  }
  return null;
}

function collectModule(filePath, projectRoot) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const info = {
    filePath: path.resolve(filePath),
    relPath: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
    sourceFile,
    ccComponentBindings: new Set(),
    ccNamespaces: new Set(),
    decoratorObjects: new Set(),
    ccclassBindings: new Set(),
    relativeImports: new Map(),
    relativeNamespaces: new Map(),
    pendingRelativeImports: [],
    pendingRelativeNamespaces: [],
    variableDeclarations: [],
    localClasses: new Map(),
    exportedClasses: new Map(),
    pendingLocalExports: [],
    pendingReexports: [],
    pendingStarExports: [],
    reexports: [],
    starExports: [],
    classes: [],
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.importClause) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (specifier === 'cc') {
        if (clause.name) {
          // `cc` does not have a useful default export, but retaining the name
          // as a namespace makes legacy transpiled declarations analyzable.
          info.ccNamespaces.add(clause.name.text);
        }
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          info.ccNamespaces.add(clause.namedBindings.name.text);
        } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const imported = element.propertyName ? element.propertyName.text : element.name.text;
            const local = element.name.text;
            if (COCOS_COMPONENT_EXPORTS.has(imported)) info.ccComponentBindings.add(local);
            if (imported === '_decorator') info.decoratorObjects.add(local);
            if (imported === 'ccclass') info.ccclassBindings.add(local);
          }
        }
      } else if (specifier.startsWith('.')) {
        if (clause.name) {
          info.pendingRelativeImports.push({ local: clause.name.text, imported: 'default', specifier });
        }
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          info.pendingRelativeNamespaces.push({ local: clause.namedBindings.name.text, specifier });
        } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            info.pendingRelativeImports.push({
              local: element.name.text,
              imported: element.propertyName ? element.propertyName.text : element.name.text,
              specifier,
            });
          }
        }
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      info.variableDeclarations.push(...statement.declarationList.declarations);
      continue;
    }

    if (ts.isClassDeclaration(statement)) {
      const sourcePosition = statement.name ? statement.name.getStart(sourceFile) : statement.getStart(sourceFile);
      const location = sourceFile.getLineAndCharacterOfPosition(sourcePosition);
      const className = statement.name ? statement.name.text : `<default@${location.line + 1}>`;
      const extendsClause = statement.heritageClauses
        ? statement.heritageClauses.find((clauseNode) => clauseNode.token === ts.SyntaxKind.ExtendsKeyword)
        : null;
      const record = {
        info,
        node: statement,
        name: className,
        line: location.line + 1,
        baseExpression: extendsClause && extendsClause.types.length > 0
          ? extendsClause.types[0].expression
          : null,
        decorated: false,
      };
      info.classes.push(record);
      if (statement.name) info.localClasses.set(statement.name.text, record);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
        info.exportedClasses.set(statement.name.text, record);
      }
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        info.exportedClasses.set('default', record);
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const location = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
      const line = location.line + 1;
      if (!statement.moduleSpecifier
        && statement.exportClause
        && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          info.pendingLocalExports.push({
            local: element.propertyName ? element.propertyName.text : element.name.text,
            exported: element.name.text,
            line,
          });
        }
      } else if (statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text.startsWith('.')) {
        const specifier = statement.moduleSpecifier.text;
        if (!statement.exportClause) {
          info.pendingStarExports.push({ specifier, line });
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            info.pendingReexports.push({
              imported: element.propertyName ? element.propertyName.text : element.name.text,
              exported: element.name.text,
              specifier,
              line,
            });
          }
        }
      }
    }
  }

  return info;
}

function collectDecoratorBindings(info) {
  // Resolve simple aliases and destructuring in a fixed point so patterns such
  // as `const decorators = _decorator; const { ccclass } = decorators;` work.
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of info.variableDeclarations) {
      if (!declaration.initializer) continue;
      if (ts.isIdentifier(declaration.name)) {
        if (isCcDecoratorObject(declaration.initializer, info)
          && !info.decoratorObjects.has(declaration.name.text)) {
          info.decoratorObjects.add(declaration.name.text);
          changed = true;
        }
        if (isCcclassReference(declaration.initializer, info)
          && !info.ccclassBindings.has(declaration.name.text)) {
          info.ccclassBindings.add(declaration.name.text);
          changed = true;
        }
        continue;
      }
      if (!ts.isObjectBindingPattern(declaration.name)
        || !isCcDecoratorObject(declaration.initializer, info)) continue;
      for (const element of declaration.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const imported = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : element.name.text;
        if (imported === 'ccclass' && !info.ccclassBindings.has(element.name.text)) {
          info.ccclassBindings.add(element.name.text);
          changed = true;
        }
      }
    }
  }

  for (const record of info.classes) {
    record.decorated = getNodeDecorators(record.node)
      .some((decorator) => isCcclassDecorator(decorator, info));
  }
}

function resolveImports(info, modulesByFile) {
  for (const pending of info.pendingRelativeImports) {
    const targetFile = resolveRelativeModule(info.filePath, pending.specifier, modulesByFile);
    if (targetFile) info.relativeImports.set(pending.local, { targetFile, imported: pending.imported });
  }
  for (const pending of info.pendingRelativeNamespaces) {
    const targetFile = resolveRelativeModule(info.filePath, pending.specifier, modulesByFile);
    if (targetFile) info.relativeNamespaces.set(pending.local, targetFile);
  }
  for (const pending of info.pendingReexports) {
    const targetFile = resolveRelativeModule(info.filePath, pending.specifier, modulesByFile);
    if (targetFile) info.reexports.push({ ...pending, targetFile });
  }
  for (const pending of info.pendingStarExports) {
    const targetFile = resolveRelativeModule(info.filePath, pending.specifier, modulesByFile);
    if (targetFile) info.starExports.push({ ...pending, targetFile });
  }
}

function resolveNamedExportRecords(info, exportName, modulesByFile, memo, visiting) {
  const key = `${canonicalFile(info.filePath)}::${exportName}`;
  if (memo.has(key)) return memo.get(key);
  if (visiting.has(key)) return new Set();
  visiting.add(key);

  const records = new Set();
  const direct = info.exportedClasses.get(exportName);
  if (direct) records.add(direct);

  for (const pending of info.pendingLocalExports) {
    if (pending.exported !== exportName) continue;
    const local = info.localClasses.get(pending.local);
    if (local) {
      records.add(local);
      continue;
    }
    const imported = info.relativeImports.get(pending.local);
    if (!imported) continue;
    const target = modulesByFile.get(canonicalFile(imported.targetFile));
    if (!target) continue;
    for (const record of resolveNamedExportRecords(target, imported.imported, modulesByFile, memo, visiting)) {
      records.add(record);
    }
  }

  for (const edge of info.reexports) {
    if (edge.exported !== exportName) continue;
    const target = modulesByFile.get(canonicalFile(edge.targetFile));
    if (!target) continue;
    for (const record of resolveNamedExportRecords(target, edge.imported, modulesByFile, memo, visiting)) {
      records.add(record);
    }
  }

  if (exportName !== 'default') {
    for (const edge of info.starExports) {
      const target = modulesByFile.get(canonicalFile(edge.targetFile));
      if (!target) continue;
      for (const record of resolveNamedExportRecords(target, exportName, modulesByFile, memo, visiting)) {
        records.add(record);
      }
    }
  }

  visiting.delete(key);
  memo.set(key, records);
  return records;
}

function collectAllExportedRecords(info, modulesByFile, memo, visiting, includeDefault = true) {
  const key = `${canonicalFile(info.filePath)}::${includeDefault ? 'all' : 'named'}`;
  if (memo.has(key)) return memo.get(key);
  if (visiting.has(key)) return new Set();
  visiting.add(key);

  const records = new Set();
  for (const [exportName, record] of info.exportedClasses) {
    if (includeDefault || exportName !== 'default') records.add(record);
  }
  for (const pending of info.pendingLocalExports) {
    if (!includeDefault && pending.exported === 'default') continue;
    const local = info.localClasses.get(pending.local);
    if (local) {
      records.add(local);
      continue;
    }
    const imported = info.relativeImports.get(pending.local);
    if (!imported) continue;
    const target = modulesByFile.get(canonicalFile(imported.targetFile));
    if (!target) continue;
    for (const record of resolveNamedExportRecords(target, imported.imported, modulesByFile, memo, visiting)) {
      records.add(record);
    }
  }
  for (const edge of info.reexports) {
    if (!includeDefault && edge.exported === 'default') continue;
    const target = modulesByFile.get(canonicalFile(edge.targetFile));
    if (!target) continue;
    for (const record of resolveNamedExportRecords(target, edge.imported, modulesByFile, memo, visiting)) {
      records.add(record);
    }
  }
  for (const edge of info.starExports) {
    const target = modulesByFile.get(canonicalFile(edge.targetFile));
    if (!target) continue;
    for (const record of collectAllExportedRecords(target, modulesByFile, memo, visiting, false)) {
      records.add(record);
    }
  }

  visiting.delete(key);
  memo.set(key, records);
  return records;
}

function resolveBaseRecord(record, modulesByFile, exportMemo) {
  const expression = record.baseExpression;
  if (!expression) return { componentSeed: false, record: null };

  if (ts.isIdentifier(expression)) {
    if (record.info.ccComponentBindings.has(expression.text)) {
      return { componentSeed: true, record: null };
    }
    const local = record.info.localClasses.get(expression.text);
    if (local) return { componentSeed: false, record: local };
    const imported = record.info.relativeImports.get(expression.text);
    if (imported) {
      const target = modulesByFile.get(canonicalFile(imported.targetFile));
      const matches = target
        ? resolveNamedExportRecords(target, imported.imported, modulesByFile, exportMemo, new Set())
        : new Set();
      return {
        componentSeed: false,
        record: matches.values().next().value || null,
      };
    }
    return { componentSeed: false, record: null };
  }

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const owner = expression.expression.text;
    const member = expression.name.text;
    if (record.info.ccNamespaces.has(owner) && COCOS_COMPONENT_EXPORTS.has(member)) {
      return { componentSeed: true, record: null };
    }
    const targetFile = record.info.relativeNamespaces.get(owner);
    if (targetFile) {
      const target = modulesByFile.get(canonicalFile(targetFile));
      const matches = target
        ? resolveNamedExportRecords(target, member, modulesByFile, exportMemo, new Set())
        : new Set();
      return {
        componentSeed: false,
        record: matches.values().next().value || null,
      };
    }
  }

  return { componentSeed: false, record: null };
}

function isComponentRecord(record, modulesByFile, memo, visiting, exportMemo) {
  if (memo.has(record)) return memo.get(record);
  if (visiting.has(record)) return false;
  visiting.add(record);
  const base = resolveBaseRecord(record, modulesByFile, exportMemo);
  const result = base.componentSeed
    || Boolean(base.record && isComponentRecord(base.record, modulesByFile, memo, visiting, exportMemo));
  visiting.delete(record);
  memo.set(record, result);
  return result;
}

function formatBase(record) {
  if (!record.baseExpression) return '(none)';
  return record.baseExpression.getText(record.info.sourceFile);
}

function lintCocosComponentModules(filePaths, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const modulesByFile = new Map();
  for (const filePath of filePaths) {
    if (!/\.tsx?$/i.test(filePath) || /\.d\.ts$/i.test(filePath)) continue;
    const info = collectModule(path.resolve(filePath), projectRoot);
    modulesByFile.set(canonicalFile(info.filePath), info);
  }

  for (const info of modulesByFile.values()) {
    collectDecoratorBindings(info);
    resolveImports(info, modulesByFile);
  }

  const memo = new Map();
  const exportMemo = new Map();
  const violations = [];
  for (const info of modulesByFile.values()) {
    const foundByRecord = new Map();
    for (const record of info.classes) {
      if (record.decorated
        && isComponentRecord(record, modulesByFile, memo, new Set(), exportMemo)) {
        foundByRecord.set(record, { record, line: record.line });
      }
    }
    const addExported = (records, line) => {
      for (const record of records) {
        if (!record.decorated
          || !isComponentRecord(record, modulesByFile, memo, new Set(), exportMemo)) continue;
        if (!foundByRecord.has(record)) foundByRecord.set(record, { record, line });
      }
    };
    for (const pending of info.pendingLocalExports) {
      const imported = info.relativeImports.get(pending.local);
      if (!imported) continue;
      const target = modulesByFile.get(canonicalFile(imported.targetFile));
      if (!target) continue;
      addExported(
        resolveNamedExportRecords(target, imported.imported, modulesByFile, exportMemo, new Set()),
        pending.line,
      );
    }
    for (const edge of info.reexports) {
      const target = modulesByFile.get(canonicalFile(edge.targetFile));
      if (!target) continue;
      addExported(
        resolveNamedExportRecords(target, edge.imported, modulesByFile, exportMemo, new Set()),
        edge.line,
      );
    }
    for (const edge of info.starExports) {
      const target = modulesByFile.get(canonicalFile(edge.targetFile));
      if (!target) continue;
      addExported(
        collectAllExportedRecords(target, modulesByFile, exportMemo, new Set(), false),
        edge.line,
      );
    }

    const found = [...foundByRecord.values()];
    if (found.length < 2) continue;
    const names = found.map((entry) => entry.record.name).join(', ');
    for (const entry of found.slice(1)) {
      const record = entry.record;
      violations.push({
        file: info.relPath,
        line: entry.line,
        rule: RULE_ID,
        severity: 'error',
        message: `Module declares or re-exports ${found.length} @ccclass Component subclasses (${names}). Cocos Creator 3.8.x may reject the module and expose a null _sealed class. Keep exactly one decorated Component per concrete TypeScript module, put a shared base in its own file, and keep marker/barrel modules Component-free. Consumers must import concrete modules directly. @ccclass data classes that do not inherit cc.Component are allowed.`,
        snippet: `class ${record.name} extends ${formatBase(record)}`,
      });
    }
  }
  return violations;
}

module.exports = {
  COCOS_COMPONENT_EXPORTS,
  RULE_ID,
  lintCocosComponentModules,
};
