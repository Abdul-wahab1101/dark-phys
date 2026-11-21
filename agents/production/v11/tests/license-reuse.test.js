'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { LicenseLedger } = require('../src/core/license-ledger');
const { assessReuse } = require('../src/core/reuse-risk');
const { MemoryStore, JsonlStore } = require('../src/infra/jsonl-store');
const { hashFile } = require('../src/infra/file-utils');
const h = require('./helpers');

const pix = (id, extra = {}) => ({ assetId: id, kind: 'video', source: 'pixabay', sourceUrl: 'https://pixabay.com/videos/' + id, author: 'Alice', licenseId: 'pixabay-content-license', ...extra });

test('register validates input and unknown licences are downgraded', () => {
  const l = new LicenseLedger(new MemoryStore());
  assert.throws(() => l.register({ kind: 'video' }), /assetId/);
  assert.equal(l.register(pix('a', { licenseId: 'made-up' })).licenseId, 'unknown');
});

test('audit blocks unregistered, unknown-licence and non-commercial assets', () => {
  const l = new LicenseLedger(new MemoryStore());
  l.register(pix('ok'));
  l.register(pix('nc', { licenseId: 'cc-by-nc-4.0' }));
  l.register(pix('unk', { licenseId: 'unknown' }));
  l.setUsage('v1', [{ assetId: 'ok', secondsUsed: 5, uses: 1 }, { assetId: 'nc', secondsUsed: 5, uses: 1 }, { assetId: 'unk', secondsUsed: 5, uses: 1 }, { assetId: 'ghost', secondsUsed: 2, uses: 1 }]);
  const r = l.auditVideo('v1', { description: 'x' });
  const ids = r.findings.map(f => f.id);
  assert.equal(r.level, 'block');
  for (const want of ['non_commercial_license', 'unknown_license', 'asset_not_in_ledger']) assert.ok(ids.includes(want), want);
  assert.equal(r.findings.filter(f => f.assetId === 'ok').length, 0);
});

test('attribution licences need a credit in the description', () => {
  const l = new LicenseLedger(new MemoryStore());
  l.register(pix('by', { licenseId: 'cc-by-4.0', author: 'Bob Stone' }));
  l.setUsage('v', [{ assetId: 'by', secondsUsed: 4, uses: 1 }]);
  assert.ok(l.auditVideo('v', { description: 'nothing' }).findings.some(f => f.id === 'attribution_missing_in_description'));
  assert.equal(l.auditVideo('v', { description: 'Footage by Bob Stone' }).level, 'ok');
  assert.equal(l.attributionText('v').length, 1);
});

test('setUsage is idempotent and hash changes are noticed', () => {
  const l = new LicenseLedger(new MemoryStore());
  l.register(pix('a', { sha256: 'aaa' }));
  l.setUsage('v', [{ assetId: 'a', secondsUsed: 5, uses: 1 }]);
  l.setUsage('v', [{ assetId: 'a', secondsUsed: 5, uses: 1 }]);
  assert.equal(l.usageForVideo('v')[0].secondsUsed, 5);
  assert.ok(l.auditVideo('v', { hashOf: () => 'bbb' }).findings.some(f => f.id === 'file_changed_since_registered'));
});

test('ai assets: disclosure decision is surfaced', () => {
  const l = new LicenseLedger(new MemoryStore());
  l.register({ assetId: 'img', kind: 'ai-image', source: 'flux', licenseId: 'ai-generated', sourceUrl: 'x' });
  l.setUsage('v', [{ assetId: 'img', secondsUsed: 3, uses: 1 }]);
  assert.ok(l.auditVideo('v', { realisticAiDisclosed: false }).findings.some(f => f.id === 'ai_asset_without_disclosure_decision'));
});

test('JSONL store survives a torn last line and persists', async () => {
  const dir = h.tmp();
  try {
    const f = path.join(dir, 'l.jsonl');
    const a = new LicenseLedger(new JsonlStore(f)); a.register(pix('p'));
    require('fs').appendFileSync(f, '{"type":"asset","assetId":"tor');
    const b = new LicenseLedger(new JsonlStore(f));
    assert.ok(b.records().assets.has('p'));
    const x = path.join(dir, 'x.bin'); require('fs').writeFileSync(x, 'hello');
    assert.equal((await hashFile(x)).length, 64);
  } finally { h.rm(dir); }
});

test('reuse: footage reused across videos, clip dominance, script and hook repetition', () => {
  const hist = [1, 2, 3].map(i => ({ videoId: 'old' + i, assets: [{ assetId: 'a' }, { assetId: 'b' }], scriptText: 'completely different words about topic number ' + i + ' and other things here today friends', hookText: 'Your brain is lying to you ' + i }));
  const r = assessReuse({ videoId: 'new', durationSec: 60, assets: [{ assetId: 'a', secondsUsed: 30, uses: 5 }, { assetId: 'b', secondsUsed: 20, uses: 1 }, { assetId: 'c', secondsUsed: 10, uses: 1 }], history: hist, script: 'x', hookText: 'Your brain is lying to everyone' });
  const ids = r.findings.map(f => f.id);
  assert.equal(r.level, 'block');
  assert.ok(ids.includes('footage_mostly_reused_from_other_videos'));
  assert.ok(ids.includes('one_clip_dominates'));
  assert.ok(ids.includes('clip_repeated_in_video'));
  assert.ok(ids.includes('same_hook_opening_repeated'));
  assert.ok(ids.includes('few_unique_clips'));
});

test('reuse: near-identical scripts block, fresh content passes', () => {
  const text = 'the quick brown fox jumps over the lazy dog while the narrator explains how people behave under pressure in groups';
  const bad = assessReuse({ videoId: 'n', durationSec: 24, assets: [{ assetId: 'z1', secondsUsed: 12 }, { assetId: 'z2', secondsUsed: 12 }], history: [{ videoId: 'o', assets: [], scriptText: text, hookText: '' }], script: text });
  assert.equal(bad.level, 'block');
  const good = assessReuse({ videoId: 'n', durationSec: 24, assets: [{ assetId: 'z1', secondsUsed: 12 }, { assetId: 'z2', secondsUsed: 12 }], history: [{ videoId: 'o', assets: [], scriptText: text, hookText: '' }], script: 'a totally unrelated story about sleep habits memory and morning routines for busy students' });
  assert.equal(good.level, 'ok', JSON.stringify(good.findings));
});
