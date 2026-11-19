# Dark Phys — YouTube Production Workspace

Dark Phys is the channel workspace for research, scripting, production, review and publishing. The project keeps the two upstream engines isolated instead of copying thousands of files or mixing incompatible runtimes.

## Engines
- **YouTube Automation Agent** (MIT): the single channel orchestrator for topic research, scripts, narration, visuals, video production, SEO, thumbnails, review, approval-gated publishing and analytics.
- **OpenMontage** (AGPL-3.0): optional advanced production engine with pipeline manifests, stage skills, checkpoints and multiple composition runtimes.
- **Dark Phys native assets**: `effects.py` and `keyframes.py` are retained as the lightweight FFmpeg effects/keyframe toolkit. The v6 Video Format Planner, upgraded thumbnail designer, and Universal Doctor Agent are integrated as separate modules.

## Phase 1 — Channel Intelligence
The multi-channel research foundation starts with separate English and Pakistani Roman Urdu profiles, a channel-isolated topic ledger, evidence references, a coverage-aware editorial score and duplicate/script fingerprint checks. See [PHASE-1-CHANNEL-INTELLIGENCE.md](PHASE-1-CHANNEL-INTELLIGENCE.md). Quick commands: `python scripts/channel-intelligence.py channels` and `python scripts/channel-intelligence.py check-duplicate --channel dark-phys-en --title "Topic title"`. The local SQLite database is created on first run and is not committed.

## Windows quick setup
1. Install Git, Node.js 20 LTS (18.17+ minimum for the YouTube agent), Python 3.10+, and FFmpeg.
2. Open PowerShell in this repository.
3. Run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup-dark-phys.ps1
   ```
4. Add at least one text-provider API key in `engines\youtube-automation-agent\.env`. Provider free tiers and limits vary.
5. Add YouTube OAuth Desktop credentials only if you want to connect/publish to your channel; follow the upstream walkthrough rather than creating credentials by guesswork.
6. Run `.\start-dark-phys.ps1` and open http://localhost:3456.

## Validation and sample render
The unified GitHub Actions workflow checks the PowerShell setup/launch scripts on a Windows runner, starts the real Universal Doctor dashboard on Windows and verifies its localhost API/token guard; it also starts the main YouTube automation dashboard in setup-required mode, and creates/probes a short H.264/AAC sample MP4. These are hosted-runner checks, not proof that setup has completed on your personal PC. The full upstream engine installation still requires downloading dependencies and configuring your own provider credentials.

Run the lightweight local checks from the repository root:
```powershell
python scripts/test-dashboard-launch.py
node scripts/test-main-dashboard-launch.js  # run after upstream engine npm ci
python agents/universal-doctor/doctor.py selftest
node scripts/test-openmontage-handoff.js
```
PowerShell syntax/configuration validation (Windows PowerShell 7 or compatible):
```powershell
./scripts/test-windows-setup.ps1
```
See [FINAL-WINDOWS-SETUP-ROMAN-URDU.md](FINAL-WINDOWS-SETUP-ROMAN-URDU.md) for the step-by-step guide.

## Integrated ZIP upgrades
- `agents/video-format-planner.js` creates a six-format video plan, hook/title options, shot list, chapters, SRT/ASS captions and audio-mix instructions.
- `agents/thumbnail-designer-agent.js` is the upgraded v6 thumbnail designer; `utils/logger.js` supplies its shared logger dependency.
- `agents/universal-doctor/` contains the standalone Python Doctor with diagnostic modes, backups, tests, rollback and a localhost dashboard. Keep it in diagnostic mode unless you explicitly approve repairs.
- Run `node scripts/plan-video.js "7 Signs You Are Being Gaslighted"` to create a plan. Run `node scripts/test-video-planner.js`, `node scripts/test-thumbnail-designer.js`, and `node scripts/test-quality-check.js` for add-on tests. Run `node scripts/quality-check.js --video uploads\\final.mp4 --captions uploads\\final.srt --thumbnail uploads\\thumbnail.jpg --seo uploads\\seo.json --mode long` before manual approval. Doctor: `python agents/universal-doctor/doctor.py selftest`.

## YouTube Automation workflow
The complete connected workflow, final MP4 quality gate and approval boundary are documented in [COMPLETE-AUTOMATION-WORKFLOW.md](COMPLETE-AUTOMATION-WORKFLOW.md) and [YOUTUBE-AUTOMATION-INTEGRATION.md](YOUTUBE-AUTOMATION-INTEGRATION.md). The upstream agent remains the only top-level orchestrator: research → script → thumbnail → SEO → production → human review/approval → publishing → analytics/learning. The Dark Phys planner supplements pre-production; it does not create a second pipeline or bypass review.

## OpenMontage production engine
OpenMontage is the optional advanced production workspace, connected through a handoff rather than a competing second YouTube orchestrator. See [OPENMONTAGE-INTEGRATION.md](OPENMONTAGE-INTEGRATION.md) for the 8–12 minute long-form workflow, five-Shorts workflow, runtime tradeoffs and test boundaries. After the standard clone, run `Set-ExecutionPolicy -Scope Process Bypass` then `./setup-openmontage.ps1` only when ready for the larger install. Export a long-form handoff with `node scripts/export-openmontage.js --title "Video title" --script uploads/approved-script.txt --mode long`, or Shorts from a rendered source with `node scripts/export-openmontage.js --title "Video title" --source-video uploads/final-video.mp4 --mode shorts`. OpenMontage stays optional and keeps its AGPL-3.0 license and notices intact.

## Safety and publishing
- Nothing is uploaded or published automatically by Dark Phys.
- Review factual claims, media rights, narration and final MP4 before approving.
- Publishing requires the user's explicit approval and valid Google OAuth credentials.
- Never commit API keys, OAuth tokens, `.env`, generated media or private channel data.

## Hardware note
For an older i7 / 8 GB RAM PC, start with the YouTube agent's local slideshow renderer and keep browser tabs closed during rendering. Advanced OpenMontage pipelines may be slow or require additional dependencies. AI provider usage may cost money; check pricing and set limits before enabling paid generation.

## Upstream licenses
- YouTube Automation Agent: MIT — https://github.com/darkzOGx/youtube-automation-agent
- OpenMontage: AGPL-3.0 — https://github.com/OpenMontageInc/OpenMontage

Each engine is cloned as its own upstream checkout. Keep its license and notices intact; do not remove attribution or imply that Dark Phys owns upstream code.


## Professional reliability and lightweight mode
The upstream single-controller orchestration already provides shared agent services, structured logs, job progress, persistent generation checkpoints, transient-error retries and resume support. Dark Phys adds a structural regression check and a conservative Windows launcher for lower-memory PCs. See [PROFESSIONAL-RELIABILITY-UPGRADES.md](PROFESSIONAL-RELIABILITY-UPGRADES.md). Use `start-dark-phys-lite.ps1` for the 2 GB Node heap profile; use the regular launcher for normal mode.
