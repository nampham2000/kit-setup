'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inspector = require('./inspector.js');

test('search index contains nested keys, paths, and primitive values', () => {
  const text = inspector.__test.searchTextFor('gameplay', {
    activeBundle: 'Hidden-Suspect-Brief3',
    tutorial: { enabled: true, speed: 0.65 },
  });
  for (const term of ['gameplay', 'activebundle', 'hidden-suspect-brief3', 'tutorial', 'enabled', 'true', '0.65']) {
    assert.match(text, new RegExp(term.replace('.', '\\.')));
  }
});

test('split action assigns eligible top-level sections without overlapping nested owners', () => {
  const result = inspector.__test.buildTopLevelFragmentMap({
    $fragments: { 'custom.levels': 'playable-config/levels' },
    title: 'Example',
    cta: { googlePlayUrl: '' },
    gameplay: { targetTaps: 3 },
    custom: { levels: [], inline: true },
  });
  assert.deepEqual(result, {
    'custom.levels': 'playable-config/levels',
    cta: 'playable-config/cta',
    gameplay: 'playable-config/gameplay',
  });
});

test('default preview detection never matches unrelated inspector panels', () => {
  const host = { contains: () => false };
  const element = (tagName, src = '', className = '') => ({
    tagName, className, getAttribute: name => name === 'src' ? src : '',
  });
  assert.equal(inspector.__test.isDefaultJsonPreview(element('UI-PANEL', 'packages://inspector/assets/json.js'), host), true);
  assert.equal(inspector.__test.isDefaultJsonPreview(element('DIV', '', 'asset-json'), host), true);
  assert.equal(inspector.__test.isDefaultJsonPreview(element('UI-PANEL', 'packages://inspector/assets/texture.js'), host), false);
  assert.equal(inspector.__test.isDefaultJsonPreview(element('DIV', '', 'content-header'), host), false);
});

test('closing the inspector restores hidden styles and disconnects observers', () => {
  let disconnected = false;
  const element = { style: { cssText: 'display:flex' } };
  const self = {
    __jsonInspectorTimers: [],
    __jsonInspectorObserver: { disconnect: () => { disconnected = true; } },
    __jsonInspectorHidden: new Map([[element, 'display:grid']]),
  };
  inspector.__test.restoreDefaultPreview(self);
  assert.equal(disconnected, true);
  assert.equal(element.style.cssText, 'display:grid');
  assert.equal(self.__jsonInspectorHidden.size, 0);
  assert.equal(self.__jsonInspectorObserver, null);
});

test('cleanup removes the legacy global style that hid later inspector panels', () => {
  let removed = false;
  const style = { remove: () => { removed = true; } };
  const documentRoot = {
    querySelector: selector => selector === '#cc-hide-default-json-preview' ? style : null,
  };
  const host = {
    tagName: 'UI-PANEL',
    ownerDocument: documentRoot,
    getRootNode: () => documentRoot,
    parentElement: null,
  };

  inspector.__test.removeLegacyGlobalHideStyle(host);

  assert.equal(removed, true);
});

test('an older async asset read cannot overwrite a newer selection', async () => {
  let resolveRead;
  global.Editor = {
    Message: {
      request: () => new Promise(resolve => { resolveRead = resolve; }),
    },
  };
  const self = {
    uuid: 'old-asset',
    loadGeneration: 1,
    currentData: null,
    $: { assetTitle: { textContent: '' } },
    markDirty: () => assert.fail('stale reads must not update dirty state'),
    render: () => assert.fail('stale reads must not render'),
  };

  const pending = inspector.methods.loadAssetData.call(self, null, 1);
  self.loadGeneration = 2;
  resolveRead({ success: true, name: 'old.json', content: '{"old":true}' });
  await pending;

  assert.equal(self.currentData, null);
  assert.equal(self.$.assetTitle.textContent, '');
  delete global.Editor;
});
