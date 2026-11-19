'use strict';
/**
 * Dark Phys Original Content Studio.
 * Builds a traceable documentary draft package from researcher-approved source notes.
 * It never invents citations or treats generated wording as verified fact.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LANGS = ['en', 'ur-Latn'];
const REQUIRED_SOURCE = s => s && /^https?:\/\//i.test(String(s.url || '')) && String(s.title || '').trim();
const slug = s => String(s || 'documentary').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function validateResearch(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object') return { ok: false, errors: ['Research package must be a JSON object'] };
  if (!String(pkg.topic || '').trim()) errors.push('topic is required');
  if (!Array.isArray(pkg.sources) || !pkg.sources.length) errors.push('At least one source with title and URL is required');
  else pkg.sources.forEach((s, i) => { if (!REQUIRED_SOURCE(s)) errors.push('Source ' + (i + 1) + ' needs a title and http(s) URL'); });
  if (!Array.isArray(pkg.claims) || !pkg.claims.length) errors.push('At least one claim with supporting sourceIds is required');
  else {
    const ids = new Set((pkg.sources || []).map(s => String(s.id)));
    pkg.claims.forEach((c, i) => {
      if (!String(c.text || '').trim()) errors.push('Claim ' + (i + 1) + ' needs text');
      if (!Array.isArray(c.sourceIds) || !c.sourceIds.length) errors.push('Claim ' + (i + 1) + ' needs sourceIds');
      else c.sourceIds.forEach(id => { if (!ids.has(String(id))) errors.push('Claim ' + (i + 1) + ' references unknown source ' + id); });
    });
  }
  for (const lang of LANGS) if (!pkg.narration || !String(pkg.narration[lang] || '').trim()) errors.push('Narration input missing for ' + lang);
  return { ok: errors.length === 0, errors };
}

function factCheck(pkg) {
  const sourceMap = new Map((pkg.sources || []).map(s => [String(s.id), s]));
  const claims = (pkg.claims || []).map((c, i) => {
    const refs = (c.sourceIds || []).map(id => sourceMap.get(String(id))).filter(Boolean);
    return { id: c.id || 'claim-' + (i + 1), text: c.text, status: c.status || 'needs_human_verification',
      sourceReferences: refs.map(s => ({ id: s.id, title: s.title, url: s.url, publisher: s.publisher || '', publishedAt: s.publishedAt || '', accessedAt: s.accessedAt || '' })),
      supportCount: refs.length, notes: c.notes || '' };
  });
  const unsupported = claims.filter(c => !c.supportCount);
  const stale = claims.filter(c => c.sourceReferences.some(s => s.accessedAt && Number.isFinite(Date.parse(s.accessedAt)) && Date.now() - Date.parse(s.accessedAt) > 365 * 864e5));
  return { claims, summary: { total: claims.length, withReferences: claims.length - unsupported.length, unsupported: unsupported.length, potentiallyStale: stale.length },
    rule: 'References are traceability, not proof. A human reviewer must open each source, verify the exact wording, context, date and limitations before publication.' };
}

function makeHooks(topic, narration) {
  const opening = narration.split(/[.!?؟۔\n]/).map(x => x.trim()).filter(Boolean);
  const seed = crypto.createHash('sha256').update(topic).digest('hex');
  const options = [
    'The part of ' + topic + ' most people miss is not the obvious moment. It is what happens just before it.',
    'Imagine noticing the pattern only after it has quietly changed the way you think.',
    'What if the real question about ' + topic + ' is not why it happens, but why it is so easy to overlook?'
  ];
  const pick = parseInt(seed.slice(0, 2), 16) % options.length;
  return { recommended: options[pick], alternatives: options.filter((_, i) => i !== pick), sourceNarrationOpening: opening[0] || '' };
}

function buildSections(pkg, format) {
  const long = format !== 'short';
  const base = long ? [
    ['cold-open', 'Cold open', 0.06, 'Start inside a recognisable moment; no channel intro.'],
    ['promise', 'The question', 0.06, 'State the central question and the payoff.'],
    ['context', 'Context and evidence', 0.18, 'Define terms and introduce the strongest sourced evidence.'],
    ['mechanism', 'What is happening beneath the surface', 0.22, 'Explain the mechanism with a concrete everyday example.'],
    ['turn', 'The turning point', 0.16, 'Challenge the first interpretation; introduce nuance or counter-evidence.'],
    ['application', 'Recognise it in real life', 0.16, 'Show practical, non-diagnostic examples and warning signs.'],
    ['response', 'What to do', 0.11, 'Offer safe, realistic actions and boundaries.'],
    ['close', 'Closing thought', 0.05, 'Resolve the opening question and lead naturally to the next topic.']
  ] : [
    ['hook', 'One-line hook', 0.12, 'A single compelling idea in the first two seconds.'],
    ['insight', 'One insight', 0.55, 'Explain one supported idea in plain language.'],
    ['example', 'Concrete example', 0.20, 'One memorable example without invented real-person claims.'],
    ['payoff', 'Payoff and loop', 0.13, 'A useful takeaway that loops to the hook or long video.']
  ];
  const evidence = (pkg.claims || []).map(c => c.id || c.text).slice(0, 5);
  return base.map(([id, title, share, purpose]) => ({ id, title, targetShare: share, purpose, evidenceClaimIds: evidence }));
}

function retentionReview(sections, hooks) {
  const flags = [];
  if (!hooks.recommended || hooks.recommended.length < 35) flags.push('Hook may need a clearer curiosity gap.');
  if (sections.length >= 6 && !sections.some(s => /turn|counter/i.test(s.id))) flags.push('Add a meaningful perspective shift.');
  if (sections.length >= 6 && !sections.some(s => /application|response/i.test(s.id))) flags.push('Add practical viewer value.');
  return { checkpoints: sections.map((s, i) => ({ section: s.id, checkpoint: i === 0 ? 'Immediate relevance; remove greetings' : i === sections.length - 1 ? 'Resolve the opening promise' : 'Deliver a new fact, example, question or visual change; remove repetition' })),
    flags, note: 'Retention guidance is an editorial checklist, not a prediction of audience retention or views.' };
}

function generatePackage(pkg, opts = {}) {
  const validation = validateResearch(pkg);
  if (!validation.ok) { const e = new Error(validation.errors.join('; ')); e.validation = validation; throw e; }
  const format = opts.format === 'short' ? 'short' : 'long-form';
  const duration = format === 'short' ? 45 : Math.max(480, Math.min(720, Number(opts.durationSec || 600)));
  const sections = buildSections(pkg, format);
  const scripts = {};
  for (const lang of LANGS) {
    const supplied = pkg.narration[lang].trim();
    scripts[lang] = { language: lang, title: (pkg.titles && pkg.titles[lang]) || pkg.topic,
      hook: makeHooks(pkg.topic, supplied), narrationDraft: supplied,
      note: 'This is a separately supplied language draft. It is not machine-translated from the other channel. Editorial rewrite and native-speaker review are required.',
      wordCount: supplied.split(/\s+/).filter(Boolean).length };
  }
  const packageOut = { schemaVersion: 1, topic: pkg.topic, format, targetDurationSec: duration,
    createdAt: new Date().toISOString(), researchSummary: pkg.researchSummary || '',
    sources: pkg.sources, claims: factCheck(pkg), structure: sections, scripts,
    retentionReview: retentionReview(sections, scripts.en.hook),
    originalityReview: { method: 'Local title/script-history lexical similarity check is separate; this package records a SHA-256 fingerprint only.',
      fingerprint: crypto.createHash('sha256').update(LANGS.map(l => scripts[l].narrationDraft).join('\n')).digest('hex'),
      humanChecklist: ['Confirm original angle and examples', 'Check quotations and attribution', 'Compare against channel back catalogue', 'Remove copied phrasing and unsupported claims'] },
    shorts: LANGS.map(lang => ({ language: lang, targetDurationSec: 45, sourceLongForm: true,
      concept: 'Extract one complete, independently understandable insight from the approved long-form script in ' + lang,
      structure: ['0–2s hook', '2–30s one idea and example', '30–40s payoff', '40–45s loop or long-form bridge'],
      narrationSource: scripts[lang].narrationDraft, requiresHumanCutAndTiming: true })),
    approval: { status: 'draft_requires_review', gates: ['source verification', 'fact-check approval', 'native-language edit', 'originality review', 'script approval'] } };
  return packageOut;
}

function buildWriterPrompt(pkg, lang, format = 'long-form') {
  const isUr = lang === 'ur-Latn';
  const target = format === 'short' ? '110–150 words for a 45–60 second Short' : '1,250–1,650 words for an 8–12 minute documentary';
  const claims = (pkg.claims || []).map((x, i) => '[' + (x.id || 'claim-' + (i + 1)) + '] ' + x.text + ' (source IDs: ' + (x.sourceIds || []).join(', ') + ')').join('\\n');
  const sources = (pkg.sources || []).map(s => '[' + s.id + '] ' + s.title + ' — ' + s.url).join('\\n');
  return [
    'ROLE: Senior documentary writer and evidence-led editorial researcher for Dark Phys.',
    'LANGUAGE: ' + (isUr ? 'Natural Pakistani Roman Urdu. Write in fluent conversational Roman Urdu, not literal translation or Hindi-leaning wording.' : 'Natural, clear international English.'),
    'FORMAT: ' + format + '; target ' + target + '.',
    'TOPIC: ' + pkg.topic,
    'RESEARCH CONTEXT: ' + (pkg.researchSummary || 'Use only the supplied evidence notes; request further research if evidence is insufficient.'),
    'SUPPORTED CLAIMS (do not add unsupported facts):\\n' + claims,
    'SOURCE REGISTER (cite IDs inline in draft and include a source list):\\n' + sources,
    'STORY REQUIREMENTS: Open in a vivid relatable moment; create a clear curiosity gap; establish the central question; explain the mechanism with concrete examples; introduce a meaningful counterpoint or nuance; deliver practical safe takeaways; close by resolving the opening promise.',
    'ORIGINALITY: Develop a distinct angle and fresh explanations. Do not imitate any named creator, copy phrasing, fabricate quotes, studies, statistics, case histories or source details.',
    'FACT SAFETY: Distinguish established findings, interpretation and speculation. Attribute every factual claim to supplied source IDs. If evidence is missing, mark [NEEDS SOURCE] instead of inventing.',
    'OUTPUT: Title options, 3 hook options, full narration, chapter beats with approximate timestamps, visual suggestions, and source-reference list. No generic intro or filler.',
    'REVIEW: End with a short list of claims needing human verification and any evidence gaps.'
  ].join('\\n\\n');
}

function writePackage(pkg, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'content-studio-package.json');
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  const refs = pkg.sources.map(s => '[' + s.id + '] ' + s.title + ' — ' + s.url + (s.publishedAt ? ' (published ' + s.publishedAt + ')' : '')).join('\n');
  fs.writeFileSync(path.join(outDir, 'source-references.md'), '# Source references\n\n' + refs + '\n', 'utf8');
  for (const lang of LANGS) fs.writeFileSync(path.join(outDir, 'writer-prompt-' + (lang === 'en' ? 'en' : 'roman-urdu') + '.md'),
    '# AI writer prompt — ' + lang + '\\n\\n' + buildWriterPrompt(pkg, lang) + '\\n', 'utf8');
  for (const lang of LANGS) fs.writeFileSync(path.join(outDir, 'narration-' + (lang === 'en' ? 'en' : 'roman-urdu') + '.md'),
    '# ' + pkg.scripts[lang].title + '\n\n## Hook options\n\n- ' + pkg.scripts[lang].hook.recommended + '\n\n## Narration draft\n\n' + pkg.scripts[lang].narrationDraft + '\n', 'utf8');
  return { package: file, references: path.join(outDir, 'source-references.md') };
}

module.exports = { validateResearch, factCheck, makeHooks, buildSections, retentionReview, buildWriterPrompt, generatePackage, writePackage };
