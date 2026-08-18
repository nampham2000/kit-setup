#!/usr/bin/env node
'use strict';

/**
 * AI Knowledge & Skills Deployment Tool
 *
 * Automatically copies and deploys AI instructions, rules, and skills for:
 * - Claude (CLAUDE.md)
 * - OpenAI Codex / ChatGPT Desktop (AGENTS.md, ~/.codex/skills/)
 * - Gemini / Antigravity (GEMINI.md, .gemini/GEMINI.md, ~/.gemini/antigravity/skills/)
 * - GitHub Copilot / Cursor / VS Code (.github/copilot-instructions.md, .cursorrules, .github/skills/)
 *
 * Also generates the high-density ai/PROJECT_MAP.json for instant AI onboarding.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateProjectMap } = require('./project-map-generator.cjs');
const { generateTypings } = require('./config-typings-generator.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SHARED_KIT_AI = path.join(PROJECT_ROOT, 'playable-shared-kit', 'ai');
const HOME_DIR = os.homedir();

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFileSafe(src, dest) {
  if (!fs.existsSync(src)) return false;
  const parentDir = path.dirname(dest);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
  return true;
}

function main() {
  console.log('==> [1/3] Generating AI Project Map...');
  try {
    generateProjectMap();
    console.log('  [ok] PROJECT_MAP.json generated successfully.');
  } catch (err) {
    console.warn(`  [warn] Could not generate PROJECT_MAP.json: ${err.message}`);
  }

  console.log('==> [2/3] Generating Config TypeScript Typings...');
  try {
    generateTypings();
    console.log('  [ok] PlayableConfigTypes.d.ts generated.');
  } catch (err) {
    console.warn(`  [warn] Could not generate config typings: ${err.message}`);
  }

  console.log('==> [3/3] Deploying AI Provider Knowledge & Skills...');

  const templatesDir = path.join(SHARED_KIT_AI, 'templates');
  const skillsDir = path.join(SHARED_KIT_AI, 'skills');

  // 1. Claude (CLAUDE.md)
  const claudeSrc = path.join(templatesDir, 'CLAUDE.md');
  const claudeDest = path.join(PROJECT_ROOT, 'CLAUDE.md');
  if (copyFileSafe(claudeSrc, claudeDest)) {
    console.log('  [ok] Claude -> CLAUDE.md');
  }

  // 2. Codex / ChatGPT (AGENTS.md + ~/.codex/skills/)
  const agentsSrc = path.join(templatesDir, 'AGENTS.md');
  const agentsDest = path.join(PROJECT_ROOT, 'AGENTS.md');
  copyFileSafe(agentsSrc, agentsDest);

  const codexSkillsDest = path.join(HOME_DIR, '.codex', 'skills');
  copyDirRecursive(skillsDir, codexSkillsDest);
  console.log('  [ok] Codex / ChatGPT -> AGENTS.md, ~/.codex/skills/');

  // 3. Gemini / Antigravity (GEMINI.md, .gemini/GEMINI.md, ~/.gemini/antigravity/skills/)
  const geminiSrc = path.join(templatesDir, 'GEMINI.md');
  copyFileSafe(geminiSrc, path.join(PROJECT_ROOT, 'GEMINI.md'));
  copyFileSafe(geminiSrc, path.join(PROJECT_ROOT, '.gemini', 'GEMINI.md'));

  const antigravitySkillsDest = path.join(HOME_DIR, '.gemini', 'antigravity', 'skills');
  copyDirRecursive(skillsDir, antigravitySkillsDest);

  const workspaceAgentsSkills = path.join(PROJECT_ROOT, '.agents', 'skills');
  copyDirRecursive(skillsDir, workspaceAgentsSkills);
  console.log('  [ok] Gemini / Antigravity -> GEMINI.md, ~/.gemini/antigravity/skills/, .agents/skills/');

  // 4. GitHub Copilot / Cursor (.github/copilot-instructions.md, .cursorrules, .github/skills/)
  const copilotSrcCandidates = [
    path.join(templatesDir, '.github', 'copilot-instructions.md'),
    path.join(templatesDir, 'copilot-instructions.md'),
    path.join(PROJECT_ROOT, 'playable-shared-kit', '.github', 'copilot-instructions.md')
  ];
  for (const src of copilotSrcCandidates) {
    if (fs.existsSync(src)) {
      copyFileSafe(src, path.join(PROJECT_ROOT, '.github', 'copilot-instructions.md'));
      break;
    }
  }

  const cursorSrc = path.join(templatesDir, '.cursorrules');
  copyFileSafe(cursorSrc, path.join(PROJECT_ROOT, '.cursorrules'));

  const projectSkillsDest = path.join(PROJECT_ROOT, '.github', 'skills');
  copyDirRecursive(skillsDir, projectSkillsDest);
  console.log('  [ok] Copilot / Cursor / VSCode -> .github/copilot-instructions.md, .cursorrules, .github/skills/');

  console.log('  [ok] All AI knowledge bases, rules, and maps deployed successfully.\n');
}

main();
