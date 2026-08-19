'use strict';

/**
 * Migration MCP Server Tools
 *
 * Implements Section 7.3 of the Migration Specification:
 * - get_cocos_api_signature(module, className, methodName)
 * - query_math_util(operation)
 * - get_component_migration_doc(unityComponent)
 * - get_engine_mismatch(concept)
 * - get_mapping_rule(unityApi)
 */

const { COCOS_API_CATALOG, COMPONENT_MIGRATION_MAP, getCocosApiSignature, queryMathUtil } = require('./cocos-api-catalog.cjs');
const { UnityApiCatalog } = require('./unity-api-catalog.cjs');
const { EngineMismatchDatabase, ENGINE_MISMATCH_ENTRIES } = require('./engine-mismatch-db.cjs');

const unityCatalog = new UnityApiCatalog();
const mismatchDb = new EngineMismatchDatabase();

/**
 * Returns exact Cocos 3.8.8+ API signature.
 * @param {string} module - Module name (e.g. 'cc')
 * @param {string} className - Class name (e.g. 'Vec3', 'Node')
 * @param {string} methodName - Optional method name (e.g. 'lerp', 'setPosition')
 */
function get_cocos_api_signature(module, className, methodName = '') {
  const catalogEntry = COCOS_API_CATALOG[className];
  if (!catalogEntry) {
    return {
      found: false,
      message: `No Cocos 3.8 API signature found for class '${className}' in module '${module || 'cc'}'`,
    };
  }

  if (methodName) {
    const sig = catalogEntry.staticMethods?.[methodName] || catalogEntry.methods?.[methodName] || catalogEntry.constants?.[methodName];
    return {
      found: !!sig,
      className,
      methodName,
      module: catalogEntry.module,
      signature: sig || null,
    };
  }

  return {
    found: true,
    className,
    module: catalogEntry.module,
    description: catalogEntry.description,
    staticMethods: catalogEntry.staticMethods || {},
    methods: catalogEntry.methods || {},
    constants: catalogEntry.constants || {},
  };
}

/**
 * Returns recommended math utility and zero-GC pattern.
 * @param {string} operation - Math operation name (e.g. 'lerp', 'slerp', 'dot', 'cross')
 */
function query_math_util(operation) {
  const matches = queryMathUtil(operation);
  const zeroGcScratchRecommendation = 'Use module-level _tempV3_0, _tempV3_1, or _tempQuat_0 as out parameter to avoid GC allocations in frame loops.';

  return {
    operation,
    matches,
    zeroGcRecommendation: zeroGcScratchRecommendation,
  };
}

/**
 * Returns migration documentation and best practices for a Unity component.
 * @param {string} unityComponent - Component name (e.g. 'Transform', 'Rigidbody', 'Image')
 */
function get_component_migration_doc(unityComponent) {
  const mapped = COMPONENT_MIGRATION_MAP[unityComponent];
  if (mapped) {
    return {
      unityComponent,
      cocosComponent: mapped.cocos,
      notes: mapped.notes,
      module: 'cc',
    };
  }

  return {
    unityComponent,
    cocosComponent: 'Component',
    notes: 'Generic custom component. Inherit from Component and apply @ccclass decorator.',
    module: 'cc',
  };
}

/**
 * Returns known mismatch information and remediation steps.
 * @param {string} concept - Concept or keyword (e.g. 'forward', 'coordinate', 'lifecycle', 'ui')
 */
function get_engine_mismatch(concept) {
  const report = mismatchDb.generateRemediationReport(concept);
  const directMatch = mismatchDb.queryByConcept(concept);

  return {
    query: concept,
    mismatchesFound: report.totalMismatches,
    items: report.mismatches,
    directMatch: directMatch || null,
  };
}

/**
 * Returns deterministic mapping rule for a Unity API.
 * @param {string} unityApi - Unity API call or symbol (e.g. 'Vector3.MoveTowards', 'Physics.Raycast')
 */
function get_mapping_rule(unityApi) {
  const entry = unityCatalog.lookup(unityApi);
  if (entry) {
    return {
      found: true,
      id: entry.id,
      category: entry.category,
      unityName: entry.unityName,
      cocosEquivalent: entry.cocosTarget ? entry.cocosTarget.target : '',
      cocosTarget: entry.cocosTarget,
      zeroGcAlternative: entry.zeroGcAlternative,
      notes: entry.semanticNotes,
      confidence: entry.confidence,
    };
  }

  return {
    found: false,
    message: `No deterministic rule registered for '${unityApi}'. Consult Engine Mismatch DB or write custom zero-GC adapter.`,
  };
}

module.exports = {
  get_cocos_api_signature,
  query_math_util,
  get_component_migration_doc,
  get_engine_mismatch,
  get_mapping_rule,
};
