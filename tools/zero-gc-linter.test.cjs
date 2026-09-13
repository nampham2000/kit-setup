'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { lintFile } = require('./zero-gc-linter.cjs');

function withTypeScript(source, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-label-effect-lint-'));
  const file = path.join(directory, 'LabelFixture.ts');
  try {
    fs.writeFileSync(file, source, 'utf8');
    run(lintFile(file));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('deprecated LabelOutline and LabelShadow named imports fail the portable lint gate', () => {
  withTypeScript(
    "import { Label, LabelOutline as Outline, LabelShadow } from 'cc';\nvoid Label; void Outline; void LabelShadow;\n",
    (violations) => {
      const deprecated = violations.filter((item) => item.rule === 'DEPRECATED_COCOS_LABEL_EFFECT_COMPONENT');
      assert.deepEqual(deprecated.map((item) => item.snippet), ['LabelOutline as Outline', 'LabelShadow']);
      assert.ok(deprecated.every((item) => item.severity === 'error'));
    },
  );
});

test('deprecated label effects are detected through a cc namespace import', () => {
  withTypeScript(
    "import * as cc from 'cc';\nconst outline = cc.LabelOutline;\nconst shadow = cc.LabelShadow;\n",
    (violations) => {
      const deprecated = violations.filter((item) => item.rule === 'DEPRECATED_COCOS_LABEL_EFFECT_COMPONENT');
      assert.deepEqual(deprecated.map((item) => item.line), [2, 3]);
    },
  );
});

test('the Cocos 3.8 Label-owned outline and shadow API remains lint-clean', () => {
  withTypeScript(
    "import { Label } from 'cc';\nexport function style(label: Label): void { label.enableOutline = true; label.outlineWidth = 3; label.enableShadow = true; label.shadowBlur = 1; }\n",
    (violations) => {
      assert.equal(
        violations.some((item) => item.rule === 'DEPRECATED_COCOS_LABEL_EFFECT_COMPONENT'),
        false,
      );
    },
  );
});
