'use strict';
const assert = require('node:assert/strict');
const { PixabayFootageClient, cleanQuery, normalizeHit, safeName } = require('../agents/stock-footage/pixabay');
async function run() {
  assert.equal(cleanQuery('  body\n language '), 'body language');
  assert.throws(() => cleanQuery('   '), /non-empty/);
  assert.equal(safeName('../../Gaslighting & Trust'), 'gaslighting-trust');
  assert.equal(normalizeHit({ id: 1, videos: {} }), null);
  const hit = normalizeHit({ id: 9, pageURL: 'https://pixabay.com/videos/example-9/', user: 'creator', tags: 'psychology, people', duration: 12, videos: { medium: { url: 'https://cdn.example/video.mp4', width: 1280, height: 720 } } });
  assert.equal(hit.id, 9); assert.equal(hit.width, 1280); assert.equal(hit.license, 'Pixabay Content License');
  const missing = await new PixabayFootageClient({ apiKey: '', fetch: async () => { throw new Error('must not call'); } }).search('psychology');
  assert.equal(missing.status, 'needs_api_key');
  let requested = '';
  const client = new PixabayFootageClient({ apiKey: 'test-key', fetch: async url => {
    requested = String(url);
    return { ok: true, json: async () => ({ totalHits: 1, hits: [{ id: 9, pageURL: 'https://pixabay.com/videos/example-9/', user: 'creator', tags: 'psychology', duration: 12, videos: { medium: { url: 'https://cdn.example/video.mp4', width: 1280, height: 720 } } }] }) };
  } });
  const result = await client.search('body language');
  assert.equal(result.items.length, 1); assert.match(requested, /safesearch=true/); assert.match(requested, /q=body\+language/);
}
run().then(() => console.log('PASS stock footage adapter tests')).catch(error => { console.error(error); process.exit(1); });
