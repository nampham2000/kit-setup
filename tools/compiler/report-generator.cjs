'use strict';

/**
 * Migration Report Multi-Format Generator
 *
 * Implements Section 9.5 of the Migration Specification:
 * - migration-report.json (machine-readable)
 * - migration-report.md (GitHub-Flavored Markdown summary)
 * - migration-report.html (interactive standalone HTML dashboard)
 */

const fs = require('fs');
const path = require('path');

class ReportGenerator {
  /**
   * Generates a GitHub-Flavored Markdown report.
   * @param {Object} reportData
   * @returns {string}
   */
  generateMarkdown(reportData) {
    const lines = [
      `# Unity to Cocos Creator Migration Report`,
      ``,
      `**Generated:** ${reportData.timestamp || new Date().toISOString()}`,
      `**Total Files Scanned:** ${reportData.total || 0}`,
      `**Passed:** ${reportData.passed || 0} | **Failed:** ${reportData.failed || 0}`,
      ``,
      `## Migration Metrics`,
      ``,
      `| Metric | Value |`,
      `| --- | --- |`,
      `| Parser & Emitter Passed | ${reportData.metrics?.parserAndEmitterPassed ?? reportData.passed} |`,
      `| TypeScript Syntax Valid | ${reportData.metrics?.typescriptSyntaxValid ?? reportData.passed} |`,
      `| Migration TODOs | ${reportData.metrics?.migrationTodos ?? 0} |`,
      `| High Confidence (>= 90%) | ${reportData.metrics?.highConfidence ?? 0} |`,
      `| Medium Confidence (70-89%) | ${reportData.metrics?.mediumConfidence ?? 0} |`,
      `| Low Confidence (< 70%) | ${reportData.metrics?.lowConfidence ?? 0} |`,
      ``,
      `## File Results`,
      ``,
      `| Source File | Status | Confidence | Duration |`,
      `| --- | --- | --- | --- |`,
    ];

    for (const res of reportData.results || []) {
      const statusBadge = res.success ? '✅ PASS' : '❌ FAIL';
      const conf = typeof res.confidence === 'number' ? `${(res.confidence * 100).toFixed(0)}%` : 'N/A';
      lines.push(`| \`${res.file}\` | ${statusBadge} | ${conf} | ${res.durationMs || 0}ms |`);
    }

    return lines.join('\n');
  }

  /**
   * Generates an interactive standalone HTML dashboard.
   * @param {Object} reportData
   * @returns {string}
   */
  generateHtml(reportData) {
    const passed = reportData.passed || 0;
    const failed = reportData.failed || 0;
    const total = reportData.total || 0;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unity to Cocos Creator Migration Dashboard</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
      --border: #334155;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; }
    .subtitle { color: var(--text-muted); margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card {
      background: var(--card-bg);
      padding: 1.5rem;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .card-title { font-size: 0.875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 2rem; font-weight: bold; margin-top: 0.5rem; }
    .card-value.success { color: var(--success); }
    .card-value.danger { color: var(--danger); }
    .card-value.warning { color: var(--warning); }
    table { width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: #0b1120; color: var(--text-muted); font-size: 0.875rem; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
    .badge-pass { background: rgba(34, 197, 94, 0.2); color: var(--success); }
    .badge-fail { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Unity &rarr; Cocos Creator 3.8.8+ Migration Dashboard</h1>
    <div class="subtitle">Generated on ${reportData.timestamp || new Date().toISOString()}</div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Total Files</div>
        <div class="card-value">${total}</div>
      </div>
      <div class="card">
        <div class="card-title">Pass Rate</div>
        <div class="card-value success">${passRate}%</div>
      </div>
      <div class="card">
        <div class="card-title">Passed Files</div>
        <div class="card-value success">${passed}</div>
      </div>
      <div class="card">
        <div class="card-title">Failed Files</div>
        <div class="card-value ${failed > 0 ? 'danger' : 'success'}">${failed}</div>
      </div>
    </div>

    <h2>File Breakdown</h2>
    <table>
      <thead>
        <tr>
          <th>Source File</th>
          <th>Status</th>
          <th>Confidence</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${(reportData.results || []).map(r => `
          <tr>
            <td><code>${r.file}</code></td>
            <td><span class="badge ${r.success ? 'badge-pass' : 'badge-fail'}">${r.success ? 'PASS' : 'FAIL'}</span></td>
            <td>${typeof r.confidence === 'number' ? (r.confidence * 100).toFixed(0) + '%' : 'N/A'}</td>
            <td>${r.durationMs || 0}ms</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
  }
}

module.exports = {
  ReportGenerator,
};
