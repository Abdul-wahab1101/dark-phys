# Dark Phys — YouTube Production Workspace

Dark Phys is the channel workspace for research, scripting, production, review and publishing. The project keeps the two upstream engines isolated instead of copying thousands of files or mixing incompatible runtimes.

## Engines
- **YouTube Automation Agent** (MIT): the single channel orchestrator for topic research, scripts, narration, visuals, video production, SEO, thumbnails, review, approval-gated publishing and analytics.
- **OpenMontage** (AGPL-3.0): optional advanced production engine with pipeline manifests, stage skills, checkpoints and multiple composition runtimes.
- **Dark Phys native assets**: effects.py and keyframes.py are retained as the lightweight FFmpeg effects/keyframe toolkit. The v6 Video Format Planner, upgraded thumbnail designer, and Universal Doctor Agent are integrated as separate modules.

## Phase 1 — Channel Intelligence
The multi-channel research foundation starts with separate English and Pakistani Roman Urdu profiles, a channel-isolated topic ledger, evidence references, a coverage-aware editorial score and duplicate/script fingerprint checks. See [PHASE-1-CHANNEL-INTELLIGENCE.md](PHASE-1-CHANNEL-INTELLIGENCE.md). Quick commands: python scripts/channel-intelligence.py channels and python scripts/channel-intelligence.py check-duplicate --channel dark-phys-en --title "Topic title". The local SQLite database is created on first run and is not committed.

## Phase 2 — Stock footage foundation
A Pixabay Video API adapter now supports safe-search metadata discovery and explicit, size-limited downloads. It stores a local asset manifest with creator, source page, retrieval time and license-review reminders. See [PHASE-2-STOCK-FOOTAGE.md](PHASE-2-STOCK-FOOTAGE.md). The API key is read from PIXABAY_API_KEY in the local environment; never commit it. Search and download commands are:
- node scripts/stock-footage.js search "psychological manipulation"
- node scripts/stock-footage.js download 123456 --query "psychological manipulation"

This is a sourcing foundation, not yet an automatic scene editor. Each clip still requires human selection and license/restrictions review.

## Phase 3 — Cinematic Production Engine
Dual Pixabay key support, scene-by-scene real video-footage shortlists, explicit asset/rights approval, FFmpeg moving-footage assembly, voice-led music ducking, and OpenMontage return-queue ingestion are documented in [PHASE-3-CINEMATIC-PRODUCTION.md](PHASE-3-CINEMATIC-PRODUCTION.md). Set PIXABAY_API_KEY and PIXABAY_API_KEY_2 locally. The renderer does not silently choose footage or publish; motion-map/graphics stages still depend on the separate OpenMontage runtime and human review.

## Phase 2 — Original Content Studio
The source-traceable content studio builds bilingual documentary draft packages from researcher-supplied evidence and separate English/Roman Urdu narration. It includes claim references, fact-check review status, hooks, long-form structure, retention checkpoints, originality checklist and Shorts plans. See [PHASE-2-ORIGINAL-CONTENT-STUDIO.md](PHASE-2-ORIGINAL-CONTENT-STUDIO.md). Run `node scripts/research-content-studio.js "gaslighting psychology" --region=US --language=en` to collect public research leads, then `node scripts/content-studio.js research-package.json` to create source-bound bilingual writer prompts and review packages. Run `node scripts/test-content-studio.js` for regression tests. This is an offline editorial workflow, not autonomous web research or a finished AI writer; sources and narration must be supplied and verified by a human.

## Phase 4 — Packaging & Monetization Safety
Cloudflare Worker thumbnail concepts (three distinct 1280×720 directions), SEO title/description/chapter drafts, per-asset license evidence, advisory reused/inauthentic-content checks, Community Guidelines and advertiser-suitability review gates, and tamper-evident final human approval are implemented in [PHASE-4-PACKAGING-MONETIZATION-SAFETY.md](PHASE-4-PACKAGING-MONETIZATION-SAFETY.md). Start with `node scripts/phase4-package.js init --file uploads/phase4-package.json`. Cloudflare deployment requires the owner's account and secret; see [the Worker guide](workers/thumbnail-worker/README.md). Approval is manual-upload-only and never enables automated publishing.

## Phase 5 — Automation, Publishing & Growth
The pinned YouTube Automation Agent provides the production dashboard, isolated channel workspaces/OAuth, approval-gated publishing, Shorts scheduling, real analytics/retention and controlled thumbnail experiments. Create each channel workspace with node scripts/channel-workspace.js create --id dark-phys-en --name "Dark Phys English" --port 3457 (repeat with a different ID/port), then launch it with .\\start-dark-phys-channel.ps1 -ChannelId dark-phys-en. See [the Phase 5 runbook](PHASE-5-AUTOMATION-PUBLISHING-GROWTH.md). Start with `./start-dark-phys.ps1`; run `node scripts/phase5-operator.js status` for read-only checks or `node scripts/phase5-operator.js open` to open the dashboard. Universal Doctor health, backup and rollback remain available separately. Live OAuth, real uploads and channel analytics require the owner's local credentials and explicit review.

## Phase 6 — Viral Intelligence & Growth Engine
The evidence-led Viral Intelligence Engine prioritises topics, builds hook/story/retention/packaging briefs, audits script structure and defines an analytics learning loop. It includes an official YouTube Data API trend adapter (API key required only at final setup). It reports evidence coverage/confidence separately and never claims to predict virality. See [Phase 6 guide](PHASE-6-VIRAL-INTELLIGENCE.md). Run `node scripts/viral-intelligence.js --help`, `node scripts/viral-trends.js --help` and `node scripts/viral-generate.js --help` for commands. Bilingual AI draft generation uses a configurable provider key added only during final API setup. This module is an offline decision-support layer: current trend evidence and competitor observations must come from permitted sources and be verified; existing original-content, cinematic production, Phase 4 rights/approval and Phase 5 publishing gates remain mandatory.

## Windows quick setup
1. Install Git, Node.js 20 LTS (18.17+ minimum for the YouTube agent), Python 3.10+, and FFmpeg.
2. Open PowerShell in this repository.
3. Run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup-dark-phys.ps1
   ```
   This installs the YouTube engine only. OpenMontage is optional; when advanced rendering is needed, run `./setup-openmontage.ps1` separately.
4. Add at least one text-provider API key in engines\youtube-automation-agent\.env. Provider free tiers and limits vary.
5. Add YouTube OAuth Desktop credentials only if you want to connect/publish to your channel; follow the upstream walkthrough rather than creating credentials by guesswork.
6. Run .\start-dark-phys.ps1 and open http://localhost:3456.

## Validation and sample render
The unified GitHub Actions workflow checks the PowerShell setup/launch scripts on a Windows runner, starts the real Universal Doctor dashboard on Windows and verifies its localhost API/token guard; it also starts the main YouTube automation dashboard in setup-required mode, and creates/probes a short H.264/AAC sample MP4. These are hosted-runner checks, not proof that setup has completed on your personal PC. The full upstream engine installation still requires downloading dependencies and configuring your own provider credentials.

Run the lightweight local checks from the repository root:
```powershell
python scripts/test-dashboard-launch.py
node scripts/test-main-dashboard-launch.js
python agents/universal-doctor/doctor.py selftest
node scripts/test-openmontage-handoff.js
node scripts/test-stock-footage.js
```
PowerShell syntax/configuration validation:
```powershell
./scripts/test-windows-setup.ps1
```
See [FINAL-WINDOWS-SETUP-ROMAN-URDU.md](FINAL-WINDOWS-SETUP-ROMAN-URDU.md) for the step-by-step guide.

## Integrated ZIP upgrades
- agents/video-format-planner.js creates a six-format video plan, hook/title options, shot list, chapters, SRT/ASS captions and audio-mix instructions.
- agents/thumbnail-designer-agent.js is the upgraded 24-family v10 thumbnail designer; utils/logger.js supplies its shared logger dependency.
- agents/universal-doctor/ contains the standalone Python Doctor with diagnostic modes, backups, tests, rollback and a localhost dashboard. Keep it in diagnostic mode unless you explicitly approve repairs.
- Run node scripts/plan-video.js "7 Signs You Are Being Gaslighted" to create a plan. Run node scripts/test-video-planner.js, node scripts/test-thumbnail-designer.js, and node scripts/test-quality-check.js for add-on tests. Run node scripts/quality-check.js --video uploads/final.mp4 --captions uploads/final.srt --thumbnail uploads/thumbnail.jpg --seo uploads/seo.json --mode long before manual approval. Doctor: python agents/universal-doctor/doctor.py selftest.

## YouTube Automation workflow
The complete connected workflow, final MP4 quality gate and approval boundary are documented in [COMPLETE-AUTOMATION-WORKFLOW.md](COMPLETE-AUTOMATION-WORKFLOW.md) and [YOUTUBE-AUTOMATION-INTEGRATION.md](YOUTUBE-AUTOMATION-INTEGRATION.md). The upstream agent remains the only top-level orchestrator: research → script → thumbnail → SEO → production → human review/approval → publishing → analytics/learning. The Dark Phys planner supplements pre-production; it does not create a second pipeline or bypass review.

## OpenMontage production engine
OpenMontage is the optional advanced production workspace, connected through a handoff rather than a competing second YouTube orchestrator. See [OPENMONTAGE-INTEGRATION.md](OPENMONTAGE-INTEGRATION.md) for the 8–12 minute long-form workflow, five-Shorts workflow, runtime tradeoffs and test boundaries. After the standard clone, run Set-ExecutionPolicy -Scope Process Bypass then ./setup-openmontage.ps1 only when ready for the larger install. Export a long-form handoff with node scripts/export-openmontage.js --title "Video title" --script uploads/approved-script.txt --mode long, or Shorts from a rendered source with node scripts/export-openmontage.js --title "Video title" --source-video uploads/final-video.mp4 --mode shorts. OpenMontage stays optional and keeps its AGPL-3.0 license and notices intact.

## Safety and publishing
- Nothing is uploaded or published automatically by Dark Phys.
- Review factual claims, media rights, narration and final MP4 before approving.
- Publishing requires the user's explicit approval and valid Google OAuth credentials.
- Never commit API keys, OAuth tokens, .env, generated media or private channel data.

## Hardware note
For an older i7 / 8 GB RAM PC, use the lightweight launcher and avoid running multiple renderers simultaneously. Prefer FFmpeg for basic assembly; advanced OpenMontage pipelines may be slow or require additional dependencies. AI provider usage may cost money; check pricing and set limits before enabling paid generation.

## Upstream licenses
- YouTube Automation Agent: MIT — https://github.com/darkzOGx/youtube-automation-agent
- OpenMontage: AGPL-3.0 — https://github.com/OpenMontageInc/OpenMontage

Each engine is cloned as its own upstream checkout. Keep its license and notices intact; do not remove attribution or imply that Dark Phys owns upstream code.

## Professional reliability and lightweight mode
The upstream single-controller orchestration already provides shared agent services, structured logs, job progress, persistent generation checkpoints, transient-error retries and resume support. Dark Phys adds a structural regression check and a conservative Windows launcher for lower-memory PCs. See [PROFESSIONAL-RELIABILITY-UPGRADES.md](PROFESSIONAL-RELIABILITY-UPGRADES.md). Use start-dark-phys-lite.ps1 for the 2 GB Node heap profile; use the regular launcher for normal mode.


## Thumbnail design system v10
The thumbnail designer now includes 24 distinct SVG-over-photo design families (the original 12 plus 12 v10 additions), topic-aware family scoring, headline-aware big-number weighting, and family rotation to reduce repetitive visual patterns. New families include evidence-board, neon-cyber, redacted-file, hazard-warning, duotone-poster, chat-screen, big-number, spotlight-stage, torn-paper, viewfinder, minimal-modern and vhs-glitch. See [the Urdu v10 guide](THUMBNAIL-DESIGNS-V10-URDU.md). CI validates all 24 families and renders a contact sheet using synthetic test backgrounds; final visual selection and actual channel-specific subject photography still require human review.


## Phase 7 — Production Readiness & Reliability
Run `node scripts/phase7-readiness.js` before a production session, or add `--json` for a machine-readable report. It checks local runtime prerequisites, engine/dependency presence, FFmpeg availability, optional OpenMontage presence, available memory/disk and whether recognised provider credential variables are present. Credential values are never printed. The check is offline and read-only: it does not edit files, call providers, start jobs or publish. `BLOCK` means a hard prerequisite/resource issue; `CAUTION` means review warnings; `GO` means no blockers were detected (not a guarantee of successful rendering or YouTube approval). See [Phase 7 guide](PHASE-7-PRODUCTION-READINESS.md).
