'use strict';
const { PixabayFootageClient } = require('../agents/stock-footage/pixabay');
function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i]; else out._.push(argv[i]); }
  return out;
}
async function main() {
  const args = parse(process.argv.slice(2)), command = args._[0];
  if (!command || command === 'help') {
    console.log('Search:   node scripts/stock-footage.js search "emotional manipulation" [--per-page 10]');
    console.log('Download: node scripts/stock-footage.js download <asset-id> --query "body language"');
    process.exitCode = command ? 0 : 1; return;
  }
  const client = new PixabayFootageClient();
  if (command === 'search') {
    const result = await client.search(args._.slice(1).join(' '), { perPage: Number(args['per-page']) || 10 });
    if (result.status !== 'ok') { console.log(result.message); process.exitCode = 2; return; }
    console.log(JSON.stringify({ provider: result.provider, totalHits: result.totalHits, items: result.items.map(({ videoUrl, ...safe }) => safe) }, null, 2)); return;
  }
  if (command === 'download') {
    const id = Number(args._[1]);
    if (!Number.isInteger(id) || !args.query) throw new Error('Usage: download <asset-id> --query "the original search query"');
    const found = await client.search(args.query, { perPage: 20 });
    const item = found.items.find(x => x.id === id);
    if (!item) throw new Error('Asset ID was not present in the current query results. Search again and use a returned ID.');
    const saved = await client.download(item);
    console.log('Downloaded:', saved.path, '\nRights manifest:', saved.manifestPath, '\nReview current license restrictions before using this asset.'); return;
  }
  throw new Error('Unknown command: ' + command);
}
main().catch(error => { console.error('Stock footage error:', error.message); process.exitCode = 1; });
