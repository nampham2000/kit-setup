'use strict';

module.exports = function createLightPorter(deps) {
  const { getField } = deps;

  function emitLight(nodeId, componentId, doc, builder, reporter) {
    const rawType = getField(doc, 'm_Type', 1);
    const type = Number(rawType !== undefined && rawType !== null ? rawType : 1);
    
    if (type === 1) {
      // 1 = Directional Light
      builder.addDirectionalLight(nodeId, componentId, doc, `cmp-light-${componentId}`);
    } else if (type === 2) {
      // 2 = Point Light -> Cocos SphereLight
      if (typeof builder.addSphereLight === 'function') {
        builder.addSphereLight(nodeId, componentId, doc, `cmp-light-${componentId}`);
      } else {
        builder.addDirectionalLight(nodeId, componentId, doc, `cmp-light-${componentId}`);
      }
    } else if (type === 0) {
      // 0 = Spot Light -> Cocos SpotLight
      if (typeof builder.addSpotLight === 'function') {
        builder.addSpotLight(nodeId, componentId, doc, `cmp-light-${componentId}`);
      } else {
        builder.addDirectionalLight(nodeId, componentId, doc, `cmp-light-${componentId}`);
      }
    } else {
      reporter.medium('LIGHT_TYPE_APPROXIMATED', '', '', `Unity light type ${type} is approximated as cc.DirectionalLight`);
      builder.addDirectionalLight(nodeId, componentId, doc, `cmp-light-${componentId}`);
    }
  }

  return { emitLight };
};

