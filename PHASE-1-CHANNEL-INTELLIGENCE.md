# Phase 1 — Channel Intelligence

## Purpose
Build a reusable, multi-channel research and editorial decision layer before content generation. Phase 1 is channel-aware and starts with two independent profiles: English (US/global English metadata) and Pakistani Roman Urdu. They share a niche taxonomy but keep audience, language, voice, examples, topic history and future performance data isolated.

## Delivered foundation
- JSON channel profiles with stable IDs, locale, region, niche, audience, voice, content pillars and style settings.
- SQLite topic ledger with per-channel isolation, timestamps, research metadata and evidence references.
- Weighted 0–100 editorial topic score. Factors: audience demand (20), problem-solving value (20), curiosity/hook (15), competition gap (15), visual potential (10), evergreen value (10), evidence confidence (10).
- Coverage-aware labels: scores with under 60% weight coverage are marked insufficient evidence; the score is not presented as a prediction.
- Topic title/core-topic similarity detection and normalized SHA-256 script fingerprinting.
- Research evidence records with source type, URL, observation time, notes and optional freshness window.
- Standard-library-only implementation; no API keys, network calls, model calls or paid services required.

## Research workflow contract
1. Pick a channel profile and define its audience problem.
2. Collect evidence from multiple independent source types (e.g. YouTube search observations, Google Trends, Reddit discussions, academic papers, official sources and news).
3. Record URLs and observation dates. Label evidence; do not claim a source says more than it does.
4. Identify competitor coverage gaps manually: angle, depth, recency, unanswered questions, visual treatment and practical usefulness.
5. Rate the seven topic factors from 0–5 with notes/evidence. Missing factors remain missing; they are not silently treated as zero.
6. Run duplicate checks within the target channel. Cross-channel similarity is surfaced separately in future workflow; it must not auto-copy or translate a script.
7. Promote only reviewed topics to script development.

## Scoring and API compliance
The score is an internal editorial rubric, not a forecast of views, CTR, revenue, audience satisfaction or virality. It uses explicit human/researcher inputs, not inferred competitor channel rankings.

YouTube Data API data must be handled in a separate adapter and displayed under YouTube's API policies. Do not combine YouTube API data with external datasets, infer demographics/monetization/satisfaction, estimate views or assign custom scores/rankings to channels. Current API policies specifically restrict those uses. Search quota is limited; the API search endpoint has its own daily quota bucket, so cache and batch research rather than polling. References:
- https://developers.google.com/youtube/terms/developer-policies-guide
- https://developers.google.com/youtube/data/reference/rest/v3/search/list
- https://developers.google.com/youtube/data/determine_quota_cost

## CLI
Run from repository root:
```powershell
python scripts/channel-intelligence.py channels
python scripts/channel-intelligence.py add-topic --channel dark-phys-en --title "Why people manipulate others" --core-topic "psychological manipulation" --factors '{"audience_demand":4,"problem_value":5,"curiosity_hook":4,"competition_gap":3,"visual_potential":4,"evergreen_value":5,"evidence_confidence":4}'
python scripts/channel-intelligence.py check-duplicate --channel dark-phys-en --title "Signs of psychological manipulation" --core-topic "psychological manipulation"
python scripts/channel-intelligence.py show-topic 1
```

Database is created under `data/channel-intelligence.sqlite3`; it is runtime data and must not be committed. Channel profiles live in `config/channel-profiles.json` and can be edited or extended without changing the engine.

## Not yet implemented in Phase 1
- Live Google Trends/Reddit/news provider adapters and scheduled refresh.
- YouTube OAuth/API integration and live competitor research.
- Automated semantic embeddings; current duplicate detection is deterministic lexical similarity plus exact normalized script hash.
- Dashboard UI and automated channel onboarding.
- Automatic topic generation. These require explicit provider/credential choices and later integration work.

## Quality and safety boundaries
- Do not generate scripts or videos from weak/unsupported topics just to fill a schedule.
- Keep source URLs and dates with every research claim.
- Do not scrape private data or bypass platform restrictions.
- A topic score is a prioritization aid, never a promise of virality.
- Keep the human approval boundary before production and publishing.


## Live public research adapters (added)
- Google Trends trending RSS adapter (region-aware, keyless, cached).
- GDELT public news search adapter (keyless, cached).
- Public Reddit search RSS adapter (best-effort; availability/rate limits may vary).
- Official YouTube Data API search adapter for public video metadata; requires `YOUTUBE_DATA_API_KEY`. Without the key it reports `needs_api_key` instead of failing silently.
- Provider failures are isolated: one unavailable source does not discard results from other sources.
- SQLite response cache reduces repeated requests. Cache database is local runtime data and is ignored by Git.
- CLI: `python scripts/channel-intelligence.py research --query "emotional manipulation" --region US --language en`.
- Individual adapters: `trends`, `news`, `reddit`, and `youtube-search`.

## Competitor coverage-gap analysis
Use public search-result video title/description metadata (official YouTube API results or a user-supplied JSON sample) to identify under-covered query terms and unanswered angles. The report explicitly states sample limitations. It does not estimate views, rank channels, infer audience demographics, or combine YouTube API data with external datasets.
```powershell
python scripts/channel-intelligence.py competitor-gap --query "psychology manipulation boundaries" --videos-json research-sample.json
```
The JSON file must contain an array of objects with `title`, `description`, and optional `url` fields.

## Near-duplicate detection
The enhanced text comparator combines token overlap, word-trigram overlap and sequence similarity. It is deterministic and works offline; it is a lexical similarity proxy, not a semantic embedding model. Exact normalized script fingerprints remain available for identical scripts. Similarity check:
```powershell
python scripts/channel-intelligence.py similarity --first "first draft text" --second "second draft text"
```

## Credentials and setup
- Set `YOUTUBE_DATA_API_KEY` as a local environment variable only when using official YouTube Data API search. Never commit the key or put it in JSON profiles.
- Google Trends RSS, GDELT and Reddit public RSS adapters do not require API credentials; public endpoints can still rate-limit or change.
- YouTube Data API usage is cached and must follow the official Developer Policies and quota rules. Display API-sourced data as API-sourced data. Do not merge it with external analytics to calculate custom channel rankings, infer demographics, monetization or satisfaction.
- No OAuth publishing scope is requested by Phase 1.

## CI coverage
The Phase 1 CI job compiles the modules, tests channel isolation/scoring/duplicate prevention, tests research adapter fallback behavior, validates competitor-gap output, and checks the CLI entry point. CI tests use controlled fixtures; they do not certify that external public feeds are available at every moment.
