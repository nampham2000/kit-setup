'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ComponentTools,
  findScriptComponentByAssetUuid,
  getComponentScriptAssetUuid,
} = require('../dist/tools/component-tools.js');

const NODE_UUID = '207c817b-e981-4d35-a49d-e3cbd8fb58c7';
const SCRIPT_PATH = 'db://assets/script/harvest/HarvestTileApp.ts';
const SCRIPT_UUID = '5656452f-6b3d-497d-bf9b-88e4f3cc31d2';
const OTHER_SCRIPT_UUID = '00000000-0000-0000-0000-000000000001';
const COMPONENT_CID = '56564Uvaz1Jfb+biOTzzDHS';

function serializedComponent(scriptUuid, type = COMPONENT_CID) {
  return {
    __type__: type,
    uuid: { value: `component-${scriptUuid}` },
    enabled: true,
    value: {
      name: { value: 'BoardManager<HarvestTileApp>' },
      __scriptAsset: { value: { uuid: scriptUuid } },
    },
  };
}

function installEditor(request) {
  global.Editor = { Message: { request } };
}

test('extracts custom script identity from the Cocos query-node descriptor shape', () => {
  const component = {
    type: COMPONENT_CID,
    properties: {
      __scriptAsset: { value: { uuid: SCRIPT_UUID } },
    },
  };
  assert.equal(getComponentScriptAssetUuid(component), SCRIPT_UUID);
  assert.equal(findScriptComponentByAssetUuid([component], SCRIPT_UUID), component);
  assert.equal(findScriptComponentByAssetUuid([component], OTHER_SCRIPT_UUID), undefined);
});

test('attach_script is idempotent when Cocos reports a CID instead of the script name', async () => {
  let createCalls = 0;
  installEditor(async (packageName, message, argument) => {
    if (packageName === 'asset-db' && message === 'query-uuid') return SCRIPT_UUID;
    if (packageName === 'scene' && message === 'query-node') {
      return { __comps__: [serializedComponent(SCRIPT_UUID)] };
    }
    if (packageName === 'scene' && message === 'create-component') {
      createCalls += 1;
      throw new Error(`unexpected duplicate create: ${JSON.stringify(argument)}`);
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.existing, true);
    assert.equal(result.data.componentType, COMPONENT_CID);
    assert.equal(result.data.scriptAssetUuid, SCRIPT_UUID);
    assert.equal(createCalls, 0);
  } finally {
    delete global.Editor;
  }
});

test('attach_script verifies a newly attached CID by exact script asset UUID', async () => {
  let attached = false;
  let createCalls = 0;
  installEditor(async (packageName, message, argument) => {
    if (packageName === 'asset-db' && message === 'query-uuid') return SCRIPT_UUID;
    if (packageName === 'scene' && message === 'query-node') {
      const components = [serializedComponent(OTHER_SCRIPT_UUID, 'HarvestTileApp')];
      if (attached) components.push(serializedComponent(SCRIPT_UUID));
      return { __comps__: components };
    }
    if (packageName === 'scene' && message === 'create-component') {
      createCalls += 1;
      assert.deepEqual(argument, { uuid: NODE_UUID, component: 'HarvestTileApp' });
      attached = true;
      return undefined;
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.existing, false);
    assert.equal(result.data.componentType, COMPONENT_CID);
    assert.equal(result.data.scriptAssetUuid, SCRIPT_UUID);
    assert.equal(createCalls, 1);
  } finally {
    delete global.Editor;
  }
});

test('attach_script rejects a same-name component carrying a different script UUID', async () => {
  let createCalls = 0;
  installEditor(async (packageName, message) => {
    if (packageName === 'asset-db' && message === 'query-uuid') return SCRIPT_UUID;
    if (packageName === 'scene' && message === 'query-node') {
      return { __comps__: [serializedComponent(OTHER_SCRIPT_UUID, 'HarvestTileApp')] };
    }
    if (packageName === 'scene' && message === 'create-component') {
      createCalls += 1;
      return undefined;
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, false);
    assert.match(result.error, new RegExp(SCRIPT_UUID));
    assert.equal(createCalls, 1);
  } finally {
    delete global.Editor;
  }
});

test('attach_script falls back to query-asset-info without falling back to a name match', async () => {
  let assetInfoCalls = 0;
  installEditor(async (packageName, message) => {
    if (packageName === 'asset-db' && message === 'query-uuid') {
      throw new Error('query-uuid is unavailable');
    }
    if (packageName === 'asset-db' && message === 'query-asset-info') {
      assetInfoCalls += 1;
      return { uuid: SCRIPT_UUID };
    }
    if (packageName === 'scene' && message === 'query-node') {
      return { __comps__: [serializedComponent(SCRIPT_UUID)] };
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.existing, true);
    assert.equal(assetInfoCalls, 1);
  } finally {
    delete global.Editor;
  }
});

test('attach_script fails closed before mutation when no script asset UUID can be resolved', async () => {
  let createCalls = 0;
  installEditor(async (packageName, message) => {
    if (packageName === 'asset-db' && message === 'query-uuid') return null;
    if (packageName === 'asset-db' && message === 'query-asset-info') return null;
    if (packageName === 'scene' && message === 'create-component') {
      createCalls += 1;
      return undefined;
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /Refusing a name-only attachment check/);
    assert.equal(createCalls, 0);
  } finally {
    delete global.Editor;
  }
});

test('attach_script avoids a duplicate when the direct API throws after attaching', async () => {
  let attached = false;
  let fallbackCalls = 0;
  installEditor(async (packageName, message) => {
    if (packageName === 'asset-db' && message === 'query-uuid') return SCRIPT_UUID;
    if (packageName === 'scene' && message === 'query-node') {
      return { __comps__: attached ? [serializedComponent(SCRIPT_UUID)] : [] };
    }
    if (packageName === 'scene' && message === 'create-component') {
      attached = true;
      throw new Error('transport disconnected after mutation');
    }
    if (packageName === 'scene' && message === 'execute-scene-script') {
      fallbackCalls += 1;
      return { success: true };
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.scriptAssetUuid, SCRIPT_UUID);
    assert.equal(result.data.usedFallback, false);
    assert.equal(fallbackCalls, 0);
  } finally {
    delete global.Editor;
  }
});

test('attach_script uses the existing addComponentToNode scene fallback and verifies by UUID', async () => {
  let attached = false;
  installEditor(async (packageName, message, argument) => {
    if (packageName === 'asset-db' && message === 'query-uuid') return SCRIPT_UUID;
    if (packageName === 'scene' && message === 'query-node') {
      return { __comps__: attached ? [serializedComponent(SCRIPT_UUID)] : [] };
    }
    if (packageName === 'scene' && message === 'create-component') {
      throw new Error('direct API unavailable');
    }
    if (packageName === 'scene' && message === 'execute-scene-script') {
      assert.equal(argument.method, 'addComponentToNode');
      assert.deepEqual(argument.args, [NODE_UUID, 'HarvestTileApp']);
      attached = true;
      return { success: true };
    }
    throw new Error(`unexpected request: ${packageName}/${message}`);
  });

  try {
    const result = await new ComponentTools().execute('attach_script', {
      nodeUuid: NODE_UUID,
      scriptPath: SCRIPT_PATH,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.scriptAssetUuid, SCRIPT_UUID);
    assert.equal(result.data.usedFallback, true);
  } finally {
    delete global.Editor;
  }
});
