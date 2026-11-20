'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ScriptEngineV2 } = require('../agents/script-engine-v2');
async function main(argv = process.argv.slice(2)) {
  const inputFile = argv.find(x => !x.startsWith('--'));
  if (!inputFile || argv.includes('--help')) {
    console.log('Usage: node scripts/script-engine-v2.js research-package.json [--short] [--duration=600]');
    console.log('Requires DARK_PHYS_LLM_API_KEY and DARK_PHYS_LLM_MODEL. Input must contain verified source register, claims, bilingual narration placeholders and researcher-rated viralFactors.');
    return inputFile ? 0 : 1;
  }
  const pkg = JSON.parse(fs.readFileSync(path.resolve(inputFile), 'utf8'));
  const duration = Number((argv.find(x => x.startsWith('--duration=')) || '').split('=')[1]) || 600;
  const format = argv.includes('--short') ? 'short' : 'long-form';
  const result = await new ScriptEngineV2().generate(pkg, { format, durationSec: duration });
  const out = path.resolve(pkg.output || path.join('uploads', 'content-studio', 'script-engine-v2-' + Date.now() + '.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: out, format, statuses: Object.fromEntries(Object.entries(result.scripts).map(([k, v]) => [k, v.status])), approval: result.approval.status }, null, 2));
  return Object.values(result.scripts).every(x => x.status === 'draft_requires_human_review') ? 0 : 2;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(e => { console.error('Script Engine v2:', e.message); process.exitCode = 1; });
module.exports = { main };
