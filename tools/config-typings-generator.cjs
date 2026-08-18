#!/usr/bin/env node
'use strict';

/**
 * Playable Config TypeScript Typings Generator
 *
 * Generates strongly typed TypeScript interfaces from assets/resources/playable-config.json
 * so GitHub Copilot, Cursor, and IDE TypeScript intellisense provide 100% accurate autocomplete
 * for PlayableConfigManager.
 */

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackageJson = fs.existsSync(path.join(current, 'package.json'));
    const looksLikeCocosProject = fs.existsSync(path.join(current, 'assets'))
      || fs.existsSync(path.join(current, 'configs'));
    if (hasPackageJson && looksLikeCocosProject) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const ROOT_DIR = process.env.PLAYABLE_PROJECT_ROOT
  ? path.resolve(process.env.PLAYABLE_PROJECT_ROOT)
  : (findProjectRoot(process.cwd()) || process.cwd());

const CONFIG_PATH = path.join(ROOT_DIR, 'assets', 'resources', 'playable-config.json');
const OUTPUT_DTS = path.join(ROOT_DIR, 'assets', 'script', 'shared', 'core', 'config', 'PlayableConfigTypes.d.ts');

function inferTsType(value) {
  if (value === null || value === undefined) return 'any';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'any[]';
    return `${inferTsType(value[0])}[]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return 'Record<string, any>';
    const fields = keys.map((k) => `    ${k}: ${inferTsType(value[k])};`).join('\n');
    return `{\n${fields}\n  }`;
  }
  return 'any';
}

function generateTypings() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(`[config-typings] Config file not found at: ${CONFIG_PATH}`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  let dts = `/**\n * Auto-generated Playable Configuration Typings\n * DO NOT EDIT MANUALLY - Generated from assets/resources/playable-config.json\n */\n\n`;

  for (const section of Object.keys(raw)) {
    if (section === '$schema' || section === 'title' || section === 'version') continue;
    const value = raw[section];
    const typeName = `I${section.charAt(0).toUpperCase() + section.slice(1)}Config`;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      dts += `export interface ${typeName} {\n`;
      for (const key of Object.keys(value)) {
        dts += `  ${key}?: ${inferTsType(value[key])};\n`;
      }
      dts += `}\n\n`;
    }
  }

  dts += `export interface IPlayableFullConfig {\n`;
  for (const section of Object.keys(raw)) {
    if (section === '$schema' || section === 'title' || section === 'version') continue;
    const typeName = `I${section.charAt(0).toUpperCase() + section.slice(1)}Config`;
    dts += `  ${section}?: ${typeName};\n`;
  }
  dts += `  custom?: Record<string, any>;\n`;
  dts += `}\n`;

  const outDir = path.dirname(OUTPUT_DTS);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_DTS, dts, 'utf8');
  console.log(`[config-typings] Generated ${path.relative(ROOT_DIR, OUTPUT_DTS)}`);
}

if (require.main === module) {
  generateTypings();
}

module.exports = { generateTypings };
