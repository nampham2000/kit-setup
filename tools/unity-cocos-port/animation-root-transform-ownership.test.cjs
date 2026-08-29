'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { findRootTransformTracks } = require('./animation-porter');

function track(path, property, component = '') {
  const parts = [];
  for (const segment of path.split('/').filter(Boolean)) {
    parts.push({ __type__: 'cc.animation.HierarchyPath', path: segment });
  }
  if (component) parts.push({ __type__: 'cc.animation.ComponentPath', component });
  parts.push(property);
  return { _binding: { path: { _paths: parts } } };
}

test('finds only transform properties driven on the animator root', () => {
  const clip = {
    _tracks: [
      track('', 'position'),
      track('', 'scale'),
      track('', 'color', 'cc.Sprite'),
      track('Visual', 'position'),
      track('', 'eulerAngles'),
    ],
  };
  assert.deepEqual(findRootTransformTracks(clip), ['eulerAngles', 'position', 'scale']);
});

test('returns empty when animation leaves the placement root alone', () => {
  assert.deepEqual(findRootTransformTracks({
    _tracks: [track('Body', 'position'), track('', 'opacity', 'cc.UIOpacity')],
  }), []);
});
