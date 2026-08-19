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
      reporter.medium('COMPONENT_UNSUPPORTED', model.file, gameObject.name, 'Unity Rigidbody2D is skipped because this prefab is not detected as a 3D object - can nguoi quyet dinh: dung RigidBody2D cua Cocos hay bo vat ly');
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

  // Unity Rigidbody (class 54). cc.ERigidBodyType: DYNAMIC 1, STATIC 2, KINEMATIC 4.
  function emitRigidbody(nodeId, componentId, doc, builder) {
    const isKinematic = Number(getField(doc, 'm_IsKinematic', 0) || 0) !== 0;
    const constraints = Number(getField(doc, 'm_Constraints', 0) || 0);
    const collisionDetection = Number(getField(doc, 'm_CollisionDetection', 0) || 0);

    // Freeze Position: X=2, Y=4, Z=8
    const freezePosX = (constraints & 2) !== 0;
    const freezePosY = (constraints & 4) !== 0;
    const freezePosZ = (constraints & 8) !== 0;
    const linearFactor = {
      x: freezePosX ? 0 : 1,
      y: freezePosY ? 0 : 1,
      z: freezePosZ ? 0 : 1,
    };

    // Freeze Rotation: X=16, Y=32, Z=64
    const freezeRotX = (constraints & 16) !== 0;
    const freezeRotY = (constraints & 32) !== 0;
    const freezeRotZ = (constraints & 64) !== 0;
    const angularFactor = {
      x: freezeRotX ? 0 : 1,
      y: freezeRotY ? 0 : 1,
      z: freezeRotZ ? 0 : 1,
    };

    builder.addRigidBody(nodeId, componentId, {
      type: isKinematic ? 4 : 1,
      mass: finiteNumber(getField(doc, 'm_Mass', 1), 1),
      linearDamping: finiteNumber(getField(doc, 'm_Drag', 0), 0),
      angularDamping: finiteNumber(getField(doc, 'm_AngularDrag', 0.05), 0.05),
      useGravity: Number(getField(doc, 'm_UseGravity', 1) || 0) !== 0,
      linearFactor,
      angularFactor,
      useCCD: collisionDetection > 0,
      allowSleep: true,
    }, `cmp-rigid-body-${componentId}`);
  }

  // Unity CharacterController (class 143)
  function emitCharacterController(nodeId, componentId, doc, gameObject, model, builder) {
    const center = getField(doc, 'm_Center', { x: 0, y: 0, z: 0 });
    const radius = Math.abs(finiteNumber(getField(doc, 'm_Radius', 0.5), 0.5));
    const height = Math.abs(finiteNumber(getField(doc, 'm_Height', 2.0), 2.0));
    const slopeLimit = finiteNumber(getField(doc, 'm_SlopeLimit', 45.0), 45.0);
    const stepOffset = Math.abs(finiteNumber(getField(doc, 'm_StepOffset', 0.3), 0.3));
    const skinWidth = Math.abs(finiteNumber(getField(doc, 'm_SkinWidth', 0.08), 0.08));
    const minMoveDistance = Math.abs(finiteNumber(getField(doc, 'm_MinMoveDistance', 0.001), 0.001));

    builder.addCharacterController(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      center: {
        x: finiteNumber(center?.x, 0),
        y: finiteNumber(center?.y, 0),
        z: finiteNumber(center?.z, 0),
      },
      radius,
      height,
      slopeLimit,
      stepOffset,
      skinWidth,
      minMoveDistance,
    }, `cmp-character-controller-${componentId}`);
  }

  // Unity SphereCollider (class 135).
  function emitSphereCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb) {
    const center = getField(doc, 'm_Center', { x: 0, y: 0, z: 0 });
    const physicsMaterialAsset = unityDb?.get ? unityDb.get(unityRefGuid(getField(doc, 'm_Material', null))) : null;
    const physicsMaterialUuid = resolveUnityPhysicsMaterialUuid && physicsMaterialAsset
      ? resolveUnityPhysicsMaterialUuid(physicsMaterialAsset, options, reporter, gameObject?.name || '')
      : '';

    builder.addSphereCollider(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      center: {
        x: finiteNumber(center?.x, 0),
        y: finiteNumber(center?.y, 0),
        z: finiteNumber(center?.z, 0),
      },
      radius: Math.abs(finiteNumber(getField(doc, 'm_Radius', 0.5), 0.5)),
      materialUuid: physicsMaterialUuid,
    }, `cmp-sphere-collider-${componentId}`);
  }

  // Unity CapsuleCollider (class 136).
  function emitCapsuleCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb) {
    const center = getField(doc, 'm_Center', { x: 0, y: 0, z: 0 });
    const radius = Math.abs(finiteNumber(getField(doc, 'm_Radius', 0.5), 0.5));
    const height = Math.abs(finiteNumber(getField(doc, 'm_Height', 2.0), 2.0));
    const direction = Number(getField(doc, 'm_Direction', 1) || 1); // 0: X, 1: Y, 2: Z
    const cylinderHeight = Math.max(0, height - 2 * radius);
    const physicsMaterialAsset = unityDb?.get ? unityDb.get(unityRefGuid(getField(doc, 'm_Material', null))) : null;
    const physicsMaterialUuid = resolveUnityPhysicsMaterialUuid && physicsMaterialAsset
      ? resolveUnityPhysicsMaterialUuid(physicsMaterialAsset, options, reporter, gameObject?.name || '')
      : '';

    builder.addCapsuleCollider(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      center: {
        x: finiteNumber(center?.x, 0),
        y: finiteNumber(center?.y, 0),
        z: finiteNumber(center?.z, 0),
      },
      radius: radius,
      cylinderHeight: cylinderHeight,
      direction: direction,
      materialUuid: physicsMaterialUuid,
    }, `cmp-capsule-collider-${componentId}`);
  }

  function emitCircleCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    if (!model.is3DObject) {
      const offset = getField(doc, 'm_Offset', { x: 0, y: 0 });
      builder.addCircleCollider2D(nodeId, componentId, {
        enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
        sensor: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
        offset: {
          x: finiteNumber(offset?.x, 0),
          y: finiteNumber(offset?.y, 0),
        },
        radius: Math.abs(finiteNumber(getField(doc, 'm_Radius', 0.5), 0.5)),
      }, `cmp-circle-collider-2d-${componentId}`);
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

  function emitCapsuleCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    const offset = getField(doc, 'm_Offset', { x: 0, y: 0 });
    const size = getField(doc, 'm_Size', { x: 1, y: 2 });
    const direction = Number(getField(doc, 'm_Direction', 0) || 0); // 0: Vertical, 1: Horizontal
    const isVertical = direction === 0;

    if (model.is3DObject) {
      const radius = isVertical ? (size.x * 0.5) : (size.y * 0.5);
      const height = isVertical ? size.y : size.x;
      const cylinderHeight = Math.max(0, height - 2 * radius);

      builder.addCapsuleCollider(nodeId, componentId, {
        enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
        isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
        center: {
          x: finiteNumber(offset?.x, 0),
          y: finiteNumber(offset?.y, 0),
          z: 0,
        },
        radius: Math.max(0.01, radius),
        cylinderHeight: Math.max(0, cylinderHeight),
        direction: isVertical ? 1 : 0,
      }, `cmp-capsule-collider-${componentId}`);
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
        y: Math.abs(finiteNumber(size?.y, 2)),
      },
    }, `cmp-box-collider-2d-${componentId}`);
  }

  function emitEdgeCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
    const offset = getField(doc, 'm_Offset', { x: 0, y: 0 });
    const pointsBlock = deps.getIndentedBlock ? deps.getIndentedBlock(doc, 'm_Points') : [];
    const points = [];
    for (const line of pointsBlock) {
      const match = /x:\s*([-\d.]+),\s*y:\s*([-\d.]+)/.exec(String(line || ''));
      if (match) points.push({ x: Number(match[1]), y: Number(match[2]) });
    }
    if (!points.length) {
      points.push({ x: -0.5, y: 0 }, { x: 0.5, y: 0 });
    }

    if (model.is3DObject) {
      builder.addBoxCollider(nodeId, componentId, {
        enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
        isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
        center: { x: finiteNumber(offset?.x, 0), y: finiteNumber(offset?.y, 0), z: 0 },
        size: { x: 1, y: 0.1, z: UNITY_3D_COLLIDER_DEPTH },
      }, `cmp-box-collider-${componentId}`);
      return;
    }

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

  function emitBoxCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb) {
    const center = getField(doc, 'm_Center', { x: 0, y: 0, z: 0 });
    const size = getField(doc, 'm_Size', { x: 1, y: 1, z: 1 });
    const physicsMaterialAsset = unityDb?.get ? unityDb.get(unityRefGuid(getField(doc, 'm_Material', null))) : null;
    const physicsMaterialUuid = resolveUnityPhysicsMaterialUuid && physicsMaterialAsset
      ? resolveUnityPhysicsMaterialUuid(physicsMaterialAsset, options, reporter, gameObject?.name || '')
      : '';

    builder.addBoxCollider(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      isTrigger: Number(getField(doc, 'm_IsTrigger', 0) || 0) !== 0,
      center: {
        x: finiteNumber(center?.x, 0),
        y: finiteNumber(center?.y, 0),
        z: finiteNumber(center?.z, 0),
      },
      size: {
        x: Math.abs(finiteNumber(size?.x, 1)),
        y: Math.abs(finiteNumber(size?.y, 1)),
        z: Math.abs(finiteNumber(size?.z, 1)),
      },
      materialUuid: physicsMaterialUuid,
    }, `cmp-box-collider-${componentId}`);
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
    const physicsMaterialAsset = unityDb?.get ? unityDb.get(unityRefGuid(getField(doc, 'm_Material', null))) : null;
    const physicsMaterialUuid = resolveUnityPhysicsMaterialUuid && physicsMaterialAsset
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

  // Unity HingeJoint (class 59)
  function emitHingeJoint(nodeId, componentId, doc, gameObject, model, builder) {
    const anchor = getField(doc, 'm_Anchor', { x: 0, y: 0, z: 0 });
    const axis = getField(doc, 'm_Axis', { x: 0, y: 1, z: 0 });
    const connectedBodyRef = getField(doc, 'm_ConnectedBody', null);
    const connectedBodyNodeId = connectedBodyRef?.fileID ? builder.nodeMapByGameObject.get(connectedBodyRef.fileID) : null;
    const useLimits = Number(getField(doc, 'm_UseLimits', 0) || 0) !== 0;
    const limits = getField(doc, 'm_Limits', { min: 0, max: 0 });
    const useMotor = Number(getField(doc, 'm_UseMotor', 0) || 0) !== 0;
    const motor = getField(doc, 'm_Motor', { targetVelocity: 0, force: 0 });

    builder.addHingeConstraint(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      connectedBodyNodeId,
      axis: { x: finiteNumber(axis?.x, 0), y: finiteNumber(axis?.y, 1), z: finiteNumber(axis?.z, 0) },
      pivotA: { x: finiteNumber(anchor?.x, 0), y: finiteNumber(anchor?.y, 0), z: finiteNumber(anchor?.z, 0) },
      enableLimit: useLimits,
      lowerLimit: finiteNumber(limits?.min, 0),
      upperLimit: finiteNumber(limits?.max, 0),
      enableMotor: useMotor,
      motorSpeed: finiteNumber(motor?.targetVelocity, 0),
      maxMotorForce: finiteNumber(motor?.force, 0),
    }, `cmp-hinge-constraint-${componentId}`);
  }

  // Unity FixedJoint (class 88)
  function emitFixedJoint(nodeId, componentId, doc, gameObject, model, builder) {
    const connectedBodyRef = getField(doc, 'm_ConnectedBody', null);
    const connectedBodyNodeId = connectedBodyRef?.fileID ? builder.nodeMapByGameObject.get(connectedBodyRef.fileID) : null;

    builder.addFixedConstraint(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      connectedBodyNodeId,
    }, `cmp-fixed-constraint-${componentId}`);
  }

  // Unity SpringJoint (class 57)
  function emitSpringJoint(nodeId, componentId, doc, gameObject, model, builder) {
    const anchor = getField(doc, 'm_Anchor', { x: 0, y: 0, z: 0 });
    const connectedAnchor = getField(doc, 'm_ConnectedAnchor', { x: 0, y: 0, z: 0 });
    const connectedBodyRef = getField(doc, 'm_ConnectedBody', null);
    const connectedBodyNodeId = connectedBodyRef?.fileID ? builder.nodeMapByGameObject.get(connectedBodyRef.fileID) : null;

    builder.addPointToPointConstraint(nodeId, componentId, {
      enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0,
      connectedBodyNodeId,
      pivotA: { x: finiteNumber(anchor?.x, 0), y: finiteNumber(anchor?.y, 0), z: finiteNumber(anchor?.z, 0) },
      pivotB: { x: finiteNumber(connectedAnchor?.x, 0), y: finiteNumber(connectedAnchor?.y, 0), z: finiteNumber(connectedAnchor?.z, 0) },
    }, `cmp-p2p-constraint-${componentId}`);
  }

  return {
    unityRigidBody2DTypeToCocosType,
    emitRigidbody2D,
    emitCircleCollider2D,
    emitCapsuleCollider2D,
    emitEdgeCollider2D,
    emitBoxCollider2D,
    emitBoxCollider,
    emitRigidbody,
    emitCharacterController,
    emitSphereCollider,
    emitCapsuleCollider,
    polygonPathArea,
    emitPolygonCollider2D,
    emitMeshCollider,
    emitHingeJoint,
    emitFixedJoint,
    emitSpringJoint,
  };
};
