# Phase 4 — Packaging & Monetization Safety

## Thumbnail concepts (Cloudflare Worker)
The Worker at `workers/thumbnail-worker` exposes `GET /health` and authenticated `POST /v1/concepts`. It returns three distinct 1280×720 SVG concept drafts (cinematic, editorial, bold contrast); the CLI rasterizes them to PNG with the existing Sharp dependency for YouTube-ready files. It does not publish or silently select a winner. Deploy from that directory with Cloudflare Wrangler after creating a Worker and setting `API_TOKEN` as a Worker secret (the endpoint fails closed with HTTP 503 until configured). Keep the token out of Git. Local generation and the existing thumbnail designer remain available if the Worker is not deployed.

Example request body: `{"title":"Why Memory Can Mislead You","subtitle":"Psychology Explained"}`.

## SEO and chapters
The packaging module builds a title, description, tags, slug and chapter list. Chapter checks require at least three ascending timestamps, a 00:00 first chapter, unique timestamps and times within the declared video duration. Metadata is a draft; a human must check accuracy and avoid misleading promises.

## Copyright and licensing ledger
Every media asset should record source, source URL, creator, license name and URL, retrieval time, proof path, commercial-use verification, modifications, required attribution and a human `reviewStatus: approved` decision. Missing evidence blocks approval. A source being downloadable or labelled royalty-free is not proof that every use is permitted; review the actual license and any model/property releases.

## Reused / inauthentic content
The checks are explicit human-review gates, not a claim that a keyword model can determine monetization eligibility. Review whether the video adds substantial original commentary, explanation, editing and value; avoid repetitive, mass-produced, minimally varied templates. Copyright permission and monetization originality are separate questions.

## Community Guidelines and advertiser suitability
Automated phrase screening is advisory only and cannot decide policy compliance. Review full context, spoken narration, on-screen text, footage, title, description and thumbnail against the current YouTube Community Guidelines and advertiser-friendly content guidelines. Do not rely on the automated flags as a safe-harbor decision.

## Human approval gate
Run `node scripts/phase4-package.js build --file uploads/phase4-package.json`, fill all asset rights evidence and final video/SEO/chapter fields, mark each fully reviewed asset `reviewStatus: approved`, then `check`. Run `approve` only after a person has watched the final export and reviewed rights, claims, originality, thumbnail, guidelines and ad suitability. Approval is bound to a hash of the package; any change invalidates it. This gate authorizes manual upload only. Automated publishing remains disabled and must continue to require separate explicit user approval and OAuth.

## CI
Run `node scripts/test-phase4-packaging.js` and `node --check workers/thumbnail-worker/src/index.js`. CI tests the Worker source and packaging safety logic without deploying a public Worker or using secrets.
