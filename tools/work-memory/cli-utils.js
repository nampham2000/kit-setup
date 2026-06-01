'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const command = args.shift() || null;
  const options = {};
  while (args.length) {
    const token = args.shift();
    if (!token) continue;
    if (token.startsWith('--')) {
      const eqIndex = token.indexOf('=');
      if (eqIndex !== -1) {
        const key = token.slice(2, eqIndex);
        const value = token.slice(eqIndex + 1);
        options[key] = value;
        continue;
      }
      const key = token.slice(2);
      if (!args.length || String(args[0]).startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = args.shift();
      }
      continue;
    }
    if (!options._) options._ = [];
    options._.push(token);
  }
  return { command, options };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printTable(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    console.log('(no rows)');
    return;
  }
  const columns = Object.keys(rows[0]);
  const widths = new Map(columns.map((column) => [column, column.length]));
  for (const row of rows) {
    for (const column of columns) {
      const text = String(row[column] ?? '');
      widths.set(column, Math.max(widths.get(column), text.length));
    }
  }
  const header = columns.map((column) => column.padEnd(widths.get(column))).join('  ');
  const divider = columns.map((column) => '-'.repeat(widths.get(column))).join('  ');
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(columns.map((column) => String(row[column] ?? '').padEnd(widths.get(column))).join('  '));
  }
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readStdinIfAvailable() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readTextFromArgs(options, fallback = '') {
  if (options.content) return String(options.content);
  if (options['content-file']) {
    return fs.readFileSync(String(options['content-file']), 'utf8');
  }
  const stdin = readStdinIfAvailable();
  if (stdin.trim()) return stdin;
  return fallback;
}

function normalizeScope(value) {
  const scope = String(value || 'repo').toLowerCase();
  if (scope !== 'repo' && scope !== 'global' && scope !== 'hybrid') {
    throw new Error(`Invalid scope: ${value}`);
  }
  return scope;
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

module.exports = {
  parseArgs,
  printJson,
  printTable,
  parseCsv,
  readTextFromArgs,
  normalizeScope,
  parseNumber,
  parseBoolean,
};