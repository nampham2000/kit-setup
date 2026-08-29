'use strict';

const IGNORED_UNITY_COMPONENT_CLASS_IDS = new Set([4, 224, 33]);
const PARTICLE_SYSTEM_RENDERER_CLASS_ID = 199;

/**
 * Component của Unity KHÔNG mang hành vi cần port sang Cocos.
 * Bỏ chúng không làm mất gì, nên báo `low` thay vì `high` — nếu không thì
 * chúng nhấn chìm những component thật sự bị mất trong cùng một report.
 *
 * Chỉ thêm vào đây khi chắc chắn class đó là chi tiết cài đặt của Unity.
 * Khi không chắc, để mặc định `high` — báo thừa còn hơn mất hành vi âm thầm.
 */
const BENIGN_UNSUPPORTED_CLASSES = {
  81: { name: 'AudioListener', reason: 'Cocos AudioSource khong can listener rieng' },
  222: { name: 'CanvasRenderer', reason: 'chi tiet noi bo cua UGUI; Sprite/Label cua Cocos tu render' },
};

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
    [57, (ctx) => handlers.emitSpringJoint(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder)],
    [58, (ctx) => handlers.emitCircleCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [59, (ctx) => handlers.emitHingeJoint(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder)],
    [60, (ctx) => handlers.emitPolygonCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [61, (ctx) => handlers.emitBoxCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [64, (ctx) => handlers.emitMeshCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [65, (ctx) => handlers.emitBoxCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb)],
    [68, (ctx) => handlers.emitEdgeCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [70, (ctx) => handlers.emitCapsuleCollider2D(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter)],
    [88, (ctx) => handlers.emitFixedJoint(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder)],
    [95, (ctx) => handlers.emitAnimator(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb, ctx.gameObject, ctx.model)],
    [108, (ctx) => handlers.emitLight(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter)],
    [114, (ctx) => handlers.emitMonoBehaviour(ctx.nodeId, ctx.componentId, ctx.doc, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    [135, (ctx) => handlers.emitSphereCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb)],
    [136, (ctx) => handlers.emitCapsuleCollider(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb)],
    [143, (ctx) => handlers.emitCharacterController(ctx.nodeId, ctx.componentId, ctx.doc, ctx.gameObject, ctx.model, ctx.builder)],
    [212, (ctx) => handlers.emitSpriteRenderer(ctx.nodeId, ctx.componentId, ctx.doc, ctx.builder, ctx.reporter, ctx.options, ctx.unityDb, ctx.cocosDb)],
    // Screen-space Unity Canvas still needs an explicit Cocos camera decision,
    // but a world-space Canvas maps directly to RenderRoot2D. Without that
    // component Cocos does not collect the nested Sprite/Label renderers at all.
    [223, (ctx) => handlers.emitCanvas(
      ctx.nodeId,
      ctx.componentId,
      ctx.doc,
      ctx.gameObject,
      ctx.model,
      ctx.builder,
      ctx.reporter,
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

    // Bỏ một component = MẤT HÀNH VI -> `high` theo quy ước severity (xem CORE.md).
    // Trước đây mọi trường hợp đều là `low`, khiến agent lọc theo `high` bỏ qua
    // hàng chục component đã biến mất khỏi bản port (lỗi RPT-01).
    //
    // Ngoại lệ: vài class của Unity thuần tuý là chi tiết cài đặt, không mang
    // hành vi nào cần port. Nếu vẫn báo `high` thì chúng sẽ nhấn chìm tín hiệu
    // thật (CanvasRenderer một mình chiếm 51/51 dòng high trên MyCozyHome).
    const benign = BENIGN_UNSUPPORTED_CLASSES[classId];
    if (benign) {
      ctx.reporter.low('COMPONENT_IGNORED_BY_DESIGN', ctx.model.file, ctx.gameObject.name, `Unity ${benign.name} (class ${classId}) khong can port: ${benign.reason}`);
      return;
    }

    ctx.reporter.high('COMPONENT_UNSUPPORTED', ctx.model.file, ctx.gameObject.name, `Unsupported Unity component class ${classId}; skipped - hanh vi cua component nay bi mat, agent phai tu cai dat lai neu gameplay can`);
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
