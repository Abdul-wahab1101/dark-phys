# Dark Phys — YouTube Production Workspace

Dark Phys is the channel workspace for research, scripting, production, review and publishing. The project keeps the two upstream engines isolated instead of copying thousands of files or mixing incompatible runtimes.

## Engines
- **YouTube Automation Agent** (MIT): channel strategy, scripts, narration, thumbnails, SEO, local slideshow production, review dashboard and approval-gated publishing.
- **OpenMontage** (AGPL-3.0): optional advanced production engine with pipeline manifests, stage skills, checkpoints and multiple composition runtimes.
- **Dark Phys native assets**: `effects.py` and `keyframes.py` are retained as the lightweight FFmpeg effects/keyframe toolkit. The v6 Video Format Planner, upgraded thumbnail designer, and Universal Doctor Agent are integrated as separate modules. Original ZIPs and an extraction audit copy are retained for traceability.

## Windows quick setup
1. Install Git, Node.js 20 LTS (18.17+ minimum for the YouTube agent), Python 3.10+, and FFmpeg.
2. Open PowerShell in this repository.
3. Run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup-dark-phys.ps1
   ```
4. Add at least one text-provider API key in `engines\youtube-automation-agent\.env`. Gemini may have a free tier; provider limits and terms apply.
5. Add YouTube OAuth Desktop credentials at `engines\youtube-automation-agent\config\credentials.json` only if you want to connect/publish to your channel.
6. Run `.start-dark-phys.ps1` and open http://localhost:3456.

## Integrated ZIP upgrades
- `agents/video-format-planner.js` creates a six-format long-form plan, hook/title options, shot list, chapters, SRT/ASS captions and audio-mix instructions.
- `thumbnail-designer-agent (1).js` is upgraded from the v6 ZIP; `utils/logger.js` supplies its missing logger dependency.
- `agents/universal-doctor/` contains the standalone Python Doctor with diagnostic/supervised/autonomous modes, backups, tests, rollback and a localhost dashboard. Keep it in diagnostic mode unless you explicitly approve repairs.
- Run `node scripts/plan-video.js "7 Signs You Are Being Gaslighted"` to create a plan. Run `node scripts/test-video-planner.js` for planner tests. Doctor: `python agents/universal-doctor/doctor.py selftest`.

## OpenMontage
The setup script clones OpenMontage separately and preserves its upstream AGPL-3.0 license. It does not silently install its full Python/Remotion/HyperFrames stack because that is a large install for modest PCs. Follow its own `AGENT_GUIDE.md` and setup instructions when you choose to enable it. If both Remotion and HyperFrames are available, OpenMontage requires the user to be shown both render options and asked to choose.

## Safety and publishing
- Nothing is uploaded or published automatically by this workspace.
- Review factual claims, media rights, narration and final MP4 before approving.
- Publishing requires the user's explicit approval and valid Google OAuth credentials.
- Never commit API keys, OAuth tokens, `.env`, generated media or private channel data.

## Hardware note
For an older i7 / 8 GB RAM PC, start with the YouTube agent's local slideshow renderer and keep browser tabs closed during rendering. Advanced OpenMontage pipelines may be slow or require additional dependencies. AI provider usage may cost money; do not enable paid video generation without checking pricing and setting limits.

## Upstream licenses
- YouTube Automation Agent: MIT — https://github.com/darkzOGx/youtube-automation-agent
- OpenMontage: AGPL-3.0 — https://github.com/OpenMontageInc/OpenMontage

Each engine is cloned as its own upstream checkout. Keep its license and notices intact; do not remove attribution or imply that Dark Phys owns upstream code.
