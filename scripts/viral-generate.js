#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ViralScriptGenerator } = require('../agents/viral-script-generator');
const { ScriptEngineV2 } = require('../agents/script-engine-v2');
async function main(argv = process.argv.slice(2)) {
  const file = argv.find(x => !x.startsWith('--'));
  if (!file || argv.includes('--help')) {
    console.log('Dark Phys AI Script Engine v2\nUsage: node scripts/viral-generate.js research-package.json [--short] [--legacy]');
    console.log('Default: Script Engine v2 with separate Long/Short editorial pipelines, critic, tightening and claim/source validation.');
    return file ? 0 : 1;
  }
  const pkg = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const format = argv.includes('--short') ? 'short' : 'long-form';
  const generator = argv.includes('--legacy') ? new ViralScriptGenerator() : new ScriptEngineV2();
  const result = await generator.generate(pkg, { format });
  const out = path.resolve(pkg.output || path.join('uploads', 'content-studio', 'script-drafts-' + Date.now() + '.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  const scripts = result.scripts || {};
  console.log(JSON.stringify({ output: out, topic: result.topic, format,
    statuses: Object.fromEntries(Object.entries(scripts).map(([k, v]) => [k, v.status])),
    approval: result.approval.status, engine: result.engine || 'Dark Phys Script Engine v2' }, null, 2));
  return Object.values(scripts).every(x => x.status === 'draft_requires_human_review') ? 0 : 2;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error('Script generation error:', error.message); process.exitCode = 1;
});
module.exports = { main };
