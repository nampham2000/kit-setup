'use strict';

// Unity 2020.2+ ShaderGraph files (graph version 3) are a stream of concatenated JSON documents:
// GraphData first, then every property/node/slot/target keyed by m_ObjectId and referenced as
// { "m_Id": … }. The parser used JSON.parse on the whole file and failed at the second document
// (JellyCubeRun2048 TintMask.shadergraph: "Unexpected non-whitespace character after JSON"), and its
// transparency check treated any node without m_BlendMode as transparent.
const assert = require('node:assert/strict');
const test = require('node:test');
const { ShaderGraphParser } = require('./unity-shadergraph-parser.js');

function graph({ surface = 0, alphaClip = false } = {}) {
  const docs = [
    {
      m_SGVersion: 3, m_Type: 'UnityEditor.ShaderGraph.GraphData', m_ObjectId: 'g',
      m_Properties: [{ m_Id: 'p-color' }],
      m_Nodes: [{ m_Id: 'n-prop' }, { m_Id: 'n-base' }],
      m_Edges: [{ m_OutputSlot: { m_Node: { m_Id: 'n-prop' }, m_SlotId: 0 }, m_InputSlot: { m_Node: { m_Id: 'n-base' }, m_SlotId: 0 } }],
      m_ActiveTargets: [{ m_Id: 't-urp' }],
    },
    { m_SGVersion: 1, m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty', m_ObjectId: 'p-color', m_Name: 'Color', m_DefaultReferenceName: '_Color', m_Value: { r: 1, g: 0.5, b: 0, a: 1 } },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_ObjectId: 'n-prop', m_Name: 'Property', m_Slots: [{ m_Id: 's-prop-out' }], m_Property: { m_Id: 'p-color' } },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.Vector4MaterialSlot', m_ObjectId: 's-prop-out', m_Id: 0, m_DisplayName: 'Color', m_SlotType: 1, m_Value: { x: 0, y: 0, z: 0, w: 0 } },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.BlockNode', m_ObjectId: 'n-base', m_Name: 'SurfaceDescription.BaseColor', m_Slots: [{ m_Id: 's-base-in' }], m_SerializedDescriptor: 'SurfaceDescription.BaseColor' },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.ColorRGBMaterialSlot', m_ObjectId: 's-base-in', m_Id: 0, m_DisplayName: 'Base Color', m_SlotType: 0, m_Value: { x: 0.5, y: 0.5, z: 0.5 } },
    { m_SGVersion: 1, m_Type: 'UnityEditor.Rendering.Universal.ShaderGraph.UniversalTarget', m_ObjectId: 't-urp', m_ActiveSubTarget: { m_Id: 't-lit' }, m_SurfaceType: surface, m_AlphaClip: alphaClip },
    { m_SGVersion: 2, m_Type: 'UnityEditor.Rendering.Universal.ShaderGraph.UniversalLitSubTarget', m_ObjectId: 't-lit', m_WorkflowMode: 1 },
  ];
  // Unity writes each document pretty-printed and separated by a blank line.
  return docs.map(doc => JSON.stringify(doc, null, 4)).join('\n\n');
}

test('a graph-version-3 multi-document ShaderGraph parses with properties, nodes and edges', () => {
  const parser = new ShaderGraphParser(graph(), {});
  assert.deepEqual(parser.properties.map(p => p.name), ['Color']);
  assert.equal(parser.nodes.size, 2);
  assert.equal(parser.edges.length, 1);
  assert.equal(parser.targetShadingModel, 'lit', 'UniversalLitSubTarget selects the lit backend');
  assert.equal(parser.isTransparent, false, 'nodes without m_BlendMode do not make the graph transparent');
  assert.equal(parser.hasAlphaClip, false);
});

test('surface type and alpha clip come from the URP target objects', () => {
  const parser = new ShaderGraphParser(graph({ surface: 1, alphaClip: true }), {});
  assert.equal(parser.isTransparent, true);
  assert.equal(parser.hasAlphaClip, true);
});

test('single-document (legacy) graphs still parse unchanged', () => {
  const legacy = JSON.stringify({ m_Properties: [], m_Nodes: [], m_Edges: [] });
  const parser = new ShaderGraphParser(legacy, {});
  assert.equal(parser.nodes.size, 0);
});

// SampleTexture2DNode slots are Texture 1, UV 2 (inputs) and RGBA 0, R 4, G 5, B 6, A 7 (outputs).
// Reading the texture from slot 0 left every graph sampling an undeclared `mainTexture` with the
// texture property as its UV (Cocos EFX2300: JellyCubeRun2048 EnergyShield/TintMask/Lava/WarningWall).
test('Sample Texture 2D reads its Texture/UV inputs and publishes RGBA on slot 0', () => {
  const docs = [
    {
      m_SGVersion: 3, m_Type: 'UnityEditor.ShaderGraph.GraphData', m_ObjectId: 'g',
      m_Properties: [{ m_Id: 'p-tex' }],
      m_Nodes: [{ m_Id: 'n-tex' }, { m_Id: 'n-uv' }, { m_Id: 'n-sample' }, { m_Id: 'n-base' }],
      m_Edges: [
        { m_OutputSlot: { m_Node: { m_Id: 'n-tex' }, m_SlotId: 0 }, m_InputSlot: { m_Node: { m_Id: 'n-sample' }, m_SlotId: 1 } },
        { m_OutputSlot: { m_Node: { m_Id: 'n-uv' }, m_SlotId: 3 }, m_InputSlot: { m_Node: { m_Id: 'n-sample' }, m_SlotId: 2 } },
        { m_OutputSlot: { m_Node: { m_Id: 'n-sample' }, m_SlotId: 0 }, m_InputSlot: { m_Node: { m_Id: 'n-base' }, m_SlotId: 0 } },
      ],
      m_ActiveTargets: [{ m_Id: 't-urp' }],
    },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty', m_ObjectId: 'p-tex', m_Name: 'Pattern', m_DefaultReferenceName: 'Pattern', m_Value: {} },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_ObjectId: 'n-tex', m_Name: 'Property', m_Slots: [{ m_Id: 's-tex-out' }], m_Property: { m_Id: 'p-tex' } },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.Texture2DMaterialSlot', m_ObjectId: 's-tex-out', m_Id: 0, m_DisplayName: 'Pattern', m_SlotType: 1 },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.TilingAndOffsetNode', m_ObjectId: 'n-uv', m_Name: 'Tiling And Offset', m_Slots: [] },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode', m_ObjectId: 'n-sample', m_Name: 'Sample Texture 2D', m_Slots: [] },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.BlockNode', m_ObjectId: 'n-base', m_Name: 'SurfaceDescription.BaseColor', m_Slots: [{ m_Id: 's-base-in' }], m_SerializedDescriptor: 'SurfaceDescription.BaseColor' },
    { m_SGVersion: 0, m_Type: 'UnityEditor.ShaderGraph.ColorRGBMaterialSlot', m_ObjectId: 's-base-in', m_Id: 0, m_DisplayName: 'Base Color', m_SlotType: 0, m_Value: { x: 0.5, y: 0.5, z: 0.5 } },
    { m_SGVersion: 1, m_Type: 'UnityEditor.Rendering.Universal.ShaderGraph.UniversalTarget', m_ObjectId: 't-urp', m_ActiveSubTarget: { m_Id: 't-unlit' }, m_SurfaceType: 0 },
    { m_SGVersion: 2, m_Type: 'UnityEditor.Rendering.Universal.ShaderGraph.UniversalUnlitSubTarget', m_ObjectId: 't-unlit' },
  ];
  const parser = new ShaderGraphParser(docs.map(doc => JSON.stringify(doc, null, 4)).join('\n\n'), {});
  const glsl = String(parser._transpileGraphToGLSL());
  assert.match(glsl, /texture\(Pattern, _sg_tilingOffset_\d+\)/, 'samples the texture property with the tiling UV');
  assert.doesNotMatch(glsl, /texture\(mainTexture/);
});
