# OpenMontage integration — Dark Phys

## Architecture and handoff

Dark Phys keeps the YouTube Automation Agent as the channel operator and OpenMontage as the optional production/render workspace. They are not merged into one codebase: OpenMontage is an agent-first system (pipeline YAML + stage-director skills + registered Python tools), not a conventional video-rendering CLI. The bridge exports an explicit handoff folder so the OpenMontage-capable coding agent can execute the selected pipeline and return deliverables for Dark Phys review.

Pinned upstream snapshot used for compatibility checks: `OpenMontageInc/OpenMontage@2e003e65fa99a0f329478a2c1cdcf26bc481933a`. Keep the upstream AGPL-3.0 license and notices intact.

## Windows setup (optional; not part of the lightweight YouTube setup)

1. Run `.` setup-dark-phys.ps1 if the engines have not been cloned.
2. Run `.` setup-openmontage.ps1 to install OpenMontage Python requirements and Remotion composer dependencies. This is a large optional install; close other apps on the older 8 GB machine.
3. Confirm `ffmpeg -version` works.
4. List zero-key Remotion demos:
   ```powershell
   & .\engines\OpenMontage\.venv\Scripts\python.exe .\engines\OpenMontage\render_demo.py --list
   ```
5. Smoke-render a small Remotion demo:
   ```powershell
   & .\engines\OpenMontage\.venv\Scripts\python.exe .\engines\OpenMontage\render_demo.py world-in-numbers
   ```

## Long-form Dark Phys videos (8–12 minutes)

1. Finish topic research, script, SEO and thumbnail in the YouTube Agent.
2. Save the approved narration script as UTF-8 text, e.g. `uploads\approved-script.txt`.
3. Export the handoff:
   ```powershell
   node scripts\export-openmontage.js --title "Why People Manipulate You" --script uploads\approved-script.txt --mode long
   ```
4. Open `engines\OpenMontage\dark-phys-handoff\why-people-manipulate-you\OPENMONTAGE-PROMPT.md` with an OpenMontage-capable coding agent. It must follow `AGENT_GUIDE.md`, use the `animated-explainer` pipeline, read each required stage skill, research claims, show provider/runtime choices and cost, render a 10–15 second sample, and wait for approval before full production.
5. Target 10:00, acceptable 8:00–12:00, 16:9 1920x1080 at 30 fps. Include narration, balanced music, readable captions, varied b-roll/graphics, chapter markers and end screen.
6. Copy final MP4, SRT, thumbnail stills, render report and media/license manifest back into the handoff folder. Review inside Dark Phys before upload.

## Shorts workflow

Use the final approved long-form MP4 as source:
```powershell
node scripts\export-openmontage.js --title "Why People Manipulate You" --source-video uploads\final-video.mp4 --mode shorts
```
Open the generated `OPENMONTAGE-PROMPT.md` with the OpenMontage-capable agent. It selects the `clip-factory` pipeline and requests five independent 20–60 second vertical clips, 9:16 1080x1920, clean sentence boundaries, strong 1–3 second hooks, readable captions, normalized speech audio, individual MP4/SRT files and per-clip metadata. Approve clip selection and final review before returning them to Dark Phys.

## Rendering choices and tradeoffs

OpenMontage's `video_compose` tool supports three render engines. Its Agent Guide requires presenting all installed runtimes before locking the choice; never silently switch engines.

| Runtime | Best use | Tradeoff |
|---|---|---|
| FFmpeg | Lowest overhead; simple cuts, concat, overlays, subtitles, encode | Less flexible for elaborate motion-graphics scenes |
| Remotion | React-based, frame-accurate compositions, charts, typography and scene components | Node/Chromium and memory intensive |
| HyperFrames | HTML/CSS/GSAP kinetic typography, bespoke web-like compositions | Separate runtime setup and project authoring; not assumed installed |

For this PC, start with FFmpeg for basic assembly and Remotion only when motion graphics justify the extra memory. HyperFrames stays optional until its runtime doctor passes. If more than one runtime is installed, the OpenMontage agent must show both options, their tradeoffs and recommendation, then wait for explicit approval.

## Tests and honest verification boundary

- `node scripts/test-openmontage-handoff.js` validates both handoff profiles and required-input guards.
- `validate-openmontage.yml` checks bridge behavior and runs OpenMontage's real FFmpeg vertical-compose tests against its pinned upstream snapshot.
- Remotion render smoke test runs separately on Windows with `render_demo.py world-in-numbers`.
- HyperFrames is reported unavailable unless its own runtime checks pass.

CI cannot use the user's API keys, generate paid provider assets, access their YouTube channel, or validate a full 8–12 minute final film. Real long-form/Shorts end-to-end output remains pending until the local setup and credentials/provider choices are available. No publishing is triggered by this bridge.

## License

OpenMontage is AGPL-3.0. Keep its source checkout, license and notices separate and intact.
