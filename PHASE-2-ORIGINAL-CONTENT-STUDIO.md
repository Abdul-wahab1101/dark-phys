# Phase 2 — Original Content Studio

## Delivered workflow

The studio accepts a researcher-prepared JSON package and produces a traceable documentary draft bundle:
- Source register with title, publisher, URL and publication/access dates.
- Claim-to-source ledger. Each claim must reference one or more known source IDs; unknown references are rejected.
- Fact-check status defaults to \`needs_human_verification\`. References establish traceability, not truth.
- Distinct English and Pakistani Roman Urdu narration inputs and outputs. The engine does not translate one language into the other.
- Hook options, eight-beat 8–12 minute documentary structure, retention checkpoints and a 45-second Shorts plan for each language.
- Originality fingerprint and editorial checklist; compare against the channel history before approval.
- Draft approval gates for evidence, fact-check, language edit, originality and script.

## Input package

Create a UTF-8 JSON file using this shape (replace example URLs and text with sources actually read):
\`\`\`json
{
  "topic": "Why people doubt their own memory",
  "researchSummary": "Summarise the research question and competing interpretations.",
  "sources": [
    {"id":"s1","title":"Source title","publisher":"Publisher","url":"https://example.org/paper","publishedAt":"2024-01-01","accessedAt":"2026-11-19"}
  ],
  "claims": [
    {"id":"c1","text":"A precise factual claim","sourceIds":["s1"],"notes":"What the source does and does not establish"}
  ],
  "titles": {"en":"Why You Sometimes Doubt Your Own Memory","ur-Latn":"Aap Apni Yaad Par Shak Kyun Karte Hain?"},
  "narration": {
    "en":"Write the English narration draft here.",
    "ur-Latn":"Roman Urdu mein fitri Pakistani lehje mein alag narration yahan likhein."
  }
}
\`\`\`

## Run on Windows PowerShell

\`\`\`powershell
node scripts/content-studio.js research-package.json
node scripts/content-studio.js research-package.json --short
node scripts/content-studio.js research-package.json --duration=600
node scripts/test-content-studio.js
\`\`\`

Outputs are written under \`uploads/content-studio/<topic>/\`: JSON package, source references, English narration and Roman Urdu narration.

## Important capability boundary

This is a deterministic, offline drafting and editorial-structure engine, not a live web researcher or an LLM writer. It does not independently read papers, verify whether a source supports a claim, create a polished 1,500-word finished documentary from a topic alone, generate voice audio, or automatically cut Shorts. Research notes and both language drafts must be supplied by a researcher/writer. Hook and structure suggestions are editorial starting points, not guaranteed retention. Every claim and narration requires human fact-check and language review. No paid API key is needed for this local workflow.
