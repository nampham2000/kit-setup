'use strict';

const os = require('os');
const path = require('path');

const DEFAULT_EMBEDDING_DIMENSIONS = 384;
const DEFAULT_EMBEDDING_PROVIDER = 'transformers.js';
const DEFAULT_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DEFAULT_MODEL_CACHE_DIR = path.join(os.homedir(), '.copilot-work-memory', 'models');

let extractorPromise = null;
let transformersPromise = null;

function loadTransformers() {
  if (!transformersPromise) {
    transformersPromise = import('@xenova/transformers');
  }
  return transformersPromise;
}

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await loadTransformers();
      env.cacheDir = process.env.WORK_MEMORY_MODEL_CACHE_DIR || DEFAULT_MODEL_CACHE_DIR;
      env.allowLocalModels = true;
      return pipeline('feature-extraction', DEFAULT_EMBEDDING_MODEL, { quantized: true });
    })();
  }
  return extractorPromise;
}

async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(String(text || ''), { pooling: 'mean', normalize: true });
  const vector = output.tolist()[0];
  return Array.from(vector, (value) => Number(value.toFixed(6)));
}

function buildMemoryEmbeddingInput(memory) {
  const title = String(memory.title || '').trim();
  const content = String(memory.content || '').trim();
  const category = String(memory.category || '').trim();
  const tags = Array.isArray(memory.tags) ? memory.tags.join(' ') : '';
  const source = [memory.sourceSymbol || '', memory.sourcePath || ''].filter(Boolean).join(' ');
  return [
    category,
    title,
    title,
    tags,
    source,
    content,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildQueryEmbeddingInput(query) {
  return [
    String(query.text || '').trim(),
    Array.isArray(query.tags) ? query.tags.join(' ') : '',
    String(query.category || '').trim(),
    String(query.sourceSymbol || '').trim(),
    String(query.sourcePath || '').trim(),
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MODEL_CACHE_DIR,
  embedText,
  buildMemoryEmbeddingInput,
  buildQueryEmbeddingInput,
};
