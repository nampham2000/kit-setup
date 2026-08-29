'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EditorRuntimeTools } = require('../dist/tools/editor-runtime-tools.js');

test('reload_preview uses Creator 3.8 public messages and refreshes assets first', async () => {
  const calls = [];
  global.Editor = {
    Message: {
      async request(packageName, message, ...args) {
        calls.push([packageName, message, ...args]);
        if (message === 'query-preview-url') return 'http://127.0.0.1:7456/';
        return undefined;
      },
    },
  };
  try {
    const result = await new EditorRuntimeTools().execute('reload_preview', {});
    assert.equal(result.success, true);
    assert.deepEqual(calls, [
      ['asset-db', 'refresh-asset', 'db://assets'],
      ['preview', 'reload-terminal'],
      ['preview', 'query-preview-url'],
    ]);
    assert.doesNotMatch(JSON.stringify(calls), /\"reload\"/);
  } finally {
    delete global.Editor;
  }
});

test('stop_preview fails closed instead of calling a nonexistent message', async () => {
  let requested = false;
  global.Editor = { Message: { async request() { requested = true; } } };
  try {
    const result = await new EditorRuntimeTools().execute('stop_preview', {});
    assert.equal(result.success, false);
    assert.equal(requested, false);
    assert.match(String(result.error), /does not contribute a preview stop message/);
  } finally {
    delete global.Editor;
  }
});
