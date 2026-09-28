'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), test = require('node:test'), assert = require('node:assert/strict');
const native = require('./fixtures/mesh-view-align-to-direction-native.json');
const { particleRendererContract } = require('./particle-renderer-contract');

const byName = name => native.cases.find(c => c.name === name);
const same = (a, b) => a.vertices.length === b.vertices.length && a.vertices.every((v, i) => v.every((x, k) => Math.abs(x - b.vertices[i][k]) < 1e-5));

test('native fixture binds its Unity producer', () => {
  const producer = fs.readFileSync(path.join(__dirname, 'fixtures/capture-mesh-view-align-to-direction.cs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'), native.sourceProbeSha256);
});

test('Unity: View + alignToDirection ignores the camera and equals Local; plain View follows it', () => {
  assert.ok(same(byName('view-cam-identity'), byName('view-cam-rotated')), 'camera rotation must not move aligned View meshes');
  assert.ok(same(byName('view-cam-rotated'), byName('local-cam-rotated')), 'aligned View == Local');
  assert.ok(!same(byName('view-cam-rotated-noalign'), byName('view-cam-identity')), 'unaligned View uses the camera frame');
  assert.ok(!same(byName('world-cam-rotated'), byName('local-cam-rotated')), 'World ignores the emitter rotation');
});

test('contract: aligned View mesh uses the emitter frame (Cocos World alignSpace), plain View keeps the camera', () => {
  const particle = align => ({ ShapeModule: { enabled: 1, type: 10, alignToDirection: align, m_Rotation: { x: 0, y: 0, z: 0 } }, InitialModule: {} });
  const renderer = { m_RenderMode: 4, m_RenderAlignment: 0 };
  assert.equal(particleRendererContract(particle(1), renderer).cocosAlignment, 0);
  assert.equal(particleRendererContract(particle(0), renderer).cocosAlignment, 2);
  assert.equal(particleRendererContract(particle(1), { m_RenderMode: 4, m_RenderAlignment: 2 }).cocosAlignment, 0);
});
