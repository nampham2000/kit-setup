'use strict';

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

/** Map UnityEngine.UI.Image fill serialization to cc.Sprite fields. */
function mapUnityImageFill(config = {}) {
  const spriteType = Math.max(0, Math.min(3, Number(config.type) || 0));
  if (spriteType !== 3) {
    return { spriteType, fillType: 0, fillStart: 0, fillRange: 0, approximated: false };
  }

  const method = Math.max(0, Math.min(4, Number(config.method) || 0));
  const amount = clamp01(config.amount);
  const origin = Math.max(0, Number(config.origin) || 0);
  const clockwise = Number(config.clockwise ?? 1) !== 0;

  if (method <= 1) {
    const reversed = origin === 1;
    return {
      spriteType,
      fillType: method, // Unity and Cocos both use 0=horizontal, 1=vertical.
      fillStart: reversed ? 1 : 0,
      fillRange: reversed ? -amount : amount,
      approximated: false,
    };
  }

  // Cocos exposes one radial mode whereas Unity has 90/180/360 variants.
  // Preserve amount/direction and map the origin around the unit circle; the
  // 90/180 arc extent remains an explicit approximation for the port report.
  return {
    spriteType,
    fillType: 2,
    fillStart: (origin % 4) * 0.25,
    fillRange: clockwise ? amount : -amount,
    approximated: method !== 4,
  };
}

module.exports = { mapUnityImageFill };
