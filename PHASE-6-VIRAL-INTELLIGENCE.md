# Phase 6 — Viral Intelligence & Growth Engine

Dark Phys now has an evidence-led pre-production intelligence layer. It is designed to improve topic selection, story structure, packaging and learning—not to promise virality.

## Capabilities
- Weighted 0–100 editorial topic prioritisation across audience fit, demand evidence, freshness, curiosity, story depth, visual potential, differentiation, evidence quality and series potential.
- Evidence coverage and confidence are reported separately. Missing factors, stale research and absent source URLs lower confidence or block a priority label.
- Five hook directions, five story angles, timed long-form/Shorts beats, retention review prompts and packaging briefs.
- Script audit flags weak opening patterns, early generic CTAs, repetition, missing claim ledgers and missing visual plans.
- Post-publish learning specification for impressions, traffic-source-aware CTR, first-30-second retention, watch duration, returning viewers, comments and Shorts viewed-versus-swiped.
- Explicit human gates for facts, originality, rights, policy, and publishing.

## Quick start
Create a UTF-8 JSON topic file (keep source URLs and research notes genuine):
```json
{
  "title": "Why people doubt their own memory",
  "audience": "English-speaking psychology documentary viewers",
  "language": "en",
  "researchAgeDays": 7,
  "factors": {
    "audience_fit": 4, "demand_evidence": 3, "freshness": 4,
    "curiosity": 5, "story_depth": 4, "visual_potential": 4,
    "differentiation": 4, "evidence_quality": 5, "series_potential": 3
  },
  "evidence": [
    {"title": "A real research source", "url": "https://example.org/replace-with-real-source"}
  ],
  "competitors": []
}
```
Run:
- `node scripts/viral-intelligence.js score topic.json`
- `node scripts/viral-intelligence.js brief topic.json`
- `node scripts/viral-intelligence.js brief topic.json --short --language=ur-Latn`
- `node scripts/viral-intelligence.js audit script-review.json`
- Add researcher-rated `viralFactors` (0–5) to a valid Original Content Studio research package, then run `node scripts/viral-intelligence.js prepare research-package.json` to create the viral brief plus separate English and Roman Urdu writer prompts.

For `audit`, input JSON includes `script`, `claims` with sourceIds, and optional timed `sections` with visualChange notes. Output is an editorial warning report, not a pass certificate.

## Scoring and limitations
The score is a weighted editorial ranking of supplied inputs. It is not a prediction of YouTube recommendation distribution, views, CTR, retention, subscribers or revenue. A high score cannot compensate for weak research. Scores are not inferred from competitor view counts alone. Trend discovery and competitor observations must be supplied by a permitted, current data source; this offline module makes no implicit network requests or scraping calls.

The `prepare` command hands a validated research package into the existing Original Content Studio writer-prompt builder and keeps English/Roman Urdu prompts separate. The brief is a structured writer/editor handoff, not a magically completed factual script. The original-content studio remains responsible for claim-to-source traceability and bilingual drafts. The cinematic production engine/OpenMontage remain responsible for footage, scene planning, narration and rendering. Phase 4 packaging/rights checks and Phase 5 publishing approvals remain mandatory.

## Learning loop
After publishing, collect actual channel analytics through the existing OAuth-connected YouTube analytics agent. Compare similar traffic sources and observation windows; require enough impressions and guardrails before adopting a title/thumbnail experiment. Record qualitative audience questions. Use the results to propose—not silently publish—the next topic and angle.

## Safety
No fake engagement, purchased views, copied scripts, fabricated statistics, misleading titles, unlicensed assets or automatic publishing. Every factual claim, source, media right, final export and packaging decision remains subject to human review.
