# Phase 3 — Cinematic Production Engine

## Implemented
- Two-key Pixabay pool: PIXABAY_API_KEY and PIXABAY_API_KEY_2; keys are process environment secrets, never logged or written into output.
- Beat-based cinematic scene plan with B-roll queries, shot/movement cues, overlays and optional map metadata.
- Real video-footage discovery with per-scene shortlist. No first-result auto-selection: a human chooses the clip and approves rights.
- Approved clip download with current-result revalidation and source/creator/license manifest.
- FFmpeg draft assembly from moving video clips (not still-image slideshows), 1080p/30fps H.264 using the ultrafast preset.
- Voice/music mix with sidechain music ducking and loudness normalization.
- OpenMontage return-folder copy into a human review queue, with no overwrites and no publishing.
- Phase 3 regression tests.

## PowerShell workflow
Set keys locally:
    $env:PIXABAY_API_KEY = "YOUR_FIRST_KEY"
    $env:PIXABAY_API_KEY_2 = "YOUR_SECOND_KEY"
    node scripts/plan-scenes.js uploads\approved-beats.json
    node scripts/cinematic-production.js discover uploads\production\PROJECT_ID\scene-plan.json

Review asset-selection.json. Set selectedAssetId to a listed ID and rightsApproved to true only after reviewing the source page and current license. Then:
    node scripts/cinematic-production.js download-approved uploads\production\PROJECT_ID\asset-selection.json
    node scripts/cinematic-production.js render uploads\production\PROJECT_ID\asset-selection.json uploads\narration.wav uploads\music.mp3 uploads\draft.mp4

FFmpeg must be on PATH or configured through FFMPEG_PATH.

## OpenMontage return
Use the existing export-openmontage.js for the handoff brief. After the separate OpenMontage engine finishes, copy its deliverables into the handoff return folder and run:
    node scripts/ingest-openmontage-return.js PATH_TO_RETURN_FOLDER
Files are copied to uploads/review-queue/openmontage-return. Existing files are never overwritten. Publishing remains disabled.

## Motion graphics and maps — honest boundary
Scene plans preserve overlay and map metadata for OpenMontage stage execution. The current FFmpeg fallback assembles footage and mixes audio; it does not yet render a complete animated-map or kinetic-typography package itself. Use the map/motion-graphics capable OpenMontage stages and review the returned render. Do not mistake a scene brief for a rendered animation.

## Low-spec Windows profile
For an i7 4th-gen / 8 GB PC: one render at a time, 1080p only, short sample first, FFmpeg ultrafast preset, avoid concurrent AI engines and 4K. Heavy Remotion/browser compositions may be too slow locally. Actual speed must be measured on the owner's PC.
