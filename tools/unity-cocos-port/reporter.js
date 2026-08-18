'use strict';

const fs = require('fs');
const path = require('path');
const { REPORT_COLUMNS, SEVERITY_ORDER } = require('./constants');
const { ensureDir, csvEscape, readJsonIfExists } = require('./core-utils');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < String(text || '').length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item !== ''));
}

function readExistingReportRows(file) {
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0];
  if (header[0] !== 'prefab') return [];
  const indexes = new Map(header.map((name, index) => [name, index]));
  return rows.slice(1).map((row) => {
    const record = {};
    for (const column of REPORT_COLUMNS) record[column] = row[indexes.get(column)] || '';
    return record;
  }).filter((record) => record.prefab);
}

class Reporter {
  constructor() {
    this.issues = [];
  }

  add(severity, code, source, target, message, detail = '') {
    const level = String(severity || 'low').toLowerCase();
    this.issues.push({
      severity: SEVERITY_ORDER[level] == null ? 'low' : level,
      code,
      source: source || '',
      target: target || '',
      message,
      detail: detail || '',
    });
  }

  high(code, source, target, message, detail) {
    this.add('high', code, source, target, message, detail);
  }

  medium(code, source, target, message, detail) {
    this.add('medium', code, source, target, message, detail);
  }

  low(code, source, target, message, detail) {
    this.add('low', code, source, target, message, detail);
  }

  sorted() {
    return [...this.issues].sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return String(a.code).localeCompare(String(b.code));
    });
  }

  writeCsv(file, prefabName = '') {
    if (!file) return '';
    ensureDir(path.dirname(file));
    const prefab = String(prefabName || 'general');
    const existingRows = readExistingReportRows(file).filter((row) => row.prefab !== prefab);
    const currentRows = this.sorted().map((issue) => ({
      prefab,
      severity: issue.severity,
      code: issue.code,
      source: issue.source,
      target: issue.target,
      message: issue.message,
      detail: issue.detail,
    }));

    const lines = [REPORT_COLUMNS.join(',')];
    for (const row of [...existingRows, ...currentRows]) {
      lines.push(REPORT_COLUMNS.map((column) => csvEscape(row[column])).join(','));
    }
    const csv = `${lines.join('\n')}\n`;
    const writeAtomically = (target) => {
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, csv, 'utf8');
      fs.renameSync(tmp, target);
    };

    try {
      writeAtomically(file);
      return file;
    } catch (error) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fallback = `${file.replace(/\.csv$/i, '')}.${stamp}.csv`;
      writeAtomically(fallback);
      console.warn(`[unity-cocos-port] WARN: Report file is locked (${error.code || error.message}). Wrote fallback report: ${fallback}`);
      return fallback;
    }
  }

  summary() {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const issue of this.issues) counts[issue.severity] += 1;
    return counts;
  }
}

module.exports = {
  parseCsv,
  readExistingReportRows,
  Reporter,
};
