'use strict';

const { UNITY_3D_COLLIDER_DEPTH } = require('./constants');
const { finiteNumber } = require('./core-utils');

module.exports = function createColliderPorter(deps) {
  const {
    getField,
    parseUnityPolygonColliderPaths,
    boundsForUnityPolygonPaths,
    unityRefGuid,
    resolveUnityPhysicsMaterialUuid,
    resolveUnityBuiltinMeshUuid,
    resolveBuiltinPrimitiveMeshUuid,
    importedUnityAssetPath,
    copyUnityAssetToCocos,
    handleMissingModel,
    resolveLibraryAssetUuid,
  } = deps;

  function unityRefEquals(left, right) {
    if (!left || !right) return false;
    return String(left.fileID || '') === String(right.fileID || '')
      && String(unityRefGuid(left) || '') === String(unityRefGuid(right) || '');
  }

  function siblingMeshRendererMeshUuid(gameObject, model, builder, meshRef) {
    const meshFilterId = gameObject.components.find((id) => model.componentDocs.get(id)?.classId === 33);
    const meshFilter = meshFilterId ? model.componentDocs.get(meshFilterId) : null;
    const meshFilterRef = meshFilter ? getField(meshFilter, 'm_Mesh') : null;
    if (meshRef && meshFilterRef && !unityRefEquals(meshRef, meshFilterRef)) return '';

    const meshRendererId = gameObject.components.find((id) => model.componentDocs.get(id)?.classId === 23);
    const componentId = meshRendererId == null ? null : builder.componentMap.get(meshRendererId);
    const renderer = Number.isInteger(componentId) ? builder.objects[componentId] : null;
    return renderer?._mesh?.__uuid__ || '';
  }

  function resolveMeshColliderMeshUuid(meshRef, gameObject, model, builder, reporter, options, unityDb, cocosDb) {
    const siblingMeshUuid = siblingMeshRendererMeshUuid(gameObject, model, builder, meshRef);
    if (siblingMeshUuid) return siblingMeshUuid;

    const builtinMeshUuid = resolveUnityBuiltinMeshUuid ? resolveUnityBuiltinMeshUuid(meshRef, gameObject.name) : '';
    if (builtinMeshUuid) return builtinMeshUuid;

    const meshAsset = unityDb.get(unityRefGuid(meshRef));
    if (!meshAsset) return '';

    const resolved = cocosDb?.resolveModelMeshByStem
      ? cocosDb.resolveModelMeshByStem(meshAsset.stem, gameObject.name)
      : null;
    if (resolved?.meshUuid) return resolved.meshUuid;

    if (meshAsset.ext === '.asset') {
      const importedDest = importedUnityAssetPath ? importedUnityAssetPath(meshAsset, options) : '';
      if (importedDest) {
        const existingUuid = resolveLibraryAssetUuid(importedDest, options, 'cc.Mesh', { forceReload: true });
        if (existingUuid) return existingUuid;
      }
      if (copyUnityAssetToCocos) {
        const copiedDest = copyUnityAssetToCocos(meshAsset, options, reporter, 'model', 'medium', {
          deferNeedsImportReport: true,
          meshNameHint: gameObject.name,
        });
        if (copiedDest) {
          const copiedUuid = resolveLibraryAssetUuid(copiedDest, options, 'cc.Mesh', { forceReload: true });
          if (copiedUuid) return copiedUuid;
        }
      }
      if (resolveBuiltinPrimitiveMeshUuid) {
        const primitiveUuid = resolveBuiltinPrimitiveMeshUuid(gameObject.name, meshAsset.stem);
        if (primitiveUuid) return primitiveUuid;
      }
    }

    const missing = handleMissingModel
      ? handleMissingModel(meshAsset, reporter, options, { autoCopy: true, severity: 'low', meshNameHint: gameObject.name })
      : null;
    return missing?.resolved?.meshUuid || '';
  }

  function unityRigidBody2DTypeToCocosType(unityBodyType) {
    const value = Number(unityBodyType || 0);
    if (value === 2) return 2;
    if (value === 1) return 4;
    return 1;
  }

  function emitRigidbody2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    if (!model.is3DObject) {
      reporter.low('COMPONENT_UNSUPPORTED', model.file, gameObject.name, 'Unity Rigidbody2D is skipped because this prefab is not detected as a 3D object');
      return;
    }

    builder.addRigidBody(nodeId, componentId, {
      type: unityRigidBody2DTypeToCocosType(getField(doc, 'm_BodyType', 0)),
      mass: finiteNumber(getField(doc, 'm_Mass', 1), 1),
      linearDamping: finiteNumber(getField(doc, 'm_LinearDamping', getField(doc, 'm_LinearDrag', 0.1)), 0.1),
      angularDamping: finiteNumber(getField(doc, 'm_AngularDamping', getField(doc, 'm_AngularDrag', 0.1)), 0.1),
      useGravity: finiteNumber(getField(doc, 'm_GravityScale', 1), 1) !== 0,
      allowSleep: Number(getField(doc, 'm_SleepingMode', 1) || 0) !== 0,
    }, `cmp-rigid-body-${componentId}`);
  }

  function emitCircleCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    if (!model.is3DObject) {
      reporter.low('COMPONENT_UNSUPPORTED', model.file, gameObject.name, 'Unity CircleCollider2D is skipped because this prefab is not detected as a 3D object');
      return;
    }

    const offset = getField(doc, 'm_Offset', { x: 0, y: 0 });
    builder.addSphereCollider(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      center: {
        x: finiteNumber(offset?.x, 0),
        y: finiteNumber(offset?.y, 0),
        z: 0,
      },
      radius: Math.abs(finiteNumber(getField(doc, 'm_Radius', 0.5), 0.5)),
    }, `cmp-sphere-collider-${componentId}`);
  }

  function emitBoxCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    const offset = getField(doc, 'm_Offset', { x: 0, y: 0 });
    const size = getField(doc, 'm_Size', { x: 1, y: 1 });
    if (model.is3DObject) {
      builder.addBoxCollider(nodeId, componentId, {
        enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
        isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
        center: {
          x: finiteNumber(offset?.x, 0),
          y: finiteNumber(offset?.y, 0),
          z: 0,
        },
        size: {
          x: Math.abs(finiteNumber(size?.x, 1)),
          y: Math.abs(finiteNumber(size?.y, 1)),
          z: UNITY_3D_COLLIDER_DEPTH,
        },
      }, `cmp-box-collider-${componentId}`);
      return;
    }

    builder.addBoxCollider2D(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      sensor: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      offset: {
        x: finiteNumber(offset?.x, 0),
        y: finiteNumber(offset?.y, 0),
      },
      size: {
        x: Math.abs(finiteNumber(size?.x, 1)),
        y: Math.abs(finiteNumber(size?.y, 1)),
      },
    }, `cmp-box-collider-2d-${componentId}`);
  }

  function polygonPathArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += (Number(current?.x || 0) * Number(next?.y || 0)) - (Number(next?.x || 0) * Number(current?.y || 0));
    }
    return Math.abs(area * 0.5);
  }

  function emitPolygonCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    const offset = getField(doc, 'm_Offset', { x: 0, y: 0 });
    const paths = parseUnityPolygonColliderPaths(doc);
    if (model.is3DObject) {
      const bounds = boundsForUnityPolygonPaths(paths, offset) || {
        center: {
          x: finiteNumber(offset?.x, 0),
          y: finiteNumber(offset?.y, 0),
          z: 0,
        },
        size: {
          x: 1,
          y: 1,
          z: UNITY_3D_COLLIDER_DEPTH,
        },
      };

      builder.addBoxCollider(nodeId, componentId, {
        enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
        isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
        center: bounds.center,
        size: bounds.size,
      }, `cmp-box-collider-${componentId}`);

      reporter.low(
        'POLYGON_COLLIDER_2D_APPROXIMATED',
        model.file,
        gameObject.name,
        'Unity PolygonCollider2D was approximated as a Cocos BoxCollider because this prefab is detected as a 3D object',
        `size=(${bounds.size.x}, ${bounds.size.y}, ${bounds.size.z}) center=(${bounds.center.x}, ${bounds.center.y}, ${bounds.center.z})`,
      );
      return;
    }

    const points = [...paths]
      .sort((left, right) => polygonPathArea(right) - polygonPathArea(left))[0] || [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.5 },
        { x: -0.5, y: 0.5 },
      ];

    builder.addPolygonCollider2D(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      sensor: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      offset: {
        x: finiteNumber(offset?.x, 0),
        y: finiteNumber(offset?.y, 0),
      },
      points,
    }, `cmp-polygon-collider-2d-${componentId}`);
  }

  function emitMeshCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb, cocosDb) {
    const meshRef = getField(doc, 'm_Mesh', null);
    const meshUuid = resolveMeshColliderMeshUuid(meshRef, gameObject, model, builder, reporter, options, unityDb, cocosDb);
    const physicsMaterialAsset = unityDb.get(unityRefGuid(getField(doc, 'm_Material', null)));
    const physicsMaterialUuid = resolveUnityPhysicsMaterialUuid
      ? resolveUnityPhysicsMaterialUuid(physicsMaterialAsset, options, reporter, gameObject.name)
      : '';

    if (!meshUuid) {
      reporter.high('MESH_COLLIDER_UNRESOLVED', model.file, gameObject.name, 'Unity MeshCollider was ported without a resolved Cocos mesh');
    }

    builder.addMeshCollider(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      convex: Number(getField(doc, 'm_Convex', 0) || 0) !== 0,
      center: { x: 0, y: 0, z: 0 },
      meshUuid,
      materialUuid: physicsMaterialUuid,
    }, `cmp-mesh-collider-${componentId}`);
  }

  return {
    unityRigidBody2DTypeToCocosType,
    emitRigidbody2D,
    emitCircleCollider2D,
    emitBoxCollider2D,
    polygonPathArea,
    emitPolygonCollider2D,
    emitMeshCollider,
  };
};
