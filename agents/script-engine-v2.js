'use strict';
/**
 * Script Engine v2: evidence-bound long-form and Shorts editorial pipeline.
 * AI output is always a draft. Source IDs establish traceability, not factual proof.
 */
const { ViralScriptGenerator, validateDraft } = require('./viral-script-generator');
const { buildWriterPrompt, validateResearch } = require('./original-content-studio');
const { makeBrief } = require('./viral-intelligence-engine');

const LANGS = ['en', 'ur-Latn'];
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const idsFor = pkg => new Set((pkg.claims || []).map((c, i) => String(c.id || 'claim-' + (i + 1))));
function validateEditorialDraft(draft, pkg, format) {
  const base = validateDraft(draft, new Set(pkg.sources.map(s => String(s.id))), idsFor(pkg));
  const errors = [...base.errors];
  if (!String(draft.centralQuestion || '').trim()) errors.push('A single centralQuestion is required');
  if (!String(draft.caseStudy || '').trim()) errors.push('One documented or explicitly hypothetical caseStudy is required');
  if (!Array.isArray(draft.acts) || (format === 'short' ? draft.acts.length < 3 : draft.acts.length < 4)) errors.push('Insufficient story acts');
  if (!Array.isArray(draft.openLoops) || !draft.openLoops.length) errors.push('At least one resolved open loop is required');
  if (!Array.isArray(draft.sentenceVisuals) || !draft.sentenceVisuals.length) errors.push('Sentence-by-sentence visual intent plan is required');
  else if (draft.sentenceVisuals.some(x => !String(x.sentence || '').trim() || !String(x.visualIntent || '').trim() || !String(x.footageQuery || '').trim() || !String(x.sourceType || '').trim())) errors.push('Every sentence visual needs sentence, visualIntent, footageQuery and sourceType');
  const sentenceCount = String(draft.narration || '').match(/[^.!?؟۔\\n]+[.!?؟۔]?/g)?.filter(x => x.trim()).length || 0;
  if (sentenceCount && Array.isArray(draft.sentenceVisuals) && draft.sentenceVisuals.length !== sentenceCount) errors.push('Every narration sentence must have exactly one sentenceVisuals entry');
  if (!Array.isArray(draft.claimLedger) || !draft.claimLedger.length) errors.push('Claim-level source ledger is required');
  const knownClaims = idsFor(pkg), knownSources = new Set(pkg.sources.map(s => String(s.id)));
  for (const item of draft.claimLedger || []) {
    if (!knownClaims.has(String(item.claimId))) errors.push('Unknown claim ID in claimLedger: ' + item.claimId);
    if (!Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some(id => !knownSources.has(String(id)))) errors.push('Claim ' + item.claimId + ' has missing or unknown source IDs');
  }
  if (format === 'short' && words(draft.narration).length > 180) errors.push('Shorts narration exceeds 180 words; tighten to a 20–60 second spoken script');
  return { ok: errors.length === 0, errors, sourceCoverage: (draft.claimLedger || []).length };
}
function evidenceWarnings(pkg) {
  const single = (pkg.claims || []).filter(c => (c.sourceIds || []).length === 1).map(c => c.id || c.text);
  const noStatus = (pkg.claims || []).filter(c => !c.status || !/verified|reviewed/i.test(c.status)).map(c => c.id || c.text);
  return { singleSourceClaims: single, claimsNotMarkedVerified: noStatus,
    warning: 'A source link is not proof. Human reviewers must open the source and confirm the exact claim, context and limitations.' };
}
class ScriptEngineV2 {
  constructor(options = {}) { this.writer = options.writer || new ViralScriptGenerator(options); }
  async generate(pkg, { format = 'long-form', durationSec } = {}) {
    const mode = format === 'short' ? 'short' : 'long-form';
    const valid = validateResearch(pkg);
    if (!valid.ok) throw new Error('Research package invalid: ' + valid.errors.join('; '));
    if (!pkg.viralFactors) throw new Error('Researcher-rated viralFactors are required');
    const brief = makeBrief({ title: pkg.topic, audience: pkg.audience, language: 'en',
      researchAgeDays: pkg.researchAgeDays, factors: pkg.viralFactors,
      evidence: pkg.sources.map(s => ({ title: s.title, url: s.url, publishedAt: s.publishedAt })),
      competitors: pkg.competitors || [] }, { format: mode === 'short' ? 'short' : 'long', durationSec });
    const scripts = {};
    for (const lang of LANGS) {
      const prompt = buildWriterPrompt(pkg, lang, mode) + '\n\nEDITORIAL SYSTEM V2 REQUIREMENTS:\n' +
        JSON.stringify({ format: mode, brief, audience: pkg.audience || 'curious documentary viewers' }) +
        '\nReturn JSON only with titleOptions (3), hooks (3), centralQuestion (exactly one question), caseStudy (exactly one real documented case with source IDs OR explicitly labelled hypothetical illustration), acts (4–6 for long, 3–4 for short), openLoops (each with setup and payoffAct), narration, chapters, visualPlan, sentenceVisuals [{sentence,visualIntent,footageQuery,sourceType,durationSeconds}], sourceReferences, claimLedger [{claimId,sourceIds,exactSupportToVerify}], claimsToVerify. ' +
        (mode === 'short' ? 'Make one complete standalone vertical Short, 20–60 seconds, one idea only.' :
          'Make an 8–12 minute documentary with cold open, promise, 3–5 main acts, rehooks roughly every 60–90 seconds, and a satisfying payoff.') +
        ' Use exactly one central question and one case. Never invent a real case, study, statistic, quote or source. Mark unsupported material [NEEDS SOURCE].';
      const draft = await this.writer.request(prompt, lang);
      const initial = validateEditorialDraft(draft, pkg, mode);
      if (!initial.ok) {
        scripts[lang] = { ...draft, validation: initial, status: 'blocked_for_revision' };
        continue;
      }
      const critic = await this.writer.request(
        'Act as a strict documentary script editor. Audit this draft against the supplied evidence register. Do not add facts. Return JSON only: {score:0-100, strengths:[], weaknesses:[], unsupportedClaims:[], repetition:[], pacingIssues:[], requiredChanges:[]}. Score evidence integrity, clarity, originality, hook, narrative progression, retention and payoff. Draft: ' + JSON.stringify(draft) +
        '\nEvidence claims: ' + JSON.stringify(pkg.claims) + '\nSources: ' + JSON.stringify(pkg.sources), lang);
      const polish = await this.writer.request(
        'Revise this script using the critic notes. Preserve every supported meaning and source ID; remove unsupported claims instead of guessing. Improve spoken rhythm and natural read-aloud flow. Tighten narration by approximately 15% without removing essential evidence or caveats. Keep exactly one central question and one case. Return the complete JSON draft schema: titleOptions, hooks, centralQuestion, caseStudy, acts, openLoops, narration, chapters, visualPlan, sourceReferences, claimLedger, claimsToVerify. Draft: ' + JSON.stringify(draft) +
        '\nCritic: ' + JSON.stringify(critic) + '\nTarget language: ' + lang, lang);
      const finalCheck = validateEditorialDraft(polish, pkg, mode);
      const before = words(draft.narration).length, after = words(polish.narration).length;
      const reduction = before ? (before - after) / before : 0;
      scripts[lang] = { ...polish, critic, validation: finalCheck,
        tightening: { beforeWords: before, afterWords: after, reductionRatio: Number(reduction.toFixed(3)),
          target: 0.15, withinTolerance: reduction >= 0.10 && reduction <= 0.20 },
        status: finalCheck.ok && reduction >= 0.10 && reduction <= 0.20 ? 'draft_requires_human_review' : 'blocked_for_revision' };
    }
    return { schemaVersion: 2, engine: 'Dark Phys Script Engine v2', topic: pkg.topic, format: mode,
      createdAt: new Date().toISOString(), editorialBrief: brief, evidenceWarnings: evidenceWarnings(pkg), scripts,
      approval: { autoPublish: false, status: 'human_review_required',
        requiredGates: ['open and verify every source', 'verify every claim against source context', 'review single-source claims', 'native-language read-aloud review', 'originality and policy review', 'approve script before scene planning'] },
      disclaimer: 'AI critique and source mapping are editorial aids, not independent fact verification or a guarantee of retention, views or monetization.' };
  }
}
module.exports = { ScriptEngineV2, validateEditorialDraft, evidenceWarnings };
