'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { check, unusedImports } = require('../scripts/ci-hygiene');
const h = require('./helpers');

test('the project itself is clean', () => {
  const r = check();
  assert.deepEqual(r.findings, []);
  assert.ok(r.filesChecked > 20);
});

test('hygiene detects deprecated APIs, unused imports, console, focused tests', () => {
  const dir = h.tmp();
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"scripts":{}}');
    fs.writeFileSync(path.join(dir, 'src', 'bad.js'), "const fs = require('fs');\nconst { a, b } = require('./x');\nconsole.log(a, new Buffer(4));\nfs.exists('x', () => {});\n");
    const ids = check(dir).findings.map(f => f.id);
    for (const want of ['missing-use-strict', 'deprecated-buffer', 'deprecated-fs-exists', 'console-in-library', 'no-engines', 'no-test-script']) assert.ok(ids.includes(want), want + ' in ' + ids);
    assert.deepEqual(unusedImports("const { a, b } = require('x');\nuse(a);\n"), ['b']);
  } finally { h.rm(dir); }
});

test('strings and comments do not trigger false alarms', () => {
  assert.deepEqual(unusedImports("const path = require('path');\n// path is documented here\nconst s = 'path';\n"), ['path']);
  const dir = h.tmp();
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"engines":{"node":">=20"},"scripts":{"test":"x"}}');
    fs.writeFileSync(path.join(dir, 'src', 'ok.js'), "'use strict';\n// new Buffer( is mentioned in a comment\nconst msg = 'fs.exists( in a string';\nmodule.exports = { msg };\n");
    assert.deepEqual(check(dir).findings, []);
  } finally { h.rm(dir); }
});
