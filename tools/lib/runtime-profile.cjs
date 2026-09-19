'use strict';
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createRuntimeProfile(projectRoot) {
  const root = path.resolve(process.env.PLAYABLE_RUNTIME_TEMP_DIR || path.join(projectRoot, '.ai', 'runtime-temp'));
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'playable-runtime-'));
  return { root, directory };
}

async function closeRuntimeProfile(child, session, profile, io = fs.promises, wait = delay) {
  const directory = path.resolve(profile.directory), root = path.resolve(profile.root);
  if (path.dirname(directory) !== root || !/^playable-runtime-[A-Za-z0-9]{6}$/.test(path.basename(directory))) {
    throw new Error('Refusing cleanup outside the exact owned runtime profile root');
  }
  const stat = await io.lstat(directory).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat) return { ok: true, removed: true };
  if (stat.isSymbolicLink()) throw new Error('Refusing cleanup of a redirected runtime profile');
  // Browser.close asks the browser to shut down its children and flush profile
  // handles. child.kill() alone is asynchronous and left ~80MB per run on Windows.
  if (session) {
    try { await Promise.race([session.send('Browser.close'), wait(2000)]); } catch (_) { /* closed socket is normal */ }
    session.close();
  }
  for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await wait(100);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill(); } catch (_) { /* already exited */ }
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await wait(100);
  }
  let lastError;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await io.rm(directory, { recursive: true, force: true });
      return { ok: true, removed: true, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (!['EBUSY','EPERM','ENOTEMPTY','EACCES'].includes(error.code)) break;
      await wait(250 * (attempt + 1));
    }
  }
  return { ok: false, removed: false, directory, error: lastError?.message || 'Profile cleanup failed' };
}
module.exports = { createRuntimeProfile, closeRuntimeProfile };
