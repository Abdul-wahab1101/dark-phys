# Phase 7 — Production Readiness & Reliability

## Purpose
Run a fast local preflight before starting a production session. This is a read-only diagnostic layer; it complements rather than replaces Universal Doctor and the upstream YouTube dashboard.

## Run it
```powershell
node scripts\phase7-readiness.js
node scripts\phase7-readiness.js --json
node scripts\test-phase7-readiness.js
```

## What it checks
- Node.js version, Git and Python availability.
- YouTube Automation Agent checkout and installed Node dependencies.
- FFmpeg on PATH or the upstream bundled `ffmpeg-static` dependency.
- Optional OpenMontage checkout.
- Available system RAM and project-drive free space.
- Presence (not values) of recognised provider/API credential variables in the process environment or upstream `.env`.

## Verdicts
- **GO** — no hard blockers were detected.
- **CAUTION** — no hard blocker, but review warnings such as a low-memory machine or missing optional engine.
- **BLOCK** — a required runtime or critical disk-space check failed; the command exits with code 2.

A GO verdict is not proof that a provider key works, a channel is OAuth-connected, a video is factually correct, or an upload will be approved. Those are deliberately reserved for final credential setup and real end-to-end testing.

## Safety guarantees
- No network requests and no provider/API calls.
- Never prints secret values; only reports how many recognised variable names are present.
- Does not create, delete or modify project files.
- Does not start generation, schedule uploads or publish.
- Does not run Universal Doctor repairs.

For an 8 GB RAM PC, use `start-dark-phys-lite.ps1`, process one video at a time and reserve enough disk space for source footage, proxies and final renders.
