#!/usr/bin/env node
'use strict';

// Applies a reproducible production dependency security floor to the pinned
// upstream YouTube agent, then regenerates its npm lockfile without installing
// packages or running lifecycle scripts. The normal installer runs npm ci next.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const POLICY = Object.freeze({
  axios: '1.21.1',
  sharp: '0.35.5',
  'form-data': '4.0.6',
  ws: '8.23.0',
  'body-parser': '1.20.9',
  sqlite3: '6.0.1'
});

function applyPolicy(engineDir) {
  const manifestPath = path.join(engineDir, 'package.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Upstream package.json not found: ' + manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies = manifest.dependencies || {};
  manifest.overrides = manifest.overrides || {};

  for (const [name, version] of Object.entries(POLICY)) {
    if (Object.prototype.hasOwnProperty.call(manifest.dependencies, name)) {
      manifest.dependencies[name] = version;
    }
    manifest.overrides[name] = version;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function patchSharpPackageJsonImport(engineDir) {
  const testPath = path.join(engineDir, 'test.js');
  if (!fs.existsSync(testPath)) throw new Error('Pinned upstream test.js not found.');
  const original = fs.readFileSync(testPath, 'utf8');
  const legacy = "    const [major, minor] = require('sharp/package.json').version.split('.').map(Number);";
  const replacement = "    const sharpPackagePath = require('node:path').resolve(require('node:path').dirname(require.resolve('sharp')), '..', 'package.json');\n" +
    "    const [major, minor] = require(sharpPackagePath).version.split('.').map(Number);";
  if (original.includes(replacement)) return false;
  if (!original.includes(legacy)) throw new Error('Expected pinned Sharp package.json import was not found; refusing an unreviewed test.js rewrite.');
  const backupDir = path.join(engineDir, '.dark-phys-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, 'test.js');
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, original);
  fs.writeFileSync(testPath, original.replace(legacy, replacement));
  return true;
}

function verifyLockfile(engineDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(engineDir, 'package.json'), 'utf8'));
  const lockPath = path.join(engineDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) throw new Error('npm package-lock.json was not generated.');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!lock.packages || lock.lockfileVersion < 2) throw new Error('Expected an npm v2/v3 lockfile.');
  for (const [name, version] of Object.entries(POLICY)) {
    if (manifest.overrides?.[name] !== version) throw new Error(name + ' override is missing.');
    const entries = Object.entries(lock.packages).filter(([pkgPath]) =>
      pkgPath === 'node_modules/' + name || pkgPath.endsWith('/node_modules/' + name));
    if (!entries.length) throw new Error(name + ' is missing from the generated lockfile.');
    const bad = entries.filter(([, value]) => value.version !== version);
    if (bad.length) throw new Error(name + ' lockfile entries are not all ' + version + ': ' +
      bad.map(([pkgPath, value]) => pkgPath + '@' + value.version).join(', '));
  }
  return true;
}

function main() {
  const index = process.argv.indexOf('--engine');
  const engineDir = index >= 0 ? path.resolve(process.argv[index + 1] || '') : path.resolve('engines/youtube-automation-agent');
  if (!fs.existsSync(engineDir)) throw new Error('Pinned YouTube agent directory not found: ' + engineDir);
  applyPolicy(engineDir);
  patchSharpPackageJsonImport(engineDir);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: engineDir, stdio: 'inherit', shell: process.platform === 'win32'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('npm lockfile regeneration failed with exit code ' + result.status);
  // Apply non-breaking transitive security fixes to the generated lockfile.
  // Do not use --force: incompatible major upgrades must be reviewed separately.
  const auditFix = spawnSync(npm, ['audit', 'fix', '--package-lock-only', '--ignore-scripts', '--no-fund'], {
    cwd: engineDir, stdio: 'inherit', shell: process.platform === 'win32'
  });
  if (auditFix.error) throw auditFix.error;
  if (auditFix.status !== 0) console.warn('NOTICE: npm audit fix left advisories requiring separate review; the production audit gate will decide readiness.');
  verifyLockfile(engineDir);
  console.log('PASS upstream production dependency floors and regenerated npm lockfile:', JSON.stringify(POLICY));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error('Dependency security patch failed:', error.message); process.exitCode = 1; }
}

module.exports = { POLICY, applyPolicy, patchSharpPackageJsonImport, verifyLockfile };
