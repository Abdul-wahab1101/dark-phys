'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { planScenes } = require('../agents/production/scene-planner');
async function main() {
  const args = process.argv.slice(2), input = args.find(x => !x.startsWith('--'));
  const output = args.find((x, i) => i > args.indexOf(input) && !x.startsWith('--'));
  const language = (args.find(x => x.startsWith('--language=')) || '--language=en').split('=')[1];
  if (!input) {
    console.log('Usage: node scripts/plan-scenes.js approved-beats.json [output.json] [--language=en|ur-Latn]');
    console.log('Accepts either {beats:[...]} or Script Engine v2 output with scripts.en/scripts[ur-Latn].');
    process.exitCode = 1; return;
  }
  const data = JSON.parse(await fs.readFile(input, 'utf8'));
  let source = data;
  const draft = data.scripts && data.scripts[language];
  if (draft) {
    if (draft.status !== 'draft_requires_human_review') throw new Error('Selected script is blocked; resolve validation issues before review.');
    if (data.approval?.status !== 'approved' && draft.approvalStatus !== 'approved') throw new Error('Script is still awaiting human approval. Set data.approval.status to approved only after source, claim and language review.');
    if (!Array.isArray(draft.sentenceVisuals) || !draft.sentenceVisuals.length) throw new Error('Script Engine v2 draft has no sentenceVisuals.');
    source = { title: data.topic || draft.titleOptions?.[0] || 'Untitled documentary',
      beats: draft.sentenceVisuals.map(v => ({ narration: v.sentence, visual: v.visualIntent,
        footageQuery: v.footageQuery, sourceType: v.sourceType, durationSeconds: v.durationSeconds,
        visualIntents: [v] })) };
  }
  const plan = planScenes(source);
  const dest = path.resolve(output || path.join('uploads', 'production', plan.projectId, 'scene-plan.json'));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, JSON.stringify(plan, null, 2) + '\n');
  console.log('Scene plan:', dest, '| sentence-level scenes:', plan.scenes.length);
}
main().catch(error => { console.error('Scene Planner:', error.message); process.exitCode = 1; });
