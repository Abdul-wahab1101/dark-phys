# Dark Phys — Advanced production engines (Points 5–9)

## 4. Sound Design — completed and expanded
The scene-aware sound design engine builds act/scene mood metadata, a timestamped cue sheet, SFX placement, intentional silence windows, voice-first music ducking and a music-rights ledger record. For separate act scores, add musicSegments to the scene plan; each segment has act, path, startSeconds, endSeconds, mood, gainDb and a rights object. The v11 mixer mixes each act track at its timeline position, ducks it under narration, applies silence windows and writes a .sound-cue-sheet.json beside the final video. Each soundtrack is registered and usage-tracked in the same rights ledger as footage. A soundtrack with an unknown/non-commercial/unapproved license is blocked by v11 preflight; do not bypass the ledger. Record rights with source, sourceUrl, creator, licenseId, licenseUrl or proofPath, retrievedAt, commercialUseVerified: true, reviewStatus: approved and any required attribution text. Supported license IDs follow the v11 ledger.

## 5. Shorts Factory
1. Export word-level timestamps from the approved narration/transcript as JSON (transcript array; each row has start, end, text).
2. Plan independent highlights: node scripts/shorts-factory.js plan --input uploads/transcript.json --count 3 --min 20 --max 60.
3. Inspect each selected segment and its source provenance; edit the plan if the clip removes necessary context.
4. Render: node scripts/shorts-factory.js render --input uploads/shorts-plan.json --id short-01 --video uploads/final.mp4 --output uploads/short-01.mp4.
5. Run separate Short QC: node scripts/quality-control.js --video uploads/short-01.mp4 --mode short --captions uploads/short-01.srt.
The factory selects 15–60 second candidates (defaults 20–60), ranks hook/evidence/payoff signals, avoids near-duplicate overlaps, creates timed captions and renders vertical 1080x1920 H.264/AAC with subtitles. It does not invent transcript timestamps; word-level timestamps are required. Shorts are drafts; review each independently and publish manually.

## 6. Packaging
The Phase 4 build command now adds packagingTests with three distinct script-matched title/thumbnail combinations. Supply three reviewed thumbnailConcepts when available; otherwise it creates concept briefs for manual design. Existing SEO description, tags, chapter drafts and rights checks remain. Thumbnail/title selection is human-reviewed. YouTube Test & Compare remains unverified until the owner checks the live YouTube Studio feature and OAuth permissions; configuration flags are recorded as owner-reported only and never claim that an experiment is available or started. If unavailable, use a controlled manual comparison and follow current YouTube product guidance.

## 7. Analytics
Export actual channel/video metrics from YouTube Analytics (or provide an authorized connector export) into JSON. Each video row should include videoId, views, impressions, ctr, averageViewDurationSeconds, averageViewPercentage and retention points (elapsedVideoTimeRatio, audienceWatchRatio). Optional scriptBeatsByVideo maps each video's retention ratio to script beat startRatio/endRatio/title.
Run: node scripts/analytics-report.js --input uploads/youtube-analytics-export.json.
The report calculates CTR, average view duration, average view percentage and retention drops mapped to script beats. Strategy recommendations stay locked until at least 15 videos have usable data. Meeting the threshold enables advisory review only; no automatic changes are made. Missing metrics remain null rather than fabricated.

## 8. QC
Run node scripts/quality-control.js --video uploads/final.mp4 --mode long --captions uploads/final.srt --thumbnail uploads/thumb.jpg or use --mode short for a vertical Short. Technical checks are separate from visual, audio and editorial human confirmations. A technically valid file is not automatically editorially approved. Generate the five-minute review page with node scripts/qc-review-page.js --mode long --video uploads/final.mp4 --output uploads/qc-review.html. Open it locally, watch the full export and complete the five timed review sections. Manual publishing remains the default.

## 9. Orchestration
Create a JSON batch file with a jobs array. Each job needs jobId, type, script (an allowlisted production script filename) and args array. Add weekly queue entries with node scripts/production-queue.js add-weekly --file uploads/weekly-jobs.json --spacing-hours 24; inspect with node scripts/production-queue.js list; execute one due job with node scripts/production-queue.js run-next.
The runner has an allowlist of production scripts, one heavy-job lock, persistent stage checkpoints, bounded exponential retries, orphaned-worker recovery and ownership-marker-based temporary cleanup. Preview cleanup with node scripts/production-queue.js cleanup-temp --base-dir PATH; it is dry-run by default. Add --execute only after reviewing the candidate list. It never deletes unmarked folders. Review queue state and backups before manual cleanup.

## Operational boundaries
- Live Gemini/YouTube OAuth, API quotas, Test & Compare eligibility, account permissions and private analytics cannot be verified by offline CI.
- No automated publishing is enabled by these helpers. Keep upload/scheduling manual unless you later explicitly approve a separate OAuth publishing workflow.
- Do not change channel strategy based on fewer than 15 videos.
