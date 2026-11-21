#!/usr/bin/env node
'use strict';
/**
 * Static hygiene gate that needs no installs: syntax, deprecated APIs, unused imports, stray debug code,
 * focused tests, missing 'use strict', and project metadata. Exit code 1 on any finding.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const RULES = [
  { id: 'deprecated-buffer', re: /\bnew Buffer\(/, why: 'new Buffer() is deprecated (DEP0005); use Buffer.from/alloc' },
  { id: 'deprecated-fs-exists', re: /\bfs\.exists\(/, why: 'fs.exists is deprecated; use fs.existsSync or fs.access' },
  { id: 'deprecated-url-parse', re: /\burl\.parse\(/, why: 'url.parse is deprecated; use new URL()' },
  { id: 'deprecated-util', re: /\butil\.(isArray|isString|isObject|isFunction|isNumber)\(/, why: 'util.is* helpers are removed/deprecated' },
  { id: 'deprecated-binding', re: /\bprocess\.binding\(/, why: 'process.binding is deprecated' },
  { id: 'deprecated-punycode', re: /require\(['"]punycode['"]\)/, why: 'punycode module is deprecated' },
  { id: 'debugger', re: /^\s*debugger\s*;?\s*$/m, why: 'leftover debugger statement' },
  { id: 'focused-test', re: /\b(test|it|describe)\.only\(/, why: 'focused test would skip the rest of the suite' },
  { id: 'todo', re: /\b(TODO|FIXME|XXX)\b/, why: 'unresolved marker' }
];

function listJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJs(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function stripCommentsAndStrings(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
}

function unusedImports(src) {
  const found = [];
  const code = stripCommentsAndStrings(src);
  const re = /^(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const names = m[1].startsWith('{') ? m[1].slice(1, -1).split(',').map(s => s.split(':').pop().trim()).filter(Boolean) : [m[1]];
    for (const n of names) {
      const uses = (code.match(new RegExp('(?<![\\w$.])' + n.replace(/\$/g, '\\$') + '(?![\\w$])', 'g')) || []).length;
      if (uses <= 1) found.push(n);
    }
  }
  return found;
}

function check(root = ROOT) {
  const findings = [];
  const add = (file, id, detail) => findings.push({ file: path.relative(root, file), id, detail });
  const files = listJs(root);

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const isTest = /[\\/]tests[\\/]/.test(f);
    const isScript = /[\\/]scripts[\\/]/.test(f);
    const self = path.basename(f) === 'ci-hygiene.js';

    const syntax = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (syntax.status !== 0) add(f, 'syntax-error', syntax.stderr.split('\n').slice(0, 2).join(' '));

    const code = stripCommentsAndStrings(src);
    if (!self) for (const r of RULES) {
      const target = r.id === 'todo' ? src : code;
      if (r.re.test(target)) add(f, r.id, r.why);
    }
    if (!/^(#!.*\n)?(\/\*[\s\S]*?\*\/\s*)?'use strict'/.test(src) && !/^(#!.*\n)?'use strict'/.test(src)) add(f, 'missing-use-strict', "file should start with 'use strict'");
    if (!isTest && !isScript && /\bconsole\.(log|debug)\(/.test(code)) add(f, 'console-in-library', 'library code must use an injected logger');
    for (const n of unusedImports(src)) add(f, 'unused-import', n);
  }

  const pkgFile = path.join(root, 'package.json');
  if (!fs.existsSync(pkgFile)) add(pkgFile, 'missing-package-json', '');
  else {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    if (!pkg.engines || !pkg.engines.node) add(pkgFile, 'no-engines', 'declare the supported Node version');
    if (!pkg.scripts || !pkg.scripts.test) add(pkgFile, 'no-test-script', '');
  }
  return { findings, filesChecked: files.length };
}

if (require.main === module) {
  const r = check();
  for (const f of r.findings) process.stderr.write('[hygiene] ' + f.file + ': ' + f.id + (f.detail ? ' - ' + f.detail : '') + '\n');
  process.stdout.write('hygiene: ' + r.filesChecked + ' files checked, ' + r.findings.length + ' finding(s)\n');
  process.exit(r.findings.length ? 1 : 0);
}

module.exports = { check, unusedImports, RULES };
