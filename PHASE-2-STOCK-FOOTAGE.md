# Phase 2 — Real stock-footage pipeline foundation

## Delivered in this slice
- Pixabay Video API adapter with query sanitization, safe search, bounded result count and provider response validation.
- Search is metadata-only. It does not download files until the explicit download command is used.
- Downloads have a configurable maximum size (80 MiB default), unique filenames, and a local asset-manifest.json.
- Manifest records provider, asset ID, creator, source page, dimensions, duration, tags, retrieval timestamp and license review reminder.
- API key is read from PIXABAY_API_KEY in the local process environment. Never commit it or print it in logs.
- Offline tests mock the provider; CI does not use a live API key or claim live endpoint availability.

## Windows usage
Set the key only in the current PowerShell session for a first test:
$env:PIXABAY_API_KEY = "YOUR_PIXABAY_KEY"
node scripts/stock-footage.js search "psychological manipulation"
node scripts/stock-footage.js download 123456 --query "psychological manipulation"
Downloaded clips and asset-manifest.json are stored under uploads/stock-footage/. Search output omits direct CDN download URLs. The download command re-runs the search and only accepts an ID returned for that query.

## Rights and safety
Pixabay API results are not blanket clearance for every possible use. Check the current Pixabay Content License and restrictions for each selected asset, including recognizable people, trademarks, logos, property, sensitive contexts and any editorial-only restrictions. Keep the source page and creator in the local manifest. The manifest is a review aid, not legal advice or proof of a model/property release.

## Current boundaries
- This adapter is a first stock source, not a full automatic scene editor.
- Scene-to-query mapping and asset selection still require human review; do not automatically use the first search result.
- Pexels and other sources are not integrated in this slice.
- Full 8–12 minute assembly from a complete shot list is a later step; current CI only tests the adapter with controlled fake responses.
