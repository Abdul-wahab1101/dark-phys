#!/usr/bin/env node
'use strict';
/**
 * CI test runner. Fails the build when the suite:
 *  - prints ANY Node warning (deprecations are turned into errors with --throw-deprecation),
 *  - leaves child processes running, or
 *  - leaves temp folders behind.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = path.resolve(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir).filter(n => n.endsWith('.test.js')).sort().map(n => path.join(testsDir, n));
const before = new Set(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('ysys_')));

const r = spawnSync(process.execPath, ['--throw-deprecation', '--trace-warnings', '--test', ...files], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '0' } });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');

const problems = [];
if (r.status !== 0) problems.push('tests failed (exit ' + r.status + ')');
const warnings = (r.stderr || '').split('\n').filter(l => /\(node:\d+\)|Warning:/.test(l));
if (warnings.length) problems.push('Node warnings were printed:\n  ' + warnings.slice(0, 5).join('\n  '));

const leaked = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('ysys_') && !before.has(n));
if (leaked.length) {
  problems.push('temp folders left behind: ' + leaked.join(', '));
  for (const n of leaked) fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true });
}

if (process.platform !== 'win32') {
  const ps = spawnSync('ps', ['-eo', 'pid=,stat=,args='], { encoding: 'utf8' });
  const isOrphan = line => {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!m || m[2].startsWith('Z')) return false;
    const args = m[3];
    return /(^|[\\/])node(\.exe)?\s+-e\s.*setInterval/.test(args) || /(^|[\\/])node(\.exe)?\s.*hang\.js/.test(args);
  };
  const orphans = (ps.stdout || '').split('\n').filter(isOrphan);
  if (orphans.length) problems.push('child processes still running:\n  ' + orphans.join('\n  '));
}

if (problems.length) { process.stderr.write('\nCI FAILED:\n- ' + problems.join('\n- ') + '\n'); process.exit(1); }
process.stdout.write('\nCI OK: tests passed, no warnings, no leaked processes or temp folders.\n');
