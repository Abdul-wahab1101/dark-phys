# Dark Phys integration status

## Added on integration branch
- Windows PowerShell setup and launcher for a single YouTube Automation Agent runtime.
- OpenMontage cloned as a separate optional production engine, preserving its AGPL-3.0 source and license boundary.
- Project setup, hardware, API-key, OAuth and publishing-safety documentation.
- Secret/dependency/generated-media ignore rules.

## Why engines are separate
The YouTube agent is a Node.js application (Node >=18.17) with a local dashboard, SQLite state, Playwright/Chromium and FFmpeg-based slideshow rendering. OpenMontage is a separate instruction-driven Python production system (Python >=3.10) with optional Remotion and HyperFrames runtimes. Combining their internal orchestration would duplicate pipeline ownership and make the install much heavier. Dark Phys therefore uses the YouTube agent as the channel operator and OpenMontage as an opt-in advanced production workspace.

## Not yet verified / not claimed complete
- ZIP upgrade package extraction and tests.
- Thumbnail agent's missing logger dependency and compatibility repair.
- Full OpenMontage dependency installation/render smoke test.
- Live provider API credentials, Google OAuth and real YouTube upload.
- Windows execution on the owner's machine.

Do not mark the project production-ready until these checks pass. No credentials are stored in this repository.
