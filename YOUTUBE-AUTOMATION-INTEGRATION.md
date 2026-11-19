# YouTube Automation workflow integration

Dark Phys uses the upstream YouTube Automation Agent as the single channel orchestrator. It is cloned into `engines/youtube-automation-agent` and is not copied into a second competing implementation.

## Connected production path

The upstream `index.js` initializes and coordinates these existing agents:

1. **Topic research and strategy** — `ContentStrategyAgent` researches YouTube trends, competitor channels (when configured), channel history and content strategy.
2. **Script** — `ScriptWriterAgent.generateScript(strategy)` produces the narration-ready script and claim/source metadata.
3. **Thumbnail** — `ThumbnailDesignerAgent.generateThumbnail(script)` creates thumbnail variants.
4. **SEO** — `SEOOptimizerAgent.optimize(script, strategy)` creates title, description, tags, hashtags and chapters.
5. **Production** — `ProductionManagementAgent.processContent(...)` creates narration, captions and final video assets.
6. **Review and approval** — the dashboard review flow and publishing guard require approved content; simulated/placeholder outputs are blocked.
7. **Publishing** — `PublishingSchedulingAgent` schedules and uploads through YouTube OAuth only after approval.
8. **Analytics** — `AnalyticsOptimizationAgent` reads YouTube Analytics and feeds performance learning back into future strategy.

The upstream scheduler also runs content generation, publish-queue processing, daily analytics and weekly strategy review. Dark Phys keeps this as the only top-level orchestration path to avoid duplicate queues or duplicate agent instances.

## Dark Phys v6 add-ons

The ZIP Video Format Planner remains a pre-production planning add-on. Run:

```powershell
node scripts/plan-video.js "7 Signs You Are Being Gaslighted"
node scripts/test-video-planner.js
node scripts/test-thumbnail-designer.js
```

It writes a format/shot/caption/music plan under `uploads/video-plans/<slug>/`. It does not replace upstream research, script, SEO, thumbnail, production or review agents, and it does not silently bypass the review gate.

## Verification

GitHub Actions workflow `.github/workflows/validate-youtube-agent.yml` checks out a pinned upstream commit, installs its locked dependencies and FFmpeg, runs the upstream `npm test` regression suite, then tests the Dark Phys format planner and thumbnail designer. The ZIP Doctor checks remain in `.github/workflows/validate-upgrades.yml`.

CI uses no user API keys or YouTube OAuth. Therefore it verifies offline/system behavior, not live trend data, provider-generated scripts/images, a real channel upload or live analytics. Those capabilities become available after the owner configures credentials on their own PC. Publishing remains explicitly approval-gated.
