# Dark Phys — YouTube Production Workspace

Dark Phys is the channel workspace for research, scripting, production, review and publishing. The project keeps the two upstream engines isolated instead of copying thousands of files or mixing incompatible runtimes.

## Engines
- **YouTube Automation Agent** (MIT): the single channel orchestrator for topic research, scripts, narration, visuals, video production, SEO, thumbnails, review, approval-gated publishing and analytics.
- **OpenMontage** (AGPL-3.0): optional advanced production engine with pipeline manifests, stage skills, checkpoints and multiple composition runtimes.
- **Dark Phys native assets**: `effects.py` and `keyframes.py` are retained as the lightweight FFmpeg effects/keyframe toolkit. The v6 Video Format Planner, upgraded thumbnail designer, and Universal Doctor Agent are integrated as separate modules.

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

## Integrated ZIP upgrades
- `agents/video-format-planner.js` creates a six-format video plan, hook/title options, shot list, chapters, SRT/ASS captions and audio-mix instructions.
- `agents/thumbnail-designer-agent.js` is the upgraded v6 thumbnail designer; `utils/logger.js` supplies its shared logger dependency.
- `agents/universal-doctor/` contains the standalone Python Doctor with diagnostic modes, backups, tests, rollback and a localhost dashboard. Keep it in diagnostic mode unless you explicitly approve repairs.
- Run `node scripts/plan-video.js "7 Signs You Are Being Gaslighted"` to create a plan. Run `node scripts/test-video-planner.js` and `node scripts/test-thumbnail-designer.js` for add-on tests. Doctor: `python agents/universal-doctor/doctor.py selftest`.

## YouTube Automation workflow
The complete connected workflow and its verification boundary are documented in [YOUTUBE-AUTOMATION-INTEGRATION.md](YOUTUBE-AUTOMATION-INTEGRATION.md). The upstream agent remains the only top-level orchestrator: research → script → thumbnail → SEO → production → human review/approval → publishing → analytics/learning. The Dark Phys planner supplements pre-production; it does not create a second pipeline or bypass review.

## OpenMontage
The setup script clones OpenMontage separately and preserves its upstream AGPL-3.0 license. It does not silently install its full Python/Remotion/HyperFrames stack because that is a large install for modest PCs. Follow its own `AGENT_GUIDE.md` and setup instructions when you choose to enable it.

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
