'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { POLICY, applyPolicy, patchSharpPackageJsonImport, verifyLockfile } = require('./patch-upstream-dependencies');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-phys-deps-'));
try {
  const upstreamTest = "    const [major, minor] = require('sharp/package.json').version.split('.').map(Number);\n";
  fs.writeFileSync(path.join(dir, 'test.js'), upstreamTest);
  assert.equal(patchSharpPackageJsonImport(dir), true);
  const patchedTest = fs.readFileSync(path.join(dir, 'test.js'), 'utf8');
  assert.ok(patchedTest.includes('require(sharpPackagePath)'));
  assert.equal(fs.readFileSync(path.join(dir, '.dark-phys-backups', 'test.js'), 'utf8'), upstreamTest);
  assert.equal(patchSharpPackageJsonImport(dir), false, 'Sharp test patch is idempotent');

  const manifest = {
    name: 'fixture-agent',
    dependencies: { axios: '^1.7.0', sharp: '^0.34.5', 'form-data': '^4.0.4', sqlite3: '^5.1.6', express: '^4.18.2' },
    devDependencies: { eslint: '^9.0.0' }
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  const patched = applyPolicy(dir);
  for (const [name, version] of Object.entries(POLICY)) {
    assert.equal(patched.overrides[name], version, name + ' override');
  }
  assert.equal(patched.dependencies.axios, POLICY.axios);
  assert.equal(patched.dependencies.sharp, POLICY.sharp);
  assert.equal(patched.dependencies['form-data'], POLICY['form-data']);
  assert.equal(patched.dependencies.sqlite3, POLICY.sqlite3);
  assert.equal(patched.dependencies.express, '^4.18.2', 'unrelated dependency unchanged');

  const packages = {};
  for (const [name, version] of Object.entries(POLICY)) packages['node_modules/' + name] = { version };
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
    name: 'fixture-agent', lockfileVersion: 3, packages: { '': { name: 'fixture-agent' }, ...packages }
  }));
  assert.equal(verifyLockfile(dir), true);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/ws'].version = '8.18.3';
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => verifyLockfile(dir), /ws lockfile entries are not all/);
  console.log('PASS upstream dependency security policy tests');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
