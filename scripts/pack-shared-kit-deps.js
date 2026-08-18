'use strict';

// Fallback dependency wiring for filesystems that cannot host symlinks/junctions
// (exFAT / FAT32 / some network shares). npm installs a "file:<folder>" dependency
// by junctioning it into node_modules, which fails there with EISDIR. Packing each
// shared-kit package into a tarball and depending on "file:<tarball>" instead makes
// npm extract a real folder, so no reparse point is ever needed.
//
// Usage: node pack-shared-kit-deps.js <projectRoot> <sharedKitRoot>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PACKAGES = ['playable-sdk', 'playable-core'];
const TARBALL_DIR_NAME = '.local-tarballs';

const projectRoot = path.resolve(process.argv[2] || '');
const sharedKitRoot = path.resolve(process.argv[3] || '');
const tarballDir = path.join(projectRoot, TARBALL_DIR_NAME);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readJson(file) {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}

// A shared-kit package may depend on a sibling via "file:../<name>". npm resolves that
// by junctioning the sibling into node_modules, which is the very thing this filesystem
// cannot do, so rewrite those specs to the sibling's tarball before packing. Packing runs
// from a staging copy so the checked-out sources stay untouched.
function stage(packageDir, tarballByPackage) {
    const stageDir = path.join(tarballDir, '.stage', path.basename(packageDir));
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(stageDir), { recursive: true });
    fs.cpSync(packageDir, stageDir, { recursive: true });

    const manifestFile = path.join(stageDir, 'package.json');
    const manifest = readJson(manifestFile);
    let rewritten = false;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, spec] of Object.entries(manifest[field] || {})) {
            if (tarballByPackage.has(name) && typeof spec === 'string' && spec.startsWith('file:')) {
                manifest[field][name] = '*';
                rewritten = true;
            }
        }
    }
    if (rewritten) {
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    }
    return stageDir;
}

function pack(packageDir, tarballByPackage) {
    const manifest = readJson(path.join(packageDir, 'package.json'));
    const expected = `${manifest.name}-${manifest.version}.tgz`;
    const stageDir = stage(packageDir, tarballByPackage);
    const args = ['pack', stageDir, '--pack-destination', tarballDir, '--json', '--loglevel=error'];
    const stdout = execFileSync(npmBin, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'inherit'],
    });

    let filename = expected;
    try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed) && parsed[0] && parsed[0].filename) {
            // npm reports scoped names as "@scope/name-version.tgz" but writes the
            // slash-free variant to disk.
            filename = path.basename(String(parsed[0].filename).replace(/^@/, '').replace(/\//g, '-'));
        }
    } catch (err) {
        // Keep the computed name; verified below.
    }

    const tarball = path.join(tarballDir, filename);
    if (!fs.existsSync(tarball)) {
        throw new Error(`npm pack did not produce ${tarball}`);
    }
    return { name: manifest.name, filename };
}

fs.mkdirSync(tarballDir, { recursive: true });

// PACKAGES is ordered dependency-first so a sibling's tarball name is already known by
// the time a package that depends on it gets staged.
const packed = [];
const tarballByPackage = new Map();
for (const name of PACKAGES) {
    const packageDir = path.join(sharedKitRoot, 'packages', name);
    if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
        throw new Error(`missing package source: ${packageDir}`);
    }
    const entry = pack(packageDir, tarballByPackage);
    tarballByPackage.set(entry.name, entry.filename);
    packed.push(entry);
}
fs.rmSync(path.join(tarballDir, '.stage'), { recursive: true, force: true });

// Drop tarballs left behind by earlier versions so the folder cannot grow unbounded.
const keep = new Set(packed.map((entry) => entry.filename));
for (const entry of fs.readdirSync(tarballDir)) {
    if (entry.endsWith('.tgz') && !keep.has(entry)) {
        fs.rmSync(path.join(tarballDir, entry), { force: true });
    }
}

const manifestFile = path.join(projectRoot, 'package.json');
const pkg = readJson(manifestFile);
pkg.dependencies = { ...(pkg.dependencies || {}) };
for (const entry of packed) {
    pkg.dependencies[entry.name] = `file:./${TARBALL_DIR_NAME}/${entry.filename}`;
}

const tmplFile = path.join(sharedKitRoot, 'template-config', 'package.scripts_TEMPLATE.json');
if (fs.existsSync(tmplFile)) {
    const tmpl = readJson(tmplFile);
    if (tmpl.scripts) {
        pkg.scripts = { ...(tmpl.scripts || {}), ...(pkg.scripts || {}) };
    }
    if (tmpl.devDependencies) {
        pkg.devDependencies = { ...(tmpl.devDependencies || {}), ...(pkg.devDependencies || {}) };
    }
}
fs.writeFileSync(manifestFile, JSON.stringify(pkg, null, 2) + '\n');

// A repacked tarball keeps its filename but changes content. Clearing the installed
// copies (and their lock entries) forces npm to extract the new ones instead of
// trusting the recorded integrity hash.
const lockFile = path.join(projectRoot, 'package-lock.json');
if (fs.existsSync(lockFile)) {
    try {
        const lock = readJson(lockFile);
        let touched = false;
        for (const entry of packed) {
            for (const key of Object.keys(lock.packages || {})) {
                if (key === `node_modules/${entry.name}` || key.startsWith(`node_modules/${entry.name}/`)) {
                    delete lock.packages[key];
                    touched = true;
                }
            }
        }
        if (touched) {
            fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
        }
    } catch (err) {
        // A malformed lockfile is not worth failing setup over; npm will rewrite it.
    }
}
for (const entry of packed) {
    fs.rmSync(path.join(projectRoot, 'node_modules', entry.name), { recursive: true, force: true });
}

console.log(`[ok] packed shared-kit tarballs: ${packed.map((entry) => entry.filename).join(', ')}`);
