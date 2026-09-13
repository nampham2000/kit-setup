'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const createFontPorter = require('./font-porter');
const { resolveFontDependency, tmpMaterialStyle } = require('./font-porter');
const { buildNestedPrefabPropertyOverrides } = require('../unity-cocos-port.cjs');

function ref(guid, fileID = 11400000) {
  return { fileID, guid, type: 2 };
}

function makeReporter() {
  const events = [];
  return {
    events,
    high(code, source, target, message) { events.push({ severity: 'high', code, source, target, message }); },
    medium(code, source, target, message) { events.push({ severity: 'medium', code, source, target, message }); },
    low(code, source, target, message) { events.push({ severity: 'low', code, source, target, message }); },
  };
}

function getField(doc, key, fallback) {
  return Object.prototype.hasOwnProperty.call(doc.fields || {}, key) ? doc.fields[key] : fallback;
}

function hasField(doc, key) {
  return Object.prototype.hasOwnProperty.call(doc.fields || {}, key);
}

function makePorter(root) {
  return createFontPorter({
    getField,
    hasField,
    unityRefGuid: (value) => String(value?.guid || ''),
    importedUnityAssetPath: (asset, options) => path.join(options.cocosRoot, 'assets', 'unity_imported', asset.relativePath),
    copyUnityAssetToCocos(asset, options) {
      const target = path.join(options.cocosRoot, 'assets', 'unity_imported', asset.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(asset.path, target);
      fs.writeFileSync(`${target}.meta`, JSON.stringify({ uuid: `uuid-${asset.stem}` }));
      return target;
    },
    resolveCurrentFontUuid: (target) => {
      if (!target || !fs.existsSync(`${target}.meta`)) return '';
      return JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8')).uuid || '';
    },
    ensureDirectoryMetas(directory) { fs.mkdirSync(directory, { recursive: true }); },
    ensureAssetMeta(target) {
      fs.writeFileSync(`${target}.meta`, JSON.stringify({ uuid: `uuid-${path.basename(target)}` }));
    },
  });
}

function asset(root, guid, relativePath, bytes) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return {
    guid,
    path: file,
    relativePath,
    ext: path.extname(file).toLowerCase(),
    stem: path.basename(file, path.extname(file)),
  };
}

test('resolves a TMP font dependency by m_SourceFontFileGUID before name heuristics', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const ttf = asset(root, '22222222222222222222222222222222', 'Fonts/Exact.ttf', Buffer.from([0, 1, 0, 0]));
    const tmp = asset(root, '11111111111111111111111111111111', 'Fonts/Friendly SDF.asset',
      `m_SourceFontFileGUID: ${ttf.guid}\nm_FamilyName: Friendly\n`);
    const db = { get: (guid) => new Map([[ttf.guid, ttf], [tmp.guid, tmp]]).get(guid), byGuid: new Map([[ttf.guid, ttf], [tmp.guid, tmp]]) };
    assert.equal(resolveFontDependency(tmp, db), ttf);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copies and wires a resolved TMP TTF while preserving bold italic underline and alignment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const ttf = asset(root, '22222222222222222222222222222222', 'Fonts/Friendly.ttf', Buffer.from([0, 1, 0, 0]));
    const tmp = asset(root, '11111111111111111111111111111111', 'Fonts/Friendly SDF.asset',
      `m_SourceFontFile: {fileID: 12800000, guid: ${ttf.guid}, type: 3}\nm_FamilyName: Friendly\n`);
    const assets = new Map([[ttf.guid, ttf], [tmp.guid, tmp]]);
    const db = { get: (guid) => assets.get(guid), byGuid: assets };
    const reporter = makeReporter();
    const model = { componentDocs: new Map() };
    const config = makePorter(root).resolveLabelConfig({ fields: {
      m_fontAsset: ref(tmp.guid),
      m_fontStyle: 7,
      m_fontWeight: 700,
      m_HorizontalAlignment: 4,
      m_VerticalAlignment: 256,
      m_enableWordWrapping: 1,
    } }, { components: [] }, model, { cocosRoot: root, dryRun: false }, db,
    { resolveFontByStem: () => '' }, reporter);

    assert.equal(config.fontUuid, 'uuid-Friendly');
    assert.equal(config.fontFamily, 'Friendly');
    assert.equal(config.systemFallback, false);
    assert.equal(config.isBold, true);
    assert.equal(config.isItalic, true);
    assert.equal(config.isUnderline, true);
    assert.equal(config.horizontalAlign, 2);
    assert.equal(config.verticalAlign, 0);
    assert.equal(config.enableWrapText, true);
    assert.equal(reporter.events.some((event) => event.code === 'FONT_ASSET_COPIED_AND_WIRED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copies and wires a directly referenced Cocos-loadable webfont', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const webfont = asset(root, '55555555555555555555555555555555', 'Fonts/Promo.woff', Buffer.from('wOFF-webfont-fixture'));
    const db = { get: (guid) => guid === webfont.guid ? webfont : null, byGuid: new Map([[webfont.guid, webfont]]) };
    const reporter = makeReporter();
    const resolved = makePorter(root).resolveFont({ fields: { m_Font: ref(webfont.guid) } },
      { cocosRoot: root, dryRun: false }, db, { resolveFontByStem: () => '' }, reporter);
    assert.equal(resolved.systemFallback, false);
    assert.equal(resolved.fontUuid, 'uuid-Promo');
    assert.equal(fs.existsSync(path.join(root, 'assets', 'unity_imported', 'Fonts', 'Promo.woff')), true);
    assert.equal(reporter.events.some((event) => event.code === 'FONT_ASSET_COPIED_AND_WIRED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('maps legacy built-in Arial plus BoldItalic and sibling Shadow without an asset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const shadowDoc = { fields: {
      m_EffectColor: { r: 0.1, g: 0.2, b: 0.3, a: 0.6 },
      m_EffectDistance: { x: 3, y: -4 },
      m_Script: ref('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    } };
    const shadowScript = { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', stem: 'Shadow' };
    const db = { get: (guid) => guid === shadowScript.guid ? shadowScript : null, byGuid: new Map() };
    const model = { componentDocs: new Map([['shadow', shadowDoc]]) };
    const reporter = makeReporter();
    const config = makePorter(root).resolveLabelConfig({ fields: {
      m_FontData: {
        m_Font: ref('0000000000000000e000000000000000', 10102),
        m_FontStyle: 3,
        m_Alignment: 7,
        m_HorizontalOverflow: 0,
      },
    } }, { components: ['shadow'] }, model, { cocosRoot: root, dryRun: false }, db,
    { resolveFontByStem: () => '' }, reporter);

    assert.equal(config.fontUuid, '');
    assert.equal(config.fontFamily, 'Arial');
    assert.equal(config.exactSystemFont, true);
    assert.equal(config.isBold, true);
    assert.equal(config.isItalic, true);
    assert.equal(config.horizontalAlign, 1);
    assert.equal(config.verticalAlign, 2);
    assert.equal(config.enableShadow, true);
    assert.deepEqual(config.shadowOffset, { x: 3, y: -4 });
    assert.equal(reporter.events.some((event) => event.code === 'UNITY_BUILTIN_FONT_SYSTEM_MAPPED'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('converts an OTF dependency to a wired TTF before considering system fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const bytes = Buffer.alloc(12);
    bytes.write('OTTO', 0, 'ascii');
    const otf = asset(root, '22222222222222222222222222222222', 'Fonts/Custom.otf', bytes);
    const db = { get: (guid) => guid === otf.guid ? otf : null, byGuid: new Map([[otf.guid, otf]]) };
    const reporter = makeReporter();
    const resolved = makePorter(root).resolveFont({ fields: { m_Font: ref(otf.guid) } },
      { cocosRoot: root, dryRun: false }, db, { resolveFontByStem: () => '' }, reporter);
    assert.equal(resolved.systemFallback, false);
    assert.match(resolved.fontUuid, /Custom\.ttf/);
    assert.equal(fs.existsSync(path.join(root, 'assets', 'unity_imported', 'Fonts', 'Custom.ttf')), true);
    assert.equal(reporter.events.some((event) => event.code === 'FONT_CONVERTED_TO_TTF'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reads TMP outline and underlay settings from the referenced material', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const material = asset(root, '33333333333333333333333333333333', 'Fonts/Styled.mat', [
      'm_ShaderKeywords: OUTLINE_ON UNDERLAY_ON',
      '    - _OutlineWidth: 0.2',
      '    - _OutlineColor: {r: 1, g: 0.5, b: 0.25, a: 1}',
      '    - _UnderlayOffsetX: 3',
      '    - _UnderlayOffsetY: -2',
      '    - _UnderlaySoftness: 0.4',
      '    - _UnderlayColor: {r: 0, g: 0, b: 0, a: 0.6}',
    ].join('\n'));
    const style = tmpMaterialStyle(material);
    assert.equal(style.enableOutline, true);
    assert.equal(style.outlineWidth, 2);
    assert.equal(style.enableShadow, true);
    assert.deepEqual(style.shadowOffset, { x: 3, y: -2 });
    assert.equal(style.shadowBlur, 0.4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('follows a TMP font asset m_Material dependency when the label has no shared material override', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const ttf = asset(root, '22222222222222222222222222222222', 'Fonts/Styled.ttf', Buffer.from([0, 1, 0, 0]));
    const material = asset(root, '33333333333333333333333333333333', 'Fonts/Styled.mat', [
      'm_ShaderKeywords: OUTLINE_ON UNDERLAY_ON',
      '    - _OutlineWidth: 0.3',
      '    - _UnderlayOffsetX: 4',
    ].join('\n'));
    const tmp = asset(root, '11111111111111111111111111111111', 'Fonts/Styled SDF.asset', [
      `m_SourceFontFileGUID: ${ttf.guid}`,
      `m_Material: {fileID: 2100000, guid: ${material.guid}, type: 2}`,
      'm_FamilyName: Styled',
    ].join('\n'));
    const assets = new Map([[ttf.guid, ttf], [material.guid, material], [tmp.guid, tmp]]);
    const db = { get: (guid) => assets.get(guid), byGuid: assets };
    const config = makePorter(root).resolveLabelConfig({ fields: { m_fontAsset: ref(tmp.guid) } },
      { components: [] }, { componentDocs: new Map() }, { cocosRoot: root, dryRun: false }, db,
      { resolveFontByStem: () => '' }, makeReporter());
    assert.equal(config.enableOutline, true);
    assert.equal(config.outlineWidth, 3);
    assert.equal(config.enableShadow, true);
    assert.equal(config.shadowOffset.x, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not enable dormant TMP outline or underlay properties without active material keywords', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const material = asset(root, '66666666666666666666666666666666', 'Fonts/Dormant.mat', [
      'm_ValidKeywords: []',
      'm_InvalidKeywords:',
      '  - OUTLINE_ON',
      '  - UNDERLAY_ON',
      '    - _OutlineWidth: 0.4',
      '    - _UnderlayDilate: 0.218',
      '    - _UnderlaySoftness: 0.4',
    ].join('\n'));
    const style = tmpMaterialStyle(material);
    assert.equal(style.enableOutline, false);
    assert.equal(style.enableShadow, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('enables only the TMP effects listed in m_ValidKeywords', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const material = asset(root, '77777777777777777777777777777777', 'Fonts/OutlineOnly.mat', [
      'm_ValidKeywords:',
      '  - OUTLINE_ON',
      'm_InvalidKeywords:',
      '  - UNDERLAY_ON',
      '    - _OutlineWidth: 0.25',
      '    - _UnderlayDilate: 0.218',
      '    - _UnderlayOffsetY: -0.843',
    ].join('\n'));
    const style = tmpMaterialStyle(material);
    assert.equal(style.enableOutline, true);
    assert.equal(style.outlineWidth, 3);
    assert.equal(style.enableShadow, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('attempts conversion for a directly referenced unknown font before high-severity system fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-porter-test-'));
  try {
    const custom = asset(root, '44444444444444444444444444444444', 'Fonts/Arcade.customfont', Buffer.from('vendor-font'));
    const db = { get: (guid) => guid === custom.guid ? custom : null, byGuid: new Map([[custom.guid, custom]]) };
    const reporter = makeReporter();
    const resolved = makePorter(root).resolveFont({ fields: { m_Font: ref(custom.guid) } },
      { cocosRoot: root, dryRun: false }, db, { resolveFontByStem: () => '' }, reporter);
    assert.equal(resolved.systemFallback, true);
    assert.equal(reporter.events.some((event) => event.code === 'FONT_CONVERSION_FAILED_SYSTEM_FALLBACK'), true);
    assert.equal(reporter.events.some((event) => event.code === 'FONT_SOURCE_UNRESOLVED_SYSTEM_FALLBACK'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves TMP style and weight overrides on nested prefab label instances', () => {
  const sourceGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const sourceFileId = '11400001';
  const sourceDoc = { classId: 114, lines: [
    'MonoBehaviour:',
    '  m_text: Nested label',
    '  m_fontAsset: {fileID: 11400000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 2}',
    '  m_fontStyle: 0',
    '  m_fontWeight: 400',
  ] };
  const gameObject = { nestedPrefab: {
    sourceGuid,
    model: { roots: [], componentDocs: new Map([[sourceFileId, sourceDoc]]) },
    overrideInfo: {
      overridesByTarget: new Map([[`${sourceGuid}:${sourceFileId}`, { m_fontStyle: 7, m_fontWeight: 700 }]]),
    },
  } };
  const overrides = buildNestedPrefabPropertyOverrides(gameObject, {}, gameObject.nestedPrefab.model);
  const byProperty = new Map(overrides.map((entry) => [entry.propertyPath, entry.value]));
  assert.equal(byProperty.get('_isBold'), true);
  assert.equal(byProperty.get('_isItalic'), true);
  assert.equal(byProperty.get('_isUnderline'), true);
});
