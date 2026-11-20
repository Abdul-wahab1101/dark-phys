# Phase 4 — Packaging & Monetization Safety

## Direct Cloudflare Workers AI thumbnails
The Phase 4 thumbnail command calls Cloudflare Workers AI directly through the account REST API; no custom Worker deployment or workers.dev URL is required. GPT-OSS-20B creates three distinct art-direction prompts, FLUX.1 Schnell generates three image backgrounds, and Sharp composes readable title/channel overlays into 1280x720 JPGs. Human selection remains required; the tool never publishes automatically.

Set these values in the local channel workspace `.env` only: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_TEXT_MODEL=@cf/openai/gpt-oss-20b`, and `CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell`. The token needs Workers AI Read and Workers AI Write permissions. Never commit credentials. Run `node scripts/phase4-package.js thumbnails --title "Why People Manipulate You" --subtitle "Psychology Explained"`. Three JPGs and `concepts.json` are saved under `uploads/thumbnail-concepts`. Workers AI usage is subject to the account's current model pricing and limits.

## SEO titles, descriptions and chapters
The packaging module produces a primary SEO title, alternate title options, description, tags and a slug. It drafts chapter titles from supplied chapter beats/sections and generates approximate timestamps when actual timestamps are not supplied. Chapter timestamps must be checked against the final export; the validator requires at least three ascending chapters, a 00:00 first chapter, at least 10 seconds between chapters, and timestamps within the declared duration. Metadata remains a human-reviewed draft.

## Copyright and licensing ledger
Every media asset must have a unique ID and record kind, source, HTTPS source URL, creator, exact license name and HTTPS license URL, retrieval date/time, a proof path (existing local evidence file or HTTPS evidence URL), commercial-use verification, modifications, an explicit attribution-review decision, attribution requirements/text and a human `reviewStatus: approved` decision. Missing evidence blocks readiness. A downloadable or “royalty-free” label is not proof that every use is permitted; review the actual license, restrictions and model/property releases.

## Reused and inauthentic content checks
The advisory checker compares supplied narration/script text against prior scripts using five-word shingles and can flag high overlap. It can also flag repeated template IDs when recent template history is supplied. These are similarity signals, not YouTube decisions; a human must compare the finished video with the channel's back catalogue and assess meaningful original commentary, explanation, editing and viewer value. Copyright permission and monetization originality are separate questions.

## Community Guidelines and advertiser suitability
Automated phrase screening is advisory only and cannot decide policy compliance. Review full context across narration, captions, on-screen text, footage, title, description and thumbnail against the current YouTube Community Guidelines and advertiser-friendly content guidelines. A missing keyword flag does not mean a video is safe or monetizable.

## Final human approval gate
1. Create a starter package: `node scripts/phase4-package.js init --file uploads/phase4-package.json`.
2. Replace every example value; add a complete rights record for every third-party asset and save its proof file. Set `attributionReviewed: true` only after checking the license's attribution terms.
3. Import the Phase 3 Pixabay manifest and build metadata/advisory reports: `node scripts/phase4-package.js build --file uploads/phase4-package.json --manifest uploads/stock-footage/asset-manifest.json`. Imported records remain pending until you add license proof, verify commercial use, describe modifications and complete attribution review. For non-Pixabay assets, add the records manually.
4. Review preflight: `node scripts/phase4-package.js check --file uploads/phase4-package.json`.
5. Only after personally watching the final export and reviewing all rights, claims, originality, thumbnail, guidelines and ad suitability, run `node scripts/phase4-package.js approve --file uploads/phase4-package.json`. The CLI requires explicit typed confirmations for every human gate.
6. Verify the package: `node scripts/phase4-package.js verify --file uploads/phase4-package.json`.

Approval binds the package, final-video SHA-256 and reviewer confirmations. Editing the package, approval confirmations or final video invalidates the approval. It authorizes manual upload only; automated publishing remains disabled and still requires separate explicit user approval and OAuth.

## CI
Run `node scripts/test-phase4-packaging.js`, `node workers/thumbnail-worker/test/worker.test.mjs`, `node --check workers/thumbnail-worker/src/index.mjs`, and `node scripts/phase4-package.js`. CI does not deploy a public Worker or use Cloudflare secrets.
