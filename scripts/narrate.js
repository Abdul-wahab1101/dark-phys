'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { ElevenLabsNarration } = require('../agents/production/narration');
function directionFor(act, index, total) {
  const label = String(act.id || '') + ' ' + String(act.title || '') + ' ' + String(act.purpose || '');
  if (index === 0 || /hook|cold.open/i.test(label)) return 'hook';
  if (index === total - 1 || /payoff|closing|ending/i.test(label)) return 'payoff';
  if (/evidence|research|study|fact|context/i.test(label)) return 'evidence';
  return 'story';
}
async function main(argv = process.argv.slice(2)) {
  const positional = argv.filter(x => !x.startsWith('--'));
  const [inputFile, output, dictionaryPath] = positional;
  const language = (argv.find(x => x.startsWith('--language=')) || '--language=en').split('=')[1];
  if (!inputFile || !output || argv.includes('--help')) {
    console.log('Usage: node scripts/narrate.js approved-script.json narration.mp3 [pronunciation-dictionary.json] [--language=en|ur-Latn]');
    console.log('Accepts section JSON, Script Engine v2 output, or plain narration text. TTS is section-wise and mastered to -14 LUFS.');
    process.exitCode = inputFile ? 0 : 1; return;
  }
  const raw = await fs.readFile(inputFile, 'utf8');
  const dictionary = dictionaryPath ? JSON.parse(await fs.readFile(path.resolve(dictionaryPath), 'utf8')) : {};
  const engine = new ElevenLabsNarration();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* plain narration text */ }
  let result;
  if (data && Array.isArray(data.sections)) {
    result = await engine.synthesizeSections(data.sections, output, {
      pronunciationDictionary: dictionary, targetLufs: data.targetLufs == null ? -14 : data.targetLufs
    });
  } else if (data && data.scripts && data.scripts[language]) {
    const draft = data.scripts[language];
    if (draft.status !== 'draft_requires_human_review' || (data.approval?.status !== 'approved' && draft.approvalStatus !== 'approved')) {
      throw new Error('Script must pass validation and be manually approved before narration.');
    }
    const acts = Array.isArray(draft.acts) ? draft.acts : [];
    const sections = acts.map((act, index) => ({
      id: act.id || 'act-' + (index + 1), text: act.narration || act.text,
      direction: directionFor(act, index, acts.length), voiceSettings: act.voiceSettings
    }));
    if (!sections.length || sections.some(section => !String(section.text || '').trim())) throw new Error('Approved Script Engine output is missing section narration in one or more acts.');
    result = await engine.synthesizeSections(sections, output, { pronunciationDictionary: dictionary, targetLufs: -14 });
  } else {
    result = await engine.synthesize(raw, output, { pronunciationDictionary: dictionary, direction: 'story' });
    result.loudness = await engine.normalizeLoudness(output, -14);
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error('Narration error:', error.message); process.exit(1); });
