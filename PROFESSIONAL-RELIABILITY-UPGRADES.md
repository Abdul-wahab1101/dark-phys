# Dark Phys — Professional reliability upgrades

## One controller, no duplicate agent stack
The pinned upstream YouTube Automation Agent remains the only top-level controller. Its index.js constructs one instance each of strategy, script, thumbnail, SEO, production, publishing and analytics agents and passes them into the scheduler/operator. Dark Phys does not create a parallel scheduler, duplicate render queue or second publishing implementation. The separate Video Format Planner is pre-production planning only; Universal Doctor is an opt-in maintenance tool, not a production agent.

## Agent communication
The controller passes shared database/credential services to agents and invokes their defined methods in sequence. The Autonomous Channel Operator delegates research/plan, generation, wait/resume and notification through injected callbacks. Production Management writes stage/progress changes; the shared Winston logger supplies scoped logs. This is coordinated orchestration, not uncontrolled parallel agents.

## Errors, recovery and resumability
The upstream GenerationRecoveryService persists checkpoints for strategy, script, thumbnail, SEO, production and quality review. It validates saved artifacts before reuse, retries recognized transient failures with bounded exponential backoff, records failed/cancelled states and calculates a resume point. The database marks interrupted jobs at startup; the operator can resume failed/interrupted runs and generation jobs. A missing/invalid artifact invalidates downstream checkpoints so stale outputs are not reused.

## Progress and logs
Dashboard/job records expose stage and percentage progress. Scoped logs use the shared logger; production, operator and API errors are logged. Keep the dashboard on localhost and never publish logs containing credentials or private data.

## Duplicate work controls
One orchestrator and one scheduler are retained. Generation checkpoints reuse validated completed artifacts. Topic duplicate checks are part of upstream operator quality review (90-day exact-topic window). Interrupted jobs are recovered rather than blindly duplicated.

## Low-spec Windows profile
For an 8 GB RAM PC, use start-dark-phys-lite.ps1. This launcher caps Node heap at 2 GB, limits common thread pools to two threads, and attempts BelowNormal process priority. It does not change the normal launcher. For rendering, process one video at a time, use 720p preview/proxy assets, close unused browser tabs and reserve 1080p final render for when the machine is idle. Actual speed depends on codecs, effects and provider workload.

## Verification
Run node scripts/test-agent-coordination.js. GitHub Actions checks the pinned upstream controller wiring, recovery service, checkpoint database, progress reporting and shared logger. This is a structural regression check; live provider outages, crash recovery on the owner's Windows PC and actual render throughput still require local testing.

## Safety boundaries
- Publishing remains approval-gated; recovery must never auto-publish.
- Universal Doctor remains separate and approval-controlled.
- Never auto-retry non-transient errors, invalid user input or failed safety/quality checks.
- Never commit API keys, OAuth tokens or .env files.
