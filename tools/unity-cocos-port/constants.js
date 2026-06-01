'use strict';

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
  ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
  : findProjectRoot(process.cwd())
    || findProjectRoot(path.resolve(__dirname, '..', '..'))
    || path.resolve(process.cwd());
const BUILTIN_DEFAULT_SPRITE_RENDERER_MATERIAL_UUID = 'ade8a15a-dcca-4b3c-84c6-f6476ac875bb';
const BUILTIN_DEFAULT_MESH_MATERIAL_UUID = 'd3c7820c-2a98-4429-8bc7-b8453bc9ac41';
const BUILTIN_STANDARD_EFFECT_UUID = 'c8f66d17-351a-48da-a12c-0212d28575c4';
const BUILTIN_UNLIT_EFFECT_UUID = 'a3cd009f-0ab0-420d-9278-b9fdab939bbc';
const BUILTIN_PARTICLE_EFFECT_UUID = 'd1346436-ac96-4271-b863-1f4fdead95b0';
const BUILTIN_STANDARD_TRANSPARENT_TECHNIQUE_INDEX = 1;
const COCOS_MATERIAL_IMPORTER_VERSION = '1.0.21';
const COCOS_IMAGE_TEXTURE_SUBMETA_ID = '6c48a';
const COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID = 'f9941';
const UNITY_BUILTIN_EXTRA_GUID = '0000000000000000e000000000000000';
const BUILTIN_PRIMITIVE_MESH_UUIDS = {
  box: '1263d74c-8167-4928-91a6-4e2672411f47@a804a',
  cube: '1263d74c-8167-4928-91a6-4e2672411f47@a804a',
  capsule: '1263d74c-8167-4928-91a6-4e2672411f47@801ec',
  plane: '1263d74c-8167-4928-91a6-4e2672411f47@2e76e',
  quad: '1263d74c-8167-4928-91a6-4e2672411f47@fc873',
  cone: '1263d74c-8167-4928-91a6-4e2672411f47@38fd2',
  sphere: '1263d74c-8167-4928-91a6-4e2672411f47@17020',
  cylinder: '1263d74c-8167-4928-91a6-4e2672411f47@8abdc',
  torus: '1263d74c-8167-4928-91a6-4e2672411f47@40ece',
};
const UNITY_BUILTIN_MESH_FILE_ID_TO_PRIMITIVE = {
  10202: 'box',
  10209: 'plane',
};
const UNITY_MATERIAL_BASE_TEXTURE_KEYS = ['_BaseMap', '_MainTex'];
const UNITY_MATERIAL_NORMAL_TEXTURE_KEYS = ['_BumpMap', '_NormalMap'];
const UNITY_MATERIAL_OCCLUSION_TEXTURE_KEYS = ['_OcclusionMap'];
const UNITY_MATERIAL_EMISSIVE_TEXTURE_KEYS = ['_EmissionMap', '_EmissiveMap'];
const COCOS_DEFAULT_LAYER_VALUE = 1 << 30;
const COCOS_CUSTOM_LAYER_MAX_BIT = 19;
const COCOS_BUILTIN_LAYER_ALIASES = [
  { names: ['NONE', 'None'], value: 0 },
  { names: ['IGNORE_RAYCAST', 'Ignore Raycast', 'IgnoreRaycast'], value: 1 << 20 },
  { names: ['GIZMOS', 'Gizmos'], value: 1 << 21 },
  { names: ['EDITOR', 'Editor'], value: 1 << 22 },
  { names: ['UI_3D', 'UI3D'], value: 1 << 23 },
  { names: ['SCENE_GIZMO', 'SceneGizmo'], value: 1 << 24 },
  { names: ['UI_2D', 'UI', 'UI2D'], value: 1 << 25 },
  { names: ['PROFILER', 'Profiler'], value: 1 << 28 },
  { names: ['DEFAULT', 'Default'], value: COCOS_DEFAULT_LAYER_VALUE },
  { names: ['ALL', 'All'], value: 0xffffffff },
];
const UNITY_3D_PREFAB_COMPONENT_HINTS = new Set([
  23,
  33,
  54,
  64,
  65,
  135,
  136,
  137,
]);
const UNITY_3D_COLLIDER_DEPTH = 0.01;
const UNITY_CLASS = {
  1: 'GameObject',
  4: 'Transform',
  20: 'Camera',
  23: 'MeshRenderer',
  33: 'MeshFilter',
  95: 'Animator',
  108: 'Light',
  114: 'MonoBehaviour',
  212: 'SpriteRenderer',
  223: 'Canvas',
  224: 'RectTransform',
  1001: 'PrefabInstance',
};
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const DEFAULT_MODEL_IMPORT_WAIT_MS = 10000;
const REPORT_COLUMNS = ['prefab', 'severity', 'code', 'source', 'target', 'message', 'detail'];

module.exports = {
  ROOT_DIR,
  BUILTIN_DEFAULT_SPRITE_RENDERER_MATERIAL_UUID,
  BUILTIN_DEFAULT_MESH_MATERIAL_UUID,
  BUILTIN_STANDARD_EFFECT_UUID,
  BUILTIN_UNLIT_EFFECT_UUID,
  BUILTIN_PARTICLE_EFFECT_UUID,
  BUILTIN_STANDARD_TRANSPARENT_TECHNIQUE_INDEX,
  COCOS_MATERIAL_IMPORTER_VERSION,
  COCOS_IMAGE_TEXTURE_SUBMETA_ID,
  COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID,
  UNITY_BUILTIN_EXTRA_GUID,
  BUILTIN_PRIMITIVE_MESH_UUIDS,
  UNITY_BUILTIN_MESH_FILE_ID_TO_PRIMITIVE,
  UNITY_MATERIAL_BASE_TEXTURE_KEYS,
  UNITY_MATERIAL_NORMAL_TEXTURE_KEYS,
  UNITY_MATERIAL_OCCLUSION_TEXTURE_KEYS,
  UNITY_MATERIAL_EMISSIVE_TEXTURE_KEYS,
  COCOS_DEFAULT_LAYER_VALUE,
  COCOS_CUSTOM_LAYER_MAX_BIT,
  COCOS_BUILTIN_LAYER_ALIASES,
  UNITY_3D_PREFAB_COMPONENT_HINTS,
  UNITY_3D_COLLIDER_DEPTH,
  UNITY_CLASS,
  SEVERITY_ORDER,
  DEFAULT_MODEL_IMPORT_WAIT_MS,
  REPORT_COLUMNS,
};
