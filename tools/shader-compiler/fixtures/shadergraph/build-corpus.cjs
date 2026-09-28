#!/usr/bin/env node
'use strict';
/**
 * Rebuild a ShaderGraph regression corpus bundle from a directory of dumped generated code
 * (tools/unity-intel/dump-shadergraph-code.cs output).
 *
 *   node build-corpus.cjs <dumpDir> <out.json.gz>
 *
 * Each graph keeps the shader header (Properties + SubShader tags) and only the passes the generator reads
 * (LightMode Universal2D / UniversalForward / UniversalForwardOnly / NormalsRendering, first of each name), which
 * roughly halves the text without changing generator output. The bundle is { "<graph>": "<trimmed text>" } gzip'd.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { splitPasses } = require('../../shadergraph/sg-source.cjs');

function trimGeneratedShader(text) {
  const src = String(text).replace(/\r\n/g, '\n');
  const passes = splitPasses(src);
  if (!passes.length) return src;
  const head = src.slice(0, src.indexOf(passes[0]));
  const seen = new Set();
  const keep = passes.filter((p) => {
    const lightMode = (/"LightMode"\s*=\s*"([^"]+)"/.exec(p) || [])[1];
    if (lightMode && !/^(Universal2D|UniversalForward|UniversalForwardOnly|NormalsRendering)$/.test(lightMode)) return false;
    const name = (/Name\s+"([^"]+)"/.exec(p) || [])[1] || '';
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  return `${head}${keep.join('')}\n}\n}\n`;
}

function buildCorpus(dumpDir) {
  const out = {};
  for (const file of fs.readdirSync(dumpDir).filter((f) => /\.shader\.txt$/.test(f)).sort()) {
    out[file.replace(/\.shader\.txt$/, '')] = trimGeneratedShader(fs.readFileSync(path.join(dumpDir, file), 'utf8'));
  }
  return out;
}

function loadCorpus(bundle) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(bundle)).toString('utf8'));
}

if (require.main === module) {
  const [dumpDir, outFile] = process.argv.slice(2);
  if (!dumpDir || !outFile) { console.error('usage: node build-corpus.cjs <dumpDir> <out.json.gz>'); process.exit(2); }
  const corpus = buildCorpus(dumpDir);
  fs.writeFileSync(outFile, zlib.gzipSync(JSON.stringify(corpus), { level: 9 }));
  console.log(`${Object.keys(corpus).length} graphs -> ${outFile}`);
}

module.exports = { trimGeneratedShader, buildCorpus, loadCorpus };
