'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateGameplayBriefs } = require('./gameplay-brief-validator.cjs');

function fixture({ selected = 'brief-a', buildBundle = 'brief-a', fragmented = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gameplay-briefs-'));
  fs.mkdirSync(path.join(root, 'assets/resources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/gameplay-bundles/brief-a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
  const gameplay = { activeBundle: selected, briefs: { 'brief-a': { customConfig: 'demo' } } };
  if (fragmented) {
    fs.mkdirSync(path.join(root, 'assets/resources/playable-config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets/resources/playable-config.json'), JSON.stringify({
      $fragments: { gameplay: 'playable-config/gameplay' },
    }));
    fs.writeFileSync(path.join(root, 'assets/resources/playable-config/gameplay.json'), JSON.stringify(gameplay));
  } else {
    fs.writeFileSync(path.join(root, 'assets/resources/playable-config.json'), JSON.stringify({ gameplay }));
  }
  fs.writeFileSync(path.join(root, 'assets/gameplay-bundles/brief-a.meta'), JSON.stringify({
    userData: { isBundle: true, bundleName: 'brief-a' },
  }));
  fs.writeFileSync(path.join(root, 'configs/brief-a.json'), JSON.stringify({
    bundleConfigs: [
      { root: 'db://assets/resources', name: 'resources' },
      { root: `db://assets/gameplay-bundles/${buildBundle}`, name: buildBundle },
    ],
    packages: { 'gameplay-briefs': { activeBundle: buildBundle } },
  }));
  return root;
}

test('accepts one config and one build bundle for every gameplay brief', () => {
  const root = fixture();
  try { assert.deepEqual(validateGameplayBriefs(root).issues, []); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('accepts gameplay.briefs mounted from a config fragment', () => {
  const root = fixture({ fragmented: true });
  try { assert.deepEqual(validateGameplayBriefs(root).issues, []); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects preview selectors and build configs that point at another brief', () => {
  const root = fixture({ selected: 'missing', buildBundle: 'brief-b' });
  try {
    const result = validateGameplayBriefs(root);
    assert.equal(result.ok, false);
    assert.match(result.issues.join('\n'), /activeBundle/);
    assert.match(result.issues.join('\n'), /brief-a\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
