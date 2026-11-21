# Dark Phys — Monetization Safety & Originality

This is an editorial risk-control layer, not a YouTube monetization guarantee or automated policy decision. A human must watch the complete final video and review claims, rights, metadata, thumbnail, audio and disclosure before manual upload.

## Phase 1 — channel history

The Channel Intelligence SQLite database now stores approved episode history (script, editorial angle, scene manifest, template/layout IDs and structure fingerprint) separately per channel, plus actual published-upload timestamps.

Examples:

```powershell
python scripts/channel-intelligence.py record-episode --channel dark-phys-en --video-id VIDEO_ID --title "Accurate episode title" --script-file .\uploads\final-script.txt --editorial-angle "Distinct editorial question and point of view" --template-id documentary-v2 --layout-id split-screen --structure-fingerprint scene-order-hash --scenes-json .\uploads\scenes.json
python scripts/channel-intelligence.py episode-history --channel dark-phys-en
python scripts/channel-intelligence.py check-angle --channel dark-phys-en --editorial-angle "A proposed distinct editorial angle"
python scripts/channel-intelligence.py record-upload --channel dark-phys-en --video-id VIDEO_ID --published-at 2026-11-21T12:00:00Z
python scripts/channel-intelligence.py upload-history --channel dark-phys-en
```

The Phase 1 database and Phase 4 JSON history are separate stores. Phase 4 automatically records an episode after human approval and records an upload only when the operator explicitly runs `record-upload`.

## Phase 4 — package and risk report

```powershell
node scripts/phase4-package.js init --file uploads/phase4-package.json
# Fill in the actual script, scene manifest, rights evidence, audio path,
# channel metadata and synthetic-media decision before building.
node scripts/phase4-package.js build --file uploads/phase4-package.json
node scripts/phase4-package.js check --file uploads/phase4-package.json
node scripts/phase4-package.js approve --file uploads/phase4-package.json --reviewer "Reviewer"
node scripts/phase4-package.js record-upload --channel dark-phys-en --video-id VIDEO_ID --published-at 2026-11-21T12:00:00Z
```

Build writes JSON and readable Markdown risk reports next to the package under `monetization-risk/`. High/critical flags create a non-destructive held copy under `quarantine/` and exit with code 42. The production queue treats code 42 as a batch hold and marks queued sibling jobs in that batch as held; it does not delete the original package.

## Scene manifest

Each scene should include a stable `assetId` or `assetHash` (prefer a content hash), plus explicit human-review confirmations:

- `originalVisualOrTransformation`
- `narrativePurpose`
- `rightsRecorded`
- `viewerValue`
- `contextAccurate`

A scene cannot pass approval until all five are true. Prior episode scene manifests are compared for repeated B-roll and repeated three-scene sequences. Reuse is a review signal; licensed reuse is not automatically a monetization violation.

## Audio checks

Set `audioPath` in the package to the rendered narration/final audio file to run local FFmpeg analysis. The analyzer estimates speech cadence from script length and duration, silence ratio from 100 ms RMS windows, and a coarse repeated-energy-pattern loop score. These heuristics are not speech recognition and do not establish audio quality. If analysis is requested but fails, the package receives a high-risk flag. A human listening check is mandatory regardless.

## Synthetic media

Set `realisticSyntheticMedia: true` (or mark relevant scenes with `realisticSynthetic: true`) whenever realistic altered/synthetic material depicts real people, events or places. Record `syntheticDisclosureDecision: "disclose"` when disclosure is required. Marking `deceptiveRealScene: true` or a scene's equivalent blocks approval as critical. The tool cannot reliably infer realism from pixels; the operator must make and record this decision.

## Risk controls and limits

- Script similarity is a deterministic lexical/concept proxy with a small synonym map, not a vector embedding model. It can miss conceptual reuse and produce false positives.
- Title/thumbnail framing uses mismatch, unsupported-claim metadata and sensational-phrase heuristics. Review context; do not treat a flag as a verdict.
- Template fatigue compares the latest ten approved episodes. Default upload burst limits are 3 in 24 hours and 10 in 7 days; configure `maxPerDay` and `maxPerWeek` in the package when a different operational schedule is intended.
- Repeated narration phrases, cadence, silence and audio-loop signals are screening aids. Audio metrics require a supplied audio file or measured metrics.
- Upload velocity depends on accurate published timestamps. Record a video only after it has actually been published.
- High/critical risk flags hold the package and stop the queued batch. Review flags require human attention but do not automatically establish policy violations.
- Human approval is bound to the final video hash and package contents. Any post-approval edit invalidates the approval.
- Publishing remains manual; these controls do not guarantee YPP acceptance, advertiser suitability or continued monetization.
