# Phase 6 — Viral Intelligence & Growth Engine

Dark Phys now has an evidence-led pre-production intelligence layer. It is designed to improve topic selection, story structure, packaging and learning—not to promise virality.

## Capabilities
- Weighted 0–100 editorial topic prioritisation across audience fit, demand evidence, freshness, curiosity, story depth, visual potential, differentiation, evidence quality and series potential.
- Evidence coverage and confidence are reported separately. Missing factors, stale research and absent source URLs lower confidence or block a priority label; stale research is explicitly marked for refresh.
- Official YouTube Data API v3 adapter: regional most-popular snapshot plus keyword search and video statistics. It does not scrape pages or use unofficial endpoints.
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


## Official trend discovery (API key added at final setup)
Create a small config file:
```json
{
  "regionCode": "PK",
  "queries": ["documentary storytelling", "psychology facts"],
  "maxResults": 25,
  "output": "uploads/viral-intelligence/pakistan-trends.json"
}
```
Set `YOUTUBE_DATA_API_KEY` in the local environment only during the final API setup, then run `node scripts/viral-trends.js trend-config.json`. The adapter uses the official YouTube Data API v3 `videos.list chart=mostPopular`, `search.list` and `videos.list` statistics. API quota applies. Never commit the key. Region, query and date context must be considered when comparing results.


## Bilingual AI script generation (provider key added at final setup)
The separate `viral-generate` command calls a configurable OpenAI-compatible chat-completions endpoint twice: once for English and once for natural Pakistani Roman Urdu. It requests title options, hooks, full narration, chapter beats, visual plan, source-reference map and claims needing verification. It validates the returned JSON shape and source IDs. Invalid drafts are marked blocked for revision; valid drafts still require human fact, originality, language, rights and policy review.

Configure only at final credential setup:
- `DARK_PHYS_LLM_API_KEY`
- `DARK_PHYS_LLM_MODEL`
- Optional `DARK_PHYS_LLM_BASE_URL` (defaults to OpenAI API base)

Run `node scripts/viral-generate.js research-package.json` or add `--short`. The input must pass Original Content Studio research validation and include researcher-rated `viralFactors`. Never commit API keys. CI uses a mocked provider; no live model calls, billing, or credentials are used during tests.
\n## Scoring and limitations
The score is a weighted editorial ranking of supplied inputs. It is not a prediction of YouTube recommendation distribution, views, CTR, retention, subscribers or revenue. A high score cannot compensate for weak research. Scores are not inferred from competitor view counts alone. The scoring/brief engine itself is offline. The separate trend CLI makes explicit requests only to the official YouTube Data API when a key is configured. Competitor observations must be gathered through permitted sources and manually reviewed.

The `prepare` command hands a validated research package into the existing Original Content Studio writer-prompt builder and keeps English/Roman Urdu prompts separate. The brief is a structured writer/editor handoff, not a magically completed factual script. The original-content studio remains responsible for claim-to-source traceability and bilingual drafts. The cinematic production engine/OpenMontage remain responsible for footage, scene planning, narration and rendering. Phase 4 packaging/rights checks and Phase 5 publishing approvals remain mandatory.

## Learning loop
After publishing, collect actual channel analytics through the existing OAuth-connected YouTube analytics agent. Compare similar traffic sources and observation windows; require enough impressions and guardrails before adopting a title/thumbnail experiment. Record qualitative audience questions. Use the results to propose—not silently publish—the next topic and angle.

## Safety
No fake engagement, purchased views, copied scripts, fabricated statistics, misleading titles, unlicensed assets or automatic publishing. Every factual claim, source, media right, final export and packaging decision remains subject to human review.
