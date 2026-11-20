'use strict';
const assert = require('node:assert/strict');
const { ScriptEngineV2, validateEditorialDraft, evidenceWarnings } = require('../agents/script-engine-v2');
const { planScenes, splitSentences } = require('../agents/production/scene-planner');
const { applyPronunciationDictionary, DEFAULT_DIRECTIONS } = require('../agents/production/narration');
const pkg = {
  topic: 'How memory can change during recall', audience: 'Psychology documentary viewers', researchAgeDays: 5,
  sources: [{ id: 's1', title: 'Peer-reviewed memory research', url: 'https://example.org/paper' }, { id: 's2', title: 'University research overview', url: 'https://example.org/overview' }],
  claims: [{ id: 'c1', text: 'Recall can be influenced by context.', sourceIds: ['s1', 's2'], status: 'reviewed' }],
  narration: { en: 'English research notes supplied for validation.', 'ur-Latn': 'Roman Urdu research notes validation ke liye di gayi hain.' },
  viralFactors: { audience_fit: 4, demand_evidence: 4, freshness: 4, curiosity: 5, story_depth: 4, visual_potential: 4, differentiation: 4, evidence_quality: 5, series_potential: 3 }
};
const narration = ('A carefully sourced sentence explains how memory recall can be shaped by context and later information. ').repeat(25);
const shortNarration = ('A carefully sourced sentence explains how memory recall can be shaped by context and later information. ').repeat(22);
function draft(text) {
  return { titleOptions: ['Memory Explained', 'Why Recall Changes', 'The Memory Question'],
    hooks: ['What changes when we remember?', 'Memory is not a recording.', 'The detail you overlook'],
    centralQuestion: 'How can recall change over time?',
    caseStudy: 'Hypothetical illustration: a person recalls a conversation after hearing new details.',
    acts: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }],
    openLoops: [{ setup: 'Why confidence can differ from accuracy', payoffAct: 'a4' }],
    narration: text, chapters: [{ time: '0:00', title: 'Opening', purpose: 'Hook' }],
    visualPlan: [{ time: '0:00', visual: 'Person considering an old photograph', assetType: 'stock' }],
    sourceReferences: [{ sourceId: 's1', claimIds: ['c1'] }],
    claimLedger: [{ claimId: 'c1', sourceIds: ['s1', 's2'], exactSupportToVerify: 'Recall may be influenced by context.' }],
    claimsToVerify: ['Verify the exact context and limits of c1'] };
}
(async () => {
  const calls = [];
  const writer = { request: async prompt => {
    calls.push(prompt);
    if (prompt.startsWith('Act as a strict')) return { score: 88, strengths: ['clear'], weaknesses: [], unsupportedClaims: [], repetition: [], pacingIssues: [], requiredChanges: [] };
    if (prompt.startsWith('Revise this script')) return draft(shortNarration);
    return draft(narration);
  } };
  const result = await new ScriptEngineV2({ writer }).generate(pkg, { format: 'long-form' });
  assert.equal(calls.length, 6);
  assert.equal(result.scripts.en.status, 'draft_requires_human_review');
  assert.equal(result.scripts.en.tightening.withinTolerance, true);
  assert.equal(result.approval.autoPublish, false);
  assert.equal(evidenceWarnings(pkg).singleSourceClaims.length, 0);
  assert.equal(validateEditorialDraft(draft(narration), pkg, 'long-form').ok, true);
  const bad = draft(narration); bad.claimLedger[0].sourceIds = ['unknown'];
  assert.equal(validateEditorialDraft(bad, pkg, 'long-form').ok, false);
  const scenes = planScenes({ title: 'Memory documentary', beats: [{ narration: 'A person opens an old letter. The details seem familiar, but one line feels different.', visualIntents: [
    { visual: 'Close-up of a hand opening an aged letter', footageQuery: 'hands opening old letter', sourceType: 'stock_video' },
    { visual: 'Person pausing while reading a handwritten line', footageQuery: 'person reading handwritten letter', sourceType: 'stock_video' }
  ] }] });
  assert.equal(scenes.scenes.length, 2);
  assert.ok(scenes.scenes.every(s => s.durationSeconds <= 4 && s.sourceCredit.required));
  assert.notEqual(scenes.scenes[0].shotType, scenes.scenes[1].shotType);
  assert.equal(splitSentences('One. Two?').length, 2);
  const pronunciation = applyPronunciationDictionary('Read the API and OpenAI docs.', { API: 'A P I', OpenAI: 'Open A I' });
  assert.equal(pronunciation.applied.length, 2);
  assert.equal(DEFAULT_DIRECTIONS.hook.style > DEFAULT_DIRECTIONS.evidence.style, true);
  console.log('PASS Script Engine v2: separate generation flow, critic, 15% tightening, claim ledger and approval gate');
  console.log('PASS Scene Planner v2: sentence-level intent, max 4s shots, visual variety and credit metadata');
  console.log('PASS Narration v2: pronunciation dictionary and section delivery presets');
})().catch(error => { console.error(error); process.exitCode = 1; });
