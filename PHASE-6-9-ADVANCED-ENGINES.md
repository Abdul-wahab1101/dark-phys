# Dark Phys — Advanced Production Engines (Points 4–9)

All outputs are drafts until the owner reviews them. Uploading and publishing remain manual by default.

## 4. Sound Design

The v11 renderer accepts musicSegments and ambienceSegments on the scene-plan JSON. Each bed uses path, startSeconds, endSeconds, optional act, mood, gainDb, fadeInSeconds, fadeOutSeconds, ducking and a rights object. Ambience defaults to -32 dB; music defaults to -25 dB. Voice sidechain ducking is enabled unless explicitly disabled for that bed. Scene-tagged effects use a local sound-effects/manifest.json with id, path and tags.

The renderer writes final.sound-cue-sheet.json beside the export. Every music/ambience source must have a verified commercial-use license, HTTPS license URL or existing local proof, and human approval. Unknown rights block v11 preflight.

## 5. Independent Shorts Factory

Input is a word-timestamp transcript JSON file (transcript or words array). Each word has start, end and text. Optional scene start timestamps improve candidate discovery.

    node scripts/shorts-factory.js plan --input uploads/transcript.json --count 3 --min 20 --max 60 --target 42 --output uploads/shorts-plan.json
    node scripts/shorts-factory.js render --input uploads/shorts-plan.json --id short-01 --video uploads/final-long.mp4 --output uploads/short-01.mp4

Rendering creates 1080x1920 vertical video, clip-relative SRT captions and a default blurred-fill composition that preserves the original frame. Optional flags: --music bed.mp3 --voice narration.wav --layout blur-fill|crop --focus-x 0.5. Music is sidechain-ducked beneath voice and loudness-limited. Every Short retains source timecodes and must pass its own Short QC; a long-video QC pass does not approve its Shorts.

## 6. Packaging

    node scripts/phase4-package.js build --file uploads/phase4-package.json
    node scripts/phase4-package.js check --file uploads/phase4-package.json

The package contains three distinct title/thumbnail combinations, script-coverage and unsupported-claim warnings, SEO description/tags and draft chapters. Thumbnail generation can create three 1280x720 concepts through the configured Cloudflare Workers AI account. Select a concept manually. YouTube Test & Compare is never assumed available and is never started by the CLI; verify the feature and account eligibility in YouTube Studio, then run any experiment there with owner approval.

## 7. Analytics

Export owner-authorized YouTube Analytics data to JSON using this shape:

    {
      "videos": [
        {
          "videoId": "VIDEO_ID",
          "title": "Published title",
          "status": "public",
          "views": 1000,
          "impressions": 12000,
          "ctr": 0.05,
          "averageViewDurationSeconds": 240,
          "averageViewPercentage": 42,
          "retention": [
            {"elapsedVideoTimeRatio": 0, "audienceWatchRatio": 1},
            {"elapsedVideoTimeRatio": 0.2, "audienceWatchRatio": 0.78}
          ]
        }
      ],
      "scriptBeatsByVideo": {
        "VIDEO_ID": [
          {"startRatio": 0.2, "endRatio": 0.35, "title": "Evidence"}
        ]
      }
    }

    node scripts/analytics-report.js --input uploads/youtube-analytics-export.json

The report includes CTR (mean, median and impression-weighted), views, impressions, average view duration, average view percentage, aggregate retention curve, 8-percentage-point retention drops and script-beat mapping. Duplicate video IDs count once; explicitly private/unlisted/draft/scheduled rows are excluded. Strategy changes remain locked until 15 unique published videos are available. After that, suggestions remain advisory and require owner approval; no automatic rule changes occur.

## 8. Separate Long/Short QC

    node scripts/quality-control.js --video uploads/final.mp4 --mode long --captions uploads/final.srt --thumbnail uploads/thumb.jpg
    node scripts/qc-review-page.js --mode long --video uploads/final.mp4 --output uploads/long-review.html
    node scripts/qc-review-page.js --mode short --video uploads/short-01.mp4 --output uploads/short-review.html

Open the generated HTML page locally, watch the export and confirm each of the five review sections. The page saves progress in the browser and can export a review JSON. To attach that completed human review to the technical QC report:

    node scripts/quality-control.js --video uploads/final.mp4 --mode long --captions uploads/final.srt --thumbnail uploads/thumb.jpg --review uploads/long-review.json

The review JSON must match the exact video path and mode. Technical QC uses FFprobe; visual, audio and editorial confirmations remain explicitly human. A successful QC report is readiness for a separate manual approval decision—not upload permission.

## 9. Weekly orchestration

Create a jobs.json file containing a jobs array. Every job needs a unique jobId, a type, an allowlisted script filename and optional argument array. timeoutMs may be set from 60 seconds to 12 hours; default is six hours.

    node scripts/production-queue.js add-weekly --file uploads/jobs.json --spacing-hours 24
    node scripts/production-queue.js list
    node scripts/production-queue.js run-next
    node scripts/production-queue.js cleanup-temp --base-dir uploads/temp
    node scripts/production-queue.js cleanup-temp --base-dir uploads/temp --execute

Only due jobs run. One heavy job is allowed at a time. Failed jobs use bounded exponential retries; interrupted parent processes are recovered from the durable queue; checkpoint metadata is saved around each job stage. The child process has a hard timeout. Temporary cleanup is dry-run by default and deletes only old directories with a valid Dark Phys ownership marker. Review the dry-run list before --execute.

## Safety boundaries

- No automatic public upload or publishing is enabled by these engines.
- Rights, factual accuracy, originality, title/thumbnail honesty and policy suitability require human review.
- Analytics data must come from the channel owner’s authorized export; missing metrics remain unknown, never fabricated as zero.
- Never commit .env, API keys, OAuth tokens, license evidence or private analytics exports.
- CI uses fixtures/mocks and cannot validate the owner's live Gemini, Pixabay, Cloudflare or YouTube account access.
