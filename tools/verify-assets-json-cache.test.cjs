'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { inspectJsonAssetCache, run } = require('./verify-assets.cjs');

const UUID = '4c0f8821-6b21-4f4a-912b-b6d8a34291fa';

function fixture (t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-json-cache-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const assets = path.join(root, 'assets', 'resources');
    fs.mkdirSync(assets, { recursive: true });
    const asset = path.join(assets, 'playable-config.json');
    fs.writeFileSync(asset, JSON.stringify({ version: 1, nested: { enabled: true } }, null, 2));
    fs.writeFileSync(`${asset}.meta`, JSON.stringify({
        importer: 'json', imported: true, uuid: UUID, subMetas: {},
    }, null, 2));
    if (options.library !== false) {
        const cacheDir = path.join(root, 'library', UUID.slice(0, 2));
        fs.mkdirSync(cacheDir, { recursive: true });
        if (options.cache !== false) {
            fs.writeFileSync(path.join(cacheDir, `${UUID}.json`), JSON.stringify({
                __type__: 'cc.JsonAsset',
                json: options.stale
                    ? { version: 1, nested: {} }
                    : { nested: { enabled: true }, version: 1 },
            }, null, 2));
        }
    }
    return { root, asset };
}

test('plain JsonAsset cache compares semantic JSON, not property order', t => {
    const { root, asset } = fixture(t);
    const meta = JSON.parse(fs.readFileSync(`${asset}.meta`, 'utf8'));
    assert.equal(inspectJsonAssetCache(root, asset, meta).status, 'fresh');
    const report = run({ projectRoot: root });
    assert.equal(report.status, 'PASS');
    assert.equal(report.jsonCacheStatesScanned, 1);
    assert.deepEqual(report.staleJsonAssets, []);
});

test('stale JsonAsset cache fails even while meta still says imported true', t => {
    const { root } = fixture(t, { stale: true });
    const report = run({ projectRoot: root });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.failed.length, 0);
    assert.deepEqual(report.staleJsonAssets.map(item => item.status), ['stale']);
    assert.match(report.errors[0], /Reimport asset qua Cocos AssetDB/);
});

test('missing cache fails only after a local library exists', t => {
    const withLibrary = fixture(t, { cache: false });
    const missing = run({ projectRoot: withLibrary.root });
    assert.equal(missing.status, 'FAIL');
    assert.deepEqual(missing.staleJsonAssets.map(item => item.status), ['missing']);

    const freshClone = fixture(t, { library: false });
    const unavailable = run({ projectRoot: freshClone.root });
    assert.equal(unavailable.status, 'PASS');
    assert.equal(unavailable.jsonCacheStatesScanned, 0);
    assert.match(unavailable.warnings[0], /chưa thể chứng minh cc\.JsonAsset cache/);
});
