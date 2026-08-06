'use strict';

const IGNORED_UNITY_COMPONENT_CLASS_IDS = new Set([4, 224, 33]);
const PARTICLE_SYSTEM_RENDERER_CLASS_ID = 199;

function findSiblingParticleRendererDoc(gameObject, model) {
  return (gameObject.components || [])
    .map((id) => model.componentDocs.get(id))
    .find((doc) => Number(doc?.classId || 0) === PARTICLE_SYSTEM_RENDERER_CLASS_ID) || null;
}

function createComponentDispatcher(handlers) {
  const emittersByUnityClassId = new Map([
    [20, ({ nodeId, componentId, doc, builder }) => builder.addCamera(nodeId, componentId, doc, `cmp-camera-${componentId}`)],
    [23, (ctx) => handlers.emitMeshRenderer(ctx.gameObject, ctx.nodeId, ctx.componentId, ctx.doc, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [50, (ctx) => handlers.emitRigidbody2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [54, (ctx) => handlers.emitRigidbody(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder)],
    [58, (ctx) => handlers.emitCircleCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [60, (ctx) => handlers.emitPolygonCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [61, (ctx) => handlers.emitBoxCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [64, (ctx) => handlers.emitMeshCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [65, (ctx) => handlers.emitBoxCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder)],
    [95, (ctx) => handlers.emitAnimator(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb, ctx.gameObject, ctx.model)],
    [108, (ctx) => handlers.emitLight(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter)],
    [114, (ctx) => handlers.emitMonoBehaviour(ctx.nodeId, ctx.componentId, ctx.doc, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [135, (ctx) => handlers.emitSphereCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder)],
    [212, (ctx) => handlers.emitSpriteRenderer(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    // Unity ParticleSystem is class 198 and is dispatched below. Class 223 is
    // Canvas: it has no 1:1 Cocos counterpart, since cc.Canvas owns a camera and
    // belongs at the root of a UI tree rather than on every nested uGUI layer.
    [223, (ctx) => ctx.reporter.medium(
      'CANVAS_NOT_PORTED',
      ctx.model.file,
      ctx.gameObject.name,
      'Unity Canvas has no direct Cocos equivalent; add cc.UITransform plus cc.Widget on the layer node, or a single cc.Canvas at the UI root',
    )],
  ]);

  function emitUnityComponent(ctx) {
    const classId = Number(ctx.doc?.classId || 0);
    if (IGNORED_UNITY_COMPONENT_CLASS_IDS.has(classId)) return;

    if (classId === 198) {
      handlers.emitParticleSystem(
        ctx.nodeId,
        ctx.componentId,
        ctx.doc,
        ctx.gameObject,
        ctx.builder,
        ctx.reporter,
        ctx.options,
        ctx.unityDb,
        ctx.cocosDb,
        findSiblingParticleRendererDoc(ctx.gameObject, ctx.model)
      );
      return;
    }

    if (classId === PARTICLE_SYSTEM_RENDERER_CLASS_ID) {
      ctx.reporter.low(
        'PARTICLE_RENDERER_MERGED',
        ctx.model.file,
        ctx.gameObject.name,
        'Unity ParticleSystemRenderer is represented by the generated Cocos ParticleSystem renderer'
      );
      return;
    }

    const emitter = emittersByUnityClassId.get(classId);
    if (emitter) {
      emitter(ctx);
      return;
    }

    ctx.reporter.low('COMPONENT_UNSUPPORTED', ctx.model.file, ctx.gameObject.name, `Unsupported Unity component class ${classId}; skipped`);
  }

  function emitComponents(model, builder, reporter, options, unityDb, cocosDb) {
    // Emit engine components first so MonoBehaviour fields can resolve references
    // to mounted Animators and other components regardless of GameObject order.
    for (const gameObject of model.gameObjects.values()) {
      const nodeId = builder.nodeMapByGameObject.get(gameObject.fileId);
      if (nodeId == null) continue;

      for (const componentId of gameObject.components) {
        if (model.transforms.has(componentId)) continue;
        const doc = model.componentDocs.get(componentId) || model.transforms.get(componentId);
        if (!doc || Number(doc.classId) === 114) continue;
        emitUnityComponent({ gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb });
      }

      if (gameObject.syntheticModelAsset && !gameObject.syntheticModelPrefabLinked) {
        handlers.emitSyntheticModelRenderer(gameObject, nodeId, builder, reporter, options, unityDb, cocosDb);
      }
    }

    for (const gameObject of model.gameObjects.values()) {
      const nodeId = builder.nodeMapByGameObject.get(gameObject.fileId);
      if (nodeId == null) continue;
      for (const componentId of gameObject.components) {
        const doc = model.componentDocs.get(componentId);
        if (!doc || Number(doc.classId) !== 114) continue;
        emitUnityComponent({ gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb });
      }
    }
  }

  return {
    emitComponents,
  };
}

module.exports = createComponentDispatcher;
