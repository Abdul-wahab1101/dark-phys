# Dark Phys complete automation workflow

The pinned YouTube Automation Agent remains the sole orchestrator. Start it with `start-dark-phys.ps1`; it coordinates research/strategy, script generation, thumbnail, SEO, narration/production, dashboard review, approval-gated publishing and analytics. Do not create a second scheduler or upload path.

## Production stages

1. **Research & strategy** — generate topic/angle and retain references; review factual claims.
2. **Script** — generate narration, structure and chapters; approve the script before visuals.
3. **Scenes** — use the Video Format Planner to produce a scene/shot plan, timing, b-roll prompts and caption/audio direction:
   `node scripts/plan-video.js "Topic title"`
4. **Voiceover & visuals** — configure a supported provider in the upstream credential manager. The agent capability check reports whether text, image and TTS are actually configured; missing providers must never be described as generated assets.
5. **Editing/rendering** — use the upstream Production Management Agent for its normal output, or export an OpenMontage handoff for the optional advanced production runtime. OpenMontage renders are returned to the main review queue; it does not publish.
6. **Captions, transitions, SFX & music** — planner creates SRT/ASS captions and audio mix instructions (music ducking/loudness). Production engine performs the actual mix/assembly; use licensed/owned assets only.
7. **Thumbnail & SEO** — use the thumbnail and SEO agents; save SEO JSON with `title`, `description`, and `tags`.
8. **Final quality gate** — run the independent ffprobe-based gate below. It checks stream presence, runtime, orientation/resolution, frame rate, captions, thumbnail and SEO metadata. Failed checks block approval.
9. **Human approval & publishing** — inspect the MP4, thumbnail, captions, claims, rights and quality report in the upstream dashboard. Only then use its approved publishing flow with YouTube OAuth. No CLI command in Dark Phys bypasses that approval.

## Final quality check

Long-form (8–12 minutes, landscape):
```powershell
node scripts\quality-check.js --video uploads\final.mp4 --captions uploads\final.srt --thumbnail uploads\thumbnail.jpg --seo uploads\seo.json --mode long
```

Short (20–60 seconds, vertical):
```powershell
node scripts\quality-check.js --video uploads\short.mp4 --captions uploads\short.srt --thumbnail uploads\short.jpg --seo uploads\short-seo.json --mode short
```

SEO JSON example:
```json
{"title":"A clear searchable title","description":"A useful description with context, chapters and a viewer prompt.","tags":["dark psychology","human behavior"]}
```

The command writes a `.quality-report.json` beside the video and exits non-zero if any check fails. It requires FFmpeg's `ffprobe` on PATH. It validates technical deliverables, not factual accuracy, copyright, thumbnail click appeal or whether the narrative is good; those remain human review items.

## Verification boundary

CI validates planner/thumbnail/quality-gate logic and the upstream agent's offline regression suite. Real provider generation, Windows rendering speed, the user's YouTube OAuth and live upload cannot be proven in CI without the user's local credentials and media. Provider pricing/free tiers vary; configure only services the owner chooses. Publishing remains manual approval-gated.
