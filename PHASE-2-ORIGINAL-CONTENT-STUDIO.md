# Phase 2 — Original Content Studio / Script Engine v2

## Script Engine v2

The default AI writing route is now `node scripts/viral-generate.js research-package.json` (or `node scripts/script-engine-v2.js`). Use `--short` for the separate 20–60 second Shorts pipeline. The previous generator remains available with `--legacy`.

The v2 pipeline adds:
- Separate Long-form and Shorts briefs, pacing requirements and validation.
- Source-linked claim ledger. Unknown source IDs and claim IDs are rejected; single-source claims and claims not marked reviewed are flagged.
- Exactly one central question and one case-study/illustration field per draft.
- Three title options and three distinct hooks; long-form cold open, promise, 3–5 acts, open loops, rehooks and payoff; Shorts use one complete idea.
- Sentence-level visual-intent records, each with a meaning-based footage query and source type.
- Critic scoring and revision pass, spoken/read-aloud polish, and a tightening pass targeting approximately 15%.
- Final structural and claim-reference validation. A failed schema, incomplete claim map or out-of-range tightening result blocks the draft.
- Human source verification and approval gates remain mandatory. AI cannot independently prove that a cited source supports a claim.

## Input package

Use the existing JSON shape documented below. It must include topic, sources, claims, separate English and Roman Urdu narration/reference text, and researcher-rated `viralFactors` (0–5). Do not invent source URLs, evidence or scoring factors. The provider needs `DARK_PHYS_LLM_API_KEY` and `DARK_PHYS_LLM_MODEL`; optional `DARK_PHYS_LLM_BASE_URL` supports an OpenAI-compatible endpoint.

```powershell
node scripts/viral-generate.js research-package.json
node scripts/viral-generate.js research-package.json --short
node scripts/viral-generate.js research-package.json --legacy
node scripts/test-production-engines-v2.js
```

Generated packages are drafts. Open each source, verify exact claim context and dates, review native-language delivery, and approve before production. Critic scores are editorial guidance, not audience-retention or view predictions.

## Legacy offline package

The deterministic offline package builder remains available through `node scripts/content-studio.js research-package.json`. It continues to generate source registers, bilingual prompts and editorial checklists without calling an LLM. The offline path is not a replacement for the v2 AI writer.
