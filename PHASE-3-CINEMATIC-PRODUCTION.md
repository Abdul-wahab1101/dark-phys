# Phase 3 — Cinematic Production Engine

## Implemented
- Two-key Pixabay pool: PIXABAY_API_KEY and PIXABAY_API_KEY_2; keys are process environment secrets, never logged or written into output.
- Beat-based cinematic scene plan with B-roll queries, shot/movement cues, overlays and optional map metadata.
- Real video-footage discovery with per-scene shortlist. No first-result auto-selection: a human chooses the clip and approves rights.
- Approved clip download with current-result revalidation and source/creator/license manifest.
- FFmpeg draft assembly from moving video clips (not still-image slideshows), with planned per-scene trim timing.
- Rendered kinetic lower-thirds, animated title fades, scene callouts and schematic route-map cards from scene metadata.
- ElevenLabs professional narration generation (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `eleven_multilingual_v2`) plus voice processing, sidechain music ducking, loudness normalization and optional timed SFX track (`DARK_PHYS_SFX_FILE`).
- OpenMontage project handoff brief plus a return-folder watcher that copies completed assets into the review queue without overwrites or publishing.
- Low-memory render profile: automatic 720p preview on machines with 8 GB RAM or less, 1080p final via `DARK_PHYS_RENDER_QUALITY=final`, ultrafast H.264 and two threads.

## PowerShell workflow
Set keys locally:
    $env:PIXABAY_API_KEY = "YOUR_FIRST_KEY"
    $env:PIXABAY_API_KEY_2 = "YOUR_SECOND_KEY"
    node scripts/plan-scenes.js uploads\approved-beats.json
    node scripts/cinematic-production.js discover uploads\production\PROJECT_ID\scene-plan.json

Review asset-selection.json. Set selectedAssetId to a listed ID and rightsApproved to true only after reviewing the source page and current license. Then:
    node scripts/cinematic-production.js download-approved uploads\production\PROJECT_ID\asset-selection.json
    node scripts/cinematic-production.js render uploads\production\PROJECT_ID\asset-selection.json uploads\narration.wav uploads\music.mp3 uploads\draft.mp4

Generate approved script narration with `node scripts/narrate.js uploads\\approved-narration.txt uploads\\narration.mp3` after setting the ElevenLabs key and voice ID locally. Then pass that narration MP3 to the render command. FFmpeg must be on PATH or configured through FFMPEG_PATH.

## OpenMontage return
Use the existing export-openmontage.js for the handoff brief. After the separate OpenMontage engine finishes, copy its deliverables into the handoff return folder and run:
    node scripts/ingest-openmontage-return.js PATH_TO_RETURN_FOLDER

For automatic local return-folder pickup while OpenMontage is running:
    node scripts/watch-openmontage-return.js PATH_TO_RETURN_FOLDER

Keep this watcher running in a second terminal; it copies newly returned files into the review queue without publishing.
Files are copied to uploads/review-queue/openmontage-return. Existing files are never overwritten. Publishing remains disabled.

## Motion graphics and maps
The FFmpeg renderer uses libass subtitle overlays (not the optional `drawtext` filter) for animated lower-thirds, fade/slide title treatments and timed callouts, plus FFmpeg `drawbox` route-map cards when a scene includes at least two normalized map points (`x` and `y` from 0 to 1). OpenMontage remains the higher-fidelity option for full geographic maps, complex camera moves and layered compositions.

## Sound design
Set `DARK_PHYS_SFX_FILE` to an approved local effects stem to add it to the master mix. Music is sidechain-ducked under processed narration; effects are gain-staged and included in the final loudness-normalized mix. Keep music/SFX rights records with the project.

## Low-spec Windows profile
On machines with 8 GB RAM or less, rendering defaults to 1280x720 preview, one filter thread, two encode threads, H.264 ultrafast and CRF 28. Set `DARK_PHYS_RENDER_QUALITY=final` for 1920x1080 final output (CRF 24). Render one project at a time; close browsers and other AI engines during encoding. Heavy Remotion/Chromium compositions remain optional and should be run only after a short sample proves stable.

## v11 integrated production backend
The existing `cinematic-production.js render` command now routes approved footage through the integrated v11 production engine by default. It reuses the existing scene plan, approved Pixabay manifest and narration file; it does not create another orchestrator. The v11 stages include hook/pacing analysis, license and reused-content preflight before rendering, crash-safe checkpoints, chunked FFmpeg rendering, supervised process timeouts, two-pass loudness verification and a final review report. Set `DARK_PHYS_PRODUCTION_ENGINE=legacy` to explicitly select the previous renderer. The engine is not installed or run during setup; CI validates its source and tests.
