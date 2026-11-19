'use strict';
/**
 * Viral Intelligence Engine — evidence-led pre-production and learning.
 * Scores are editorial prioritisation aids, never predictions of views or virality.
 * No network calls, scraping, AI-provider calls, uploads or publishing occur here.
 */
const crypto = require('node:crypto');

const WEIGHTS = Object.freeze({
  audience_fit: 18, demand_evidence: 16, freshness: 10, curiosity: 12,
  story_depth: 10, visual_potential: 10, differentiation: 10,
  evidence_quality: 9, series_potential: 5
});
const clamp = (n, min=0, max=5) => Math.max(min, Math.min(max, n));
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const words = v => clean(v).split(/\s+/).filter(Boolean);
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');

function scoreTopic(topic={}) {
  const factors = topic.factors || {};
  const used = {}, missing = [];
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const raw = factors[key];
    if (raw === undefined || raw === null || raw === '') { missing.push(key); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error(key+' must be between 0 and 5');
    used[key] = n;
  }
  if (!Object.keys(used).length) throw new Error('At least one evidence-backed scoring factor is required');
  const availableWeight = Object.entries(used).reduce((s,[k])=>s+WEIGHTS[k],0);
  const weighted = Object.entries(used).reduce((s,[k,v])=>s+(v/5)*WEIGHTS[k],0);
  const score = Math.round(weighted/availableWeight*100);
  const coverage = Math.round(availableWeight);
  const evidence = Array.isArray(topic.evidence) ? topic.evidence : [];
  const validEvidence = evidence.filter(e=>clean(e.title)&&/^https:\/\//i.test(clean(e.url)));
  const freshnessDays = Number(topic.researchAgeDays);
  const evidenceFresh = Number.isFinite(freshnessDays) && freshnessDays >= 0 && freshnessDays <= 30;
  const confidence = Math.round(Math.min(100, coverage * (validEvidence.length ? 1 : .55) * (evidenceFresh ? 1 : .8)));
  return {
    score, coverage, confidence,
    label: coverage < 60 || !validEvidence.length ? 'NEEDS_MORE_EVIDENCE' : score >= 80 ? 'PRIORITY_CANDIDATE' : score >= 65 ? 'PROMISING' : score >= 50 ? 'REFRAME_ANGLE' : 'LOW_PRIORITY',
    factorScores: used, missingFactors: missing, evidenceCount: validEvidence.length,
    evidenceFreshWithin30Days: evidenceFresh,
    scoringVersion: '1.0.0',
    disclaimer: 'Editorial prioritisation only. Not a prediction of views, CTR, revenue, recommendation reach or virality.'
  };
}

function makeBrief(topic={}, opts={}) {
  const title = clean(topic.title || topic.topic);
  if (!title) throw new Error('topic.title is required');
  const score = scoreTopic(topic);
  const audience = clean(opts.audience || topic.audience || 'the channel audience');
  const language = clean(opts.language || topic.language || 'en');
  const format = opts.format === 'short' ? 'short' : 'long-form';
  const durationSec = format === 'short' ? 45 : Math.max(300, Math.min(900, Number(opts.durationSec)||600));
  const evidence = (topic.evidence||[]).filter(e=>clean(e.title)&&/^https:\/\//i.test(clean(e.url)));
  const competitors = (topic.competitors||[]).filter(x=>clean(x.title));
  const hooks = [
    {style:'curiosity',prompt:'Open on the most surprising verified question; delay the explanation, not the truth.'},
    {style:'stakes',prompt:'Show a relatable consequence first, then explain the mechanism and limits.'},
    {style:'contrarian',prompt:'Challenge a common assumption only if the supplied evidence genuinely supports the nuance.'},
    {style:'story',prompt:'Begin inside a specific, clearly labelled illustrative scenario; never invent a real case.'},
    {style:'utility',prompt:'Promise one concrete thing the viewer will understand or be able to recognise.'}
  ];
  const beats = format==='short'
    ? [{time:'0–2s',job:'Immediate hook and clear subject'},{time:'2–12s',job:'Set up one evidence-supported question'},{time:'12–32s',job:'Deliver one mechanism with a concrete example'},{time:'32–42s',job:'Payoff, caveat or practical takeaway'},{time:'42–45s',job:'Natural loop or relevant next step'}]
    : [{time:'0–15s',job:'Cold open: tension, relevance and a clear unanswered question'},{time:'15–45s',job:'Promise the payoff; establish why it matters'},{time:'45–150s',job:'Context and strongest verified evidence'},{time:'150–300s',job:'Explain the mechanism with a vivid example'},{time:'300–420s',job:'Perspective shift, counter-evidence or nuance'},{time:'420–510s',job:'Practical application and viewer value'},{time:'510–600s',job:'Resolve opening question; satisfying ending'}];
  const angles = [
    'Mechanism: explain how it works, with evidence and limitations.',
    'Recognition: show observable signs and distinguish them from assumptions.',
    'Myth versus evidence: compare a popular belief with reliable sources.',
    'Practical response: give safe, realistic actions viewers can use.',
    'Case-study format: use only documented cases with traceable sources.'
  ];
  const fingerprint = hash([title, audience, language, format].join('|'));
  return {
    schemaVersion:1, engine:'Dark Phys Viral Intelligence Engine', createdAt:new Date().toISOString(),
    topic:title, audience, language, format, durationSec, editorialScore:score,
    goNoGo:score.label==='PRIORITY_CANDIDATE'||score.label==='PROMISING'?'REVIEW_CANDIDATE':'RESEARCH_OR_REFRAME',
    research:{evidence,competitorObservations:competitors,requiredBeforeScript:['Verify each source and exact claim in context','Check publication date and primary-source availability','Record competing explanations and uncertainty','Identify the specific unmet audience question','Do not infer demand from a single viral outlier']},
    hookBattle:hooks,
    storyAngles:angles,
    structure:beats,
    scriptBlueprint:{
      opening:'Write 3 genuinely different opening options. State the subject quickly, create a specific curiosity gap, and avoid greetings, fake urgency or unsupported claims.',
      body:'Every section must add a new fact, example, question or visual idea. Alternate explanation, evidence and concrete illustration. Add a meaningful perspective shift and remove repeated points.',
      ending:'Resolve the opening promise, give a useful takeaway and suggest a closely related next video without begging for engagement.',
      requirements:['Original narration; do not imitate a competitor script or distinctive phrasing','Cite factual claims in a claim-to-source ledger','Label hypothetical scenarios; never fabricate people, studies, quotes or statistics','Use native-language phrasing and cultural review','Mark uncertain or disputed claims for human fact-check']
    },
    retentionPlan:{checkpoints:beats.map((b,i)=>({time:b.time,review:b.job,editorCheck:'Does this moment deliver new value? Remove filler and repeated setup.'})),patternInterrupts:['Switch from narration to a relevant real-footage detail','Use a restrained motion graphic to explain one concept','Ask a meaningful question then answer it with evidence','Change shot scale or visual perspective when the idea changes'],rule:'No arbitrary cuts, false cliffhangers or artificial suspense.'},
    packaging:{titleBrief:'Generate 5 accurate titles with distinct angles: direct benefit, curiosity, question, contrast and documentary. Keep each faithful to the actual video.',thumbnailBrief:'Create 3 visually distinct concepts with one clear subject, readable mobile composition and no claim the video does not deliver.',abTest:'Only test after publication with enough impressions and a pre-set observation window; compare like-for-like traffic and guard retention guardrails.'},
    learning:{capture:['Impressions and traffic source','CTR segmented by traffic source where available','First 30-second retention and key dips/spikes','Average view duration and percentage viewed','Returning viewers, comments and qualitative questions','Shorts viewed-versus-swiped and completion where available'],decision:'Use real channel data, sample-size safeguards and context. Never call a result causal from a small or confounded sample.',nextVideo:'Generate follow-up candidates from audience questions and proven viewer value; do not blindly repeat a viral topic.'},
    safety:{approvalRequired:true,sourceVerificationRequired:true,rightsReviewRequired:true,originalityReviewRequired:true,policyReviewRequired:true,autoPublish:false,scoreIsNotViralityPrediction:true},
    fingerprint
  };
}

function auditScript(input={}) {
  const script=clean(input.script);
  if(!script) throw new Error('script is required');
  const sections=Array.isArray(input.sections)?input.sections:[];
  const flags=[];
  const lower=script.toLowerCase(), tokens=words(lower), unique=new Set(tokens);
  if(tokens.length<80) flags.push({severity:'warning',code:'SCRIPT_SHORT',message:'Draft is very short; confirm it matches the intended duration and format.'});
  if(tokens.length && unique.size/tokens.length<.38) flags.push({severity:'warning',code:'REPETITION',message:'High repeated-word ratio; inspect for repetitive phrasing.'});
  if(!/(\?|what if|why|how|question)/i.test(script.slice(0,Math.min(600,script.length))) ) flags.push({severity:'info',code:'WEAK_OPENING_QUESTION',message:'Opening may benefit from a clear viewer-relevant question or tension.'});
  if(/subscribe|like and subscribe/i.test(script.slice(0,Math.min(350,script.length)))) flags.push({severity:'warning',code:'EARLY_CTA',message:'Move generic CTA out of the opening; earn attention first.'});
  if(!Array.isArray(input.claims)||!input.claims.length) flags.push({severity:'blocker',code:'NO_CLAIM_LEDGER',message:'No claim-to-source ledger supplied; factual review cannot be completed.'});
  const unsupported=(input.claims||[]).filter(c=>!Array.isArray(c.sourceIds)||!c.sourceIds.length);
  if(unsupported.length) flags.push({severity:'blocker',code:'UNSOURCED_CLAIMS',message:unsupported.length+' claim(s) have no source IDs.'});
  if(!sections.length) flags.push({severity:'info',code:'NO_BEAT_MAP',message:'Add timed story beats to assess pacing and progression.'});
  if(sections.length>1 && sections.every(s=>!clean(s.visualChange))) flags.push({severity:'info',code:'VISUAL_PLAN_MISSING',message:'No planned visual changes; coordinate with the cinematic scene planner.'});
  const blockers=flags.filter(f=>f.severity==='blocker').length;
  return {wordCount:tokens.length,uniqueWordRatio:tokens.length?Number((unique.size/tokens.length).toFixed(3)):0,flags,readiness:blockers?'BLOCKED':'HUMAN_REVIEW_REQUIRED',disclaimer:'Heuristic editorial audit only; it cannot predict retention or replace source, originality, rights and policy review.'};
}

function buildReport(topic,opts={}) {
  const brief=makeBrief(topic,opts);
  return {brief,scriptAudit:opts.script?auditScript({script:opts.script,claims:opts.claims,sections:opts.sections}):null};
}
module.exports={WEIGHTS,scoreTopic,makeBrief,auditScript,buildReport};
