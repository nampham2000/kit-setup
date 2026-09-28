// Project hook for Bunny Blitz FunctionsRSUV.hlsl: Unity packs hit time (ms, 24 bits), dead (bit 24) and spawned
// (bit 25) into unity_RendererUserValue; the Cocos renderer passes them unpacked in sgRendererUserValue.
uniform SGRendererUserValue { vec4 sgRendererUserValue; };
void GetTimer_float (out float hitTime, out bool isDead, out bool isSpawned) {
  hitTime = sgRendererUserValue.x;
  isDead = sgRendererUserValue.y > 0.5;
  isSpawned = sgRendererUserValue.z > 0.5;
}
