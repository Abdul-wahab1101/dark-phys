# Dark Phys thumbnail Worker

This Cloudflare Worker returns three distinct 1280×720 SVG thumbnail concepts. It does not choose a winner, host finished videos, or publish to YouTube.

## Deploy (owner-controlled Cloudflare account)

1. From this directory, authenticate Wrangler to the Cloudflare account that will own the Worker.
2. Deploy the Worker: `npx wrangler deploy`.
3. Set a strong private token as a Worker secret: `npx wrangler secret put API_TOKEN`.
4. Confirm `GET https://<worker-host>/health` returns `{"ok":true,...}`.
5. Keep the Worker URL and token in the local Dark Phys environment only:
   - `CLOUDFLARE_THUMBNAIL_WORKER_URL=https://<worker-host>`
   - `CLOUDFLARE_THUMBNAIL_TOKEN=<same secret>`

Never commit the token or put it in a browser bundle. The endpoint requires HTTPS and a Bearer token. Requests are capped at 4 KiB, titles are constrained to four readable lines, and responses are not cached. Cloudflare account access and secret provisioning are owner actions; CI deliberately does not deploy a public Worker.

## Use from Dark Phys

```powershell
node scripts/phase4-package.js thumbnails --title "Why Memory Can Mislead You" --subtitle "Psychology Explained"
```

The CLI writes the three concepts to `uploads/thumbnail-concepts` and rasterizes each SVG to PNG using the project's existing Sharp dependency. Inspect the concepts, choose one yourself, and check its claims, image rights, readability, and advertiser suitability before use.

## Test

```powershell
node workers/thumbnail-worker/test/worker.test.mjs
```

The test covers health, missing secrets, authorization, malformed and oversized requests, input validation, SVG escaping, headline fit, and the three concept directions.
