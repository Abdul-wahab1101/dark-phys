# Phase 5 — Automation, Publishing & Growth

## One-click production dashboard
Dark Phys retains the pinned YouTube Automation Agent as its only production/publishing orchestrator. Start it from the repository root with `./start-dark-phys.ps1` on Windows and open `http://localhost:3456`. Its Autonomous operator includes **Activate & run now**, persistent progress, pause/resume and resumable generation. Do not create a parallel scheduler or upload queue.

Run `node scripts/phase5-operator.js status` or `preflight` for read-only endpoint checks; `node scripts/phase5-operator.js open` opens the dashboard. Set `DARK_PHYS_URL` only when using a different local URL. This helper never starts generation or changes/publishes content.

## Channel-wise settings and OAuth
Use **Channel setup** and **Autonomous operator** to connect the intended YouTube account and configure its profile/strategy, audience, content pillars, cadence, KPI and boundaries. Configure the Google Desktop OAuth client locally, enable YouTube Data API v3 and YouTube Analytics API, and complete consent for the channel owner. Credentials and tokens remain local and must never be committed.

## Approval-gated publishing
Generated videos enter the content review queue. Review factual evidence, rights/provenance, narration, final MP4, thumbnail and metadata before approving. Approved content receives a private-by-default schedule entry; the upstream publishing queue runs every 15 minutes. The agent blocks simulated media, missing narration, failed readiness, unresolved provenance and uncertain upload outcomes. Reconcile uncertain uploads before retrying. No Phase 5 helper performs uploads.

## Automatic Shorts scheduling
In Review Studio, open **Shorts Repurposing Studio**, create three 9:16 draft candidates, choose a layout and render. Each Short retains source-scene provenance and has its own review, privacy and publish-time decision. Approve each Short to schedule it. The existing publishing scheduler handles due Shorts through the same publishing agent.

## Analytics, retention and CTR
The upstream analytics agent collects real YouTube Analytics evidence, including 24-hour and 7-day measurements. The dashboard exposes channel/video analytics, retention curves, scene-aware retention, watch time, impressions, CTR and outcome reports. Missing scopes or unavailable metrics must remain unavailable—not fabricated as zero. Enable YouTube Analytics API and reconnect OAuth if required.

## Thumbnail performance and next-video recommendations
Use Learning loop and Controlled Growth Experiments. Experiments require published videos and approved title/thumbnail variants. Plan approval and live start are separate confirmations. Bounded test windows, minimum impressions, statistical evidence and retention/traffic guardrails apply. The original packaging is restored before a winner decision; adopting a winner requires separate confirmation. Approved learning recommendations inform future channel strategy and are never silently applied.

## Universal Doctor, backups and recovery
Run `python agents/universal-doctor/doctor.py selftest` and `health`. Start in diagnostic mode; repairs require supervised approval. Universal Doctor provides backup, integrity checks, repair proposals, rollback and recovery history. Keep backups outside disposable build folders and periodically copy them to a second drive. Stop the app cleanly before copying its SQLite database. Generation checkpoints and resume support are provided by the upstream engine.

## Verification boundaries
CI tests the read-only companion against mocked HTTP responses and continues to run the pinned upstream regression suite. CI does not connect to the owner's Google account, upload a video, schedule a real Short, access private analytics or execute Doctor repairs. Live OAuth, channel configuration, publishing, Shorts scheduling and actual metrics require owner credentials and explicit approval on the local PC.
