'use strict';

const { isBuiltinGuid } = require('./guid-index.cjs');

function addToMapSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function buildDependencyGraph(records, guidIndex, options = {}) {
  const edgeGroups = new Map();
  const outgoing = new Map();
  const assetOutgoing = new Map();
  const codeOutgoing = new Map();
  const incoming = new Map();
  const unresolvedGroups = new Map();
  const recordByPath = new Map(records.map(record => [record.assetPath, record]));

  for (const record of records) {
    const references = record.referenceEvidence || (record.references || []).map(guid => ({
      guid,
      kind: 'asset',
      objectId: null,
      classId: null,
      fieldPath: null,
      line: null,
      provider: 'asset',
      resolution: 'exact',
    }));
    for (const reference of references) {
      const guid = reference.guid;
      const target = guidIndex.byGuid.get(guid);
      if (!target) {
        const key = `${guid}\0${record.assetPath}`;
        if (!unresolvedGroups.has(key)) {
          unresolvedGroups.set(key, {
            guid,
            source: record.assetPath,
            sourceScope: record.scope,
            sourceOrigin: record.origin || 'project',
            kinds: new Set(),
            fields: new Set(),
            occurrences: 0,
            builtin: isBuiltinGuid(guid),
          });
        }
        const item = unresolvedGroups.get(key);
        item.kinds.add(reference.kind || 'asset');
        if (reference.fieldPath) item.fields.add(reference.fieldPath);
        item.occurrences += 1;
        continue;
      }
      if (target.assetPath === record.assetPath) continue;
      const edgeKey = [
        record.assetPath,
        target.assetPath,
        guid,
        reference.kind || 'asset',
        reference.objectId || '',
        reference.fieldPath || '',
        reference.provider || 'static',
      ].join('\0');
      if (!edgeGroups.has(edgeKey)) {
        edgeGroups.set(edgeKey, {
          from: record.assetPath,
          to: target.assetPath,
          guid,
          kind: reference.kind || 'asset',
          resolution: reference.resolution || 'exact',
          objectId: reference.objectId || null,
          classId: Number.isInteger(reference.classId) ? reference.classId : null,
          fieldPath: reference.fieldPath || null,
          occurrences: 0,
          provider: reference.provider || 'static',
          evidenceLines: [],
        });
      }
      const edge = edgeGroups.get(edgeKey);
      edge.occurrences += 1;
      if (Number.isInteger(reference.line) && edge.evidenceLines.length < 3 &&
          !edge.evidenceLines.includes(reference.line)) edge.evidenceLines.push(reference.line);
      addToMapSet(outgoing, edge.from, edge.to);
      addToMapSet(assetOutgoing, edge.from, edge.to);
      addToMapSet(incoming, edge.to, edge.from);
    }
  }

  const scriptIndex = options.scriptIndex;
  let ambiguousCodeReferences = 0;
  if (scriptIndex && Array.isArray(scriptIndex.scripts)) {
    const scriptByPath = new Map(scriptIndex.scripts.map(script => [script.assetPath, script]));
    for (const script of scriptIndex.scripts) {
      if (script.scope !== 'runtime' || script.editorOnly) continue;
      for (const typeName of script.referencedProjectTypes || []) {
        const eligibleTargets = (scriptIndex.typeDeclarations[typeName] || [])
          .map(targetPath => scriptByPath.get(targetPath))
          .filter(target => target && target.scope === 'runtime' && !target.editorOnly);
        const sameAssembly = eligibleTargets.filter(target => target.assembly === script.assembly);
        const targets = sameAssembly.length ? sameAssembly : eligibleTargets;
        if (targets.length > 8) {
          ambiguousCodeReferences += 1;
          continue;
        }
        for (const targetScript of targets) {
          const targetPath = targetScript.assetPath;
          if (targetPath === script.assetPath) continue;
          const target = recordByPath.get(targetPath);
          const edgeKey = [script.assetPath, targetPath, target?.guid || '', 'code-type-reference', '', typeName,
            'csharp-lexical'].join('\0');
          if (!edgeGroups.has(edgeKey)) {
            edgeGroups.set(edgeKey, {
              from: script.assetPath,
              to: targetPath,
              guid: target?.guid || null,
              kind: 'code-type-reference',
              resolution: 'heuristic',
              objectId: null,
              classId: null,
              fieldPath: typeName,
              occurrences: 1,
              provider: 'csharp-lexical',
              evidenceLines: [],
            });
          }
          addToMapSet(outgoing, script.assetPath, targetPath);
          addToMapSet(codeOutgoing, script.assetPath, targetPath);
          addToMapSet(incoming, targetPath, script.assetPath);
        }
      }
    }
  }

  const edges = [...edgeGroups.values()].sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to) ||
    a.kind.localeCompare(b.kind) || String(a.fieldPath).localeCompare(String(b.fieldPath)));

  function distancesFrom(startPaths, distanceOptions = {}) {
    const maxCodeDepth = Number.isInteger(distanceOptions.maxCodeDepth)
      ? Math.max(0, distanceOptions.maxCodeDepth)
      : 2;
    const distances = new Map();
    const codeDepths = new Map();
    const queue = [];
    for (const start of startPaths) {
      if (!start || distances.has(start)) continue;
      distances.set(start, 0);
      codeDepths.set(start, 0);
      queue.push({ path: start, codeDepth: 0 });
    }
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentState = queue[cursor];
      const current = currentState.path;
      const depth = distances.get(current);
      for (const next of assetOutgoing.get(current) || []) {
        const nextDepth = currentState.codeDepth;
        if (distances.has(next) && codeDepths.get(next) <= nextDepth) continue;
        if (!distances.has(next)) distances.set(next, depth + 1);
        codeDepths.set(next, nextDepth);
        queue.push({ path: next, codeDepth: nextDepth });
      }
      if (currentState.codeDepth >= maxCodeDepth) continue;
      for (const next of codeOutgoing.get(current) || []) {
        const nextDepth = currentState.codeDepth + 1;
        if (distances.has(next) && codeDepths.get(next) <= nextDepth) continue;
        if (!distances.has(next)) distances.set(next, depth + 1);
        codeDepths.set(next, nextDepth);
        queue.push({ path: next, codeDepth: nextDepth });
      }
    }
    return distances;
  }

  function classifiedUnresolved(reachablePaths = new Set(), packageAssetsAvailable = true) {
    const grouped = new Map();
    const priority = new Map([
      ['builtin', 0],
      ['non-runtime', 1],
      ['unreachable', 2],
      ['package-or-dll', 3],
      ['reachable-ambiguous', 4],
      ['reachable-missing', 5],
    ]);
    for (const item of unresolvedGroups.values()) {
      const reachable = reachablePaths.has(item.source);
      const category = item.builtin
        ? 'builtin'
        : reachable
          ? (packageAssetsAvailable
            ? 'reachable-missing'
            : item.kinds.has('script') ? 'package-or-dll' : 'reachable-ambiguous')
          : item.sourceScope !== 'runtime'
            ? 'non-runtime'
            : 'unreachable';
      if (!grouped.has(item.guid)) {
        grouped.set(item.guid, {
          guid: item.guid,
          category,
          occurrences: 0,
          sources: [],
          sourceEvidence: [],
          kinds: new Set(),
          fields: new Set(),
        });
      }
      const entry = grouped.get(item.guid);
      const categoryPriority = priority.get(category) || 0;
      const entryPriority = priority.get(entry.category) || 0;
      const evidence = {
        source: item.source,
        category,
        kinds: [...item.kinds].sort(),
        fields: [...item.fields].sort().slice(0, 5),
        occurrences: item.occurrences,
      };
      if (categoryPriority > entryPriority) {
        // When a later source raises the GUID to a more important category,
        // discard lower-priority samples so the bounded list always retains
        // at least one gameplay-reachable source for live edge restoration.
        entry.category = category;
        entry.sources = [item.source];
        entry.sourceEvidence = [evidence];
      } else if (categoryPriority === entryPriority && !entry.sources.includes(item.source) && entry.sources.length < 5) {
        entry.sources.push(item.source);
        entry.sourceEvidence.push(evidence);
      }
      for (const kind of item.kinds) entry.kinds.add(kind);
      for (const field of item.fields) entry.fields.add(field);
      entry.occurrences += item.occurrences;
    }
    return [...grouped.values()]
      .map(entry => ({
        ...entry,
        sources: entry.sources.sort(),
        sourceEvidence: entry.sourceEvidence.sort((left, right) => left.source.localeCompare(right.source)),
        kinds: [...entry.kinds].sort(),
        fields: [...entry.fields].sort().slice(0, 5),
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.guid.localeCompare(b.guid));
  }

  return {
    edges,
    outgoing,
    assetOutgoing,
    codeOutgoing,
    incoming,
    unresolved: unresolvedGroups,
    distancesFrom,
    toJSON(options = {}) {
      const allUnresolved = classifiedUnresolved(
        options.reachablePaths || new Set(),
        options.packageAssetsAvailable !== false,
      );
      const unresolved = allUnresolved.filter(entry => entry.category !== 'builtin');
      const builtins = allUnresolved.filter(entry => entry.category === 'builtin');
      const classificationCounts = {};
      for (const entry of allUnresolved) {
        classificationCounts[entry.category] = (classificationCounts[entry.category] || 0) + 1;
      }
      return {
        edgeCount: edges.length,
        edges,
        unresolvedCount: unresolved.length,
        unresolved,
        builtinCount: builtins.length,
        builtins,
        classificationCounts,
        codeGraph: {
          maxDepthDefault: 2,
          ambiguousReferencesSkipped: ambiguousCodeReferences,
        },
      };
    },
  };
}

module.exports = { buildDependencyGraph };
