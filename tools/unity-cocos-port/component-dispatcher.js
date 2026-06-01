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
    [58, (ctx) => handlers.emitCircleCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [60, (ctx) => handlers.emitPolygonCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [61, (ctx) => handlers.emitBoxCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [64, (ctx) => handlers.emitMeshCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [95, (ctx) => handlers.emitAnimator(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb, ctx.gameObject, ctx.model)],
    [108, (ctx) => handlers.emitLight(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter)],
    [114, (ctx) => handlers.emitMonoBehaviour(ctx.nodeId, ctx.componentId, ctx.doc, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [212, (ctx) => handlers.emitSpriteRenderer(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [223, (ctx) => handlers.emitParticleSystem(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
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
    for (const gameObject of model.gameObjects.values()) {
      const nodeId = builder.nodeMapByGameObject.get(gameObject.fileId);
      if (nodeId == null) continue;

      for (const componentId of gameObject.components) {
        if (model.transforms.has(componentId)) continue;
        const doc = model.componentDocs.get(componentId) || model.transforms.get(componentId);
        if (!doc) continue;
        emitUnityComponent({ gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb });
      }

      if (gameObject.syntheticModelAsset) {
        handlers.emitSyntheticModelRenderer(gameObject, nodeId, builder, reporter, options, unityDb, cocosDb);
      }
    }
  }

  return {
    emitComponents,
  };
}

module.exports = createComponentDispatcher;
