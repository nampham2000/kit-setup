'use strict';

module.exports = {
  ...require('./schema.cjs'),
  ...require('./diagnostics.cjs'),
  ...require('./guid-index.cjs'),
  ...require('./dependency-graph.cjs'),
  ...require('./cache.cjs'),
  ...require('./asset-reader.cjs'),
  ...require('./package-roots.cjs'),
  ...require('./script-index.cjs'),
  ...require('./project-index.cjs'),
  ...require('./live-schema.cjs'),
  ...require('./snapshot-merge.cjs'),
  ...require('./compact-projection.cjs'),
  ...require('./feature-sketch.cjs'),
  ...require('./unity-editor.cjs'),
  ...require('./unity-bootstrap.cjs'),
  ...require('./unity-bootstrap-footprint.cjs'),
  ...require('./unity-mcp-config.cjs'),
  ...require('./unity-mcp-provider.cjs'),
  ...require('./unity-batch-provider.cjs'),
  ...require('./service.cjs'),
};
