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

function propertyName(key) {
  const value = String(key);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function interfaceName(section) {
  const safe = String(section)
    .replace(/[^A-Za-z0-9_$]+(.)?/g, (_match, next) => next ? next.toUpperCase() : '')
    .replace(/^[^A-Za-z_$]+/, '');
  const base = safe || 'Section';
  return `I${base.charAt(0).toUpperCase()}${base.slice(1)}Config`;
}

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
    const fields = keys.map((k) => `    ${propertyName(k)}: ${inferTsType(value[k])};`).join('\n');
    return `{\n${fields}\n  }`;
  }
  return 'any';
}

function buildTypings(raw) {
  let dts = `/**\n * Auto-generated Playable Configuration Typings\n * DO NOT EDIT MANUALLY - Generated from assets/resources/playable-config.json\n */\n\n`;

  const sections = Object.keys(raw)
    .filter((section) => section !== '$schema' && section !== 'title' && section !== 'version');

  for (const section of sections) {
    const value = raw[section];
    const typeName = interfaceName(section);

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      dts += `export interface ${typeName} {\n`;
      for (const key of Object.keys(value)) {
        dts += `  ${propertyName(key)}?: ${inferTsType(value[key])};\n`;
      }
      dts += `}\n\n`;
    }
  }

  dts += `export interface IPlayableFullConfig {\n`;
  for (const section of sections) {
    const value = raw[section];
    const sectionType = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? interfaceName(section)
      : inferTsType(value);
    dts += `  ${propertyName(section)}?: ${sectionType};\n`;
  }
  if (!sections.includes('custom')) {
    dts += `  custom?: Record<string, any>;\n`;
  }
  dts += `}\n`;
  return dts;
}

function generateTypings(options = {}) {
  const configPath = options.configPath || CONFIG_PATH;
  const outputPath = options.outputPath || OUTPUT_DTS;
  if (!fs.existsSync(configPath)) {
    console.warn(`[config-typings] Config file not found at: ${configPath}`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const dts = buildTypings(raw);

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, dts, 'utf8');
  console.log(`[config-typings] Generated ${path.relative(ROOT_DIR, outputPath)}`);
  return outputPath;
}

if (require.main === module) {
  generateTypings();
}

module.exports = { buildTypings, generateTypings, inferTsType, interfaceName, propertyName };
