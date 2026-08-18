'use strict';

/**
 * Unity C# to Cocos Creator 3.8.8+ TypeScript Scaffolder
 *
 * Converts Unity MonoBehaviour C# scripts into clean, production-ready
 * Cocos Creator TypeScript classes with Zero-GC patterns, decorators,
 * and Playable Ads lifecycle hooks.
 */

const fs = require('fs');
const path = require('path');

function scaffoldCSharpToTypeScript(csharpCode, classNameFallback = 'ScaffoldedComponent') {
  // 1. Extract class name
  const classMatch = csharpCode.match(/class\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_]+))?/);
  const className = classMatch ? classMatch[1] : classNameFallback;

  // 2. Extract serialized fields
  // Matches [SerializeField] private float speed = 5f; or public float speed;
  const fieldRegex = /(?:\[SerializeField\]\s*(?:private|protected|public)?|(?:public))\s+([A-Za-z0-9_<>[\]]+)\s+([A-Za-z0-9_]+)(?:\s*=\s*([^;]+))?;/g;
  const fields = [];
  let match;

  while ((match = fieldRegex.exec(csharpCode)) !== null) {
    const rawType = match[1].trim();
    const name = match[2].trim();
    let defaultValue = match[3] ? match[3].trim().replace(/f$/i, '') : null;

    let tsType = 'any';
    let propertyDecorator = '@property';
    let initValue = 'null!';

    if (/^(float|double)$/i.test(rawType)) {
      tsType = 'number';
      propertyDecorator = '@property(CCFloat)';
      initValue = defaultValue || '0';
    } else if (/^(int|long|short|byte)$/i.test(rawType)) {
      tsType = 'number';
      propertyDecorator = '@property(CCInteger)';
      initValue = defaultValue || '0';
    } else if (/^bool$/i.test(rawType)) {
      tsType = 'boolean';
      propertyDecorator = '@property(CCBoolean)';
      initValue = defaultValue || 'false';
    } else if (/^string$/i.test(rawType)) {
      tsType = 'string';
      propertyDecorator = '@property(CCString)';
      initValue = defaultValue ? `"${defaultValue.replace(/['"]/g, '')}"` : '""';
    } else if (/^(GameObject|Transform)$/i.test(rawType)) {
      tsType = 'Node';
      propertyDecorator = '@property(Node)';
      initValue = 'null!';
    } else if (/^(GameObject\[\]|Transform\[\]|List<GameObject>|List<Transform>)$/i.test(rawType)) {
      tsType = 'Node[]';
      propertyDecorator = '@property([Node])';
      initValue = '[]';
    } else if (/^AudioClip$/i.test(rawType)) {
      tsType = 'AudioClip';
      propertyDecorator = '@property(AudioClip)';
      initValue = 'null!';
    } else if (/^Vector3$/i.test(rawType)) {
      tsType = 'Vec3';
      propertyDecorator = '@property(Vec3)';
      initValue = 'new Vec3()';
    } else if (/^Color$/i.test(rawType)) {
      tsType = 'Color';
      propertyDecorator = '@property(Color)';
      initValue = 'new Color(255, 255, 255, 255)';
    }

    fields.push({
      name,
      tsType,
      propertyDecorator,
      initValue
    });
  }

  // 3. Scan for common method implementations
  const hasAwake = /void\s+Awake\s*\(/i.test(csharpCode);
  const hasStart = /void\s+Start\s*\(/i.test(csharpCode);
  const hasUpdate = /void\s+Update\s*\(/i.test(csharpCode);
  const hasFixedUpdate = /void\s+FixedUpdate\s*\(/i.test(csharpCode);
  const hasOnDestroy = /void\s+OnDestroy\s*\(/i.test(csharpCode);
  const hasOnCollision = /void\s+OnCollisionEnter\s*\(/i.test(csharpCode);
  const hasOnTrigger = /void\s+OnTriggerEnter\s*\(/i.test(csharpCode);

  // 4. Build TypeScript output
  let ts = `import { _decorator, Component, Node, Vec3, Quat, Color, CCFloat, CCInteger, CCBoolean, CCString, AudioClip, tween } from 'cc';\n`;
  ts += `import { GameManager, PlayableConfigManager } from 'playable-core';\n`;
  ts += `import { SuperHtmlPlayable } from 'playable-sdk';\n\n`;
  ts += `const { ccclass, property } = _decorator;\n\n`;
  ts += `// Pre-allocated temp variables for Zero-GC in update loops\n`;
  ts += `const _tempVec3 = new Vec3();\n`;
  ts += `const _tempQuat = new Quat();\n\n`;
  ts += `@ccclass('${className}')\n`;
  ts += `export class ${className} extends Component {\n`;

  // Render properties
  if (fields.length > 0) {
    for (const f of fields) {
      ts += `  ${f.propertyDecorator}\n`;
      ts += `  public ${f.name}: ${f.tsType} = ${f.initValue};\n\n`;
    }
  }

  // Render onLoad / Awake
  if (hasAwake) {
    ts += `  onLoad() {\n`;
    ts += `    // Converted from Unity Awake()\n`;
    ts += `  }\n\n`;
  }

  // Render start / Start
  ts += `  start() {\n`;
  if (hasStart) {
    ts += `    // Converted from Unity Start()\n`;
  }
  ts += `    // Access designer configs: PlayableConfigManager.instance.get('custom.${className.toLowerCase()}', defaultValue)\n`;
  ts += `  }\n\n`;

  // Render update
  if (hasUpdate || hasFixedUpdate) {
    ts += `  update(dt: number) {\n`;
    ts += `    // ZERO-GC: Reuse _tempVec3 / _tempQuat instead of 'new Vec3()'\n`;
    ts += `  }\n\n`;
  }

  // Render collision / trigger
  if (hasOnCollision) {
    ts += `  onCollisionEnter(selfCollider: any, otherCollider: any, contact: any) {\n`;
    ts += `    // Converted from Unity OnCollisionEnter\n`;
    ts += `  }\n\n`;
  }

  if (hasOnTrigger) {
    ts += `  onTriggerEnter(event: any) {\n`;
    ts += `    // Converted from Unity OnTriggerEnter\n`;
    ts += `  }\n\n`;
  }

  // Render onDestroy
  if (hasOnDestroy) {
    ts += `  onDestroy() {\n`;
    ts += `    // Cleanup event listeners\n`;
    ts += `  }\n\n`;
  }

  ts += `}\n`;

  return {
    className,
    tsCode: ts,
    fieldCount: fields.length
  };
}

function scaffoldFile(csharpFilePath, outputTsPath = null) {
  if (!fs.existsSync(csharpFilePath)) {
    throw new Error(`C# file not found: ${csharpFilePath}`);
  }

  const content = fs.readFileSync(csharpFilePath, 'utf8');
  const baseName = path.basename(csharpFilePath, path.extname(csharpFilePath));
  const result = scaffoldCSharpToTypeScript(content, baseName);

  const finalOutPath = outputTsPath || path.join(path.dirname(csharpFilePath), `${result.className}.ts`);
  const outDir = path.dirname(finalOutPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(finalOutPath, result.tsCode, 'utf8');
  return {
    ...result,
    outputPath: finalOutPath
  };
}

module.exports = {
  scaffoldCSharpToTypeScript,
  scaffoldFile
};
