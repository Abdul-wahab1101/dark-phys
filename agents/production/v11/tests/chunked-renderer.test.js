'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FfmpegRunner } = require('../src/infra/ffmpeg-runner');
const { ChunkedRenderer } = require('../src/app/chunked-renderer');
const { planShots, shotArgs } = require('../src/app/shot-planner');
const h = require('./helpers');

test('planShots cycles all clips first, covers the whole duration and tallies usage', () => {
  const clips = [1, 2, 3].map(i => ({ assetId: 'c' + i, path: 'c' + i + '.mp4', duration: 6 }));
  const p = planShots({ clips, totalSec: 20, seed: 's' });
  assert.deepEqual(p.shots.slice(0, 3).map(s => s.assetId), ['c1', 'c2', 'c3']);
  assert.ok(Math.abs(p.shots.reduce((n, s) => n + s.dur, 0) - 20) < 0.1);
  assert.ok(p.shots.every(s => s.dur >= 1));
  assert.ok(Math.abs(p.usage.reduce((n, u) => n + u.secondsUsed, 0) - 20) < 0.1);
  assert.throws(() => planShots({ clips: [], totalSec: 5 }));
});

function chunkSpecs(dir, n) {
  const clip = path.join(dir, 'src.mp4'); h.makeClip(clip, { seconds: 4, size: '320x180' });
  return Array.from({ length: n }, (_, i) => ({ id: 'c' + i, durationSec: 1.5, args: shotArgs({ ss: i * 0.3, dur: 1.5, source: clip }, { width: 320, height: 180, fps: 25 }) }));
}

test('mid-render failure: finished chunks are reused on the next run', async () => {
  const dir = h.tmp();
  try {
    const chunks = chunkSpecs(dir, 5);
    const real = new FfmpegRunner();
    const flaky = Object.create(real);
    flaky.run = (args, opts) => { if (opts && opts.label === 'render c3') return Promise.reject(new Error('simulated crash')); return real.run(args, opts); };
    const work = path.join(dir, 'work'), out = path.join(dir, 'out.mp4');
    await assert.rejects(new ChunkedRenderer(flaky).render({ dir: work, chunks, outPath: out }), /simulated crash/);
    assert.equal(fs.existsSync(out), false);
    assert.ok(fs.existsSync(path.join(work, 'c2.mp4')));

    const res = await new ChunkedRenderer(real).render({ dir: work, chunks, outPath: out });
    assert.equal(res.resumed, 3); assert.equal(res.rendered, 2);
    assert.ok(Math.abs(res.durationSec - 7.5) < 0.4);
    assert.equal(fs.readdirSync(work).some(n => n.includes('.part')), false, 'no partial files left');
  } finally { h.rm(dir); }
});

test('a truncated or corrupt chunk is detected and rendered again', async () => {
  const dir = h.tmp();
  try {
    const chunks = chunkSpecs(dir, 3);
    const runner = new FfmpegRunner();
    const work = path.join(dir, 'work'), out = path.join(dir, 'out.mp4');
    await new ChunkedRenderer(runner).render({ dir: work, chunks, outPath: out });
    fs.writeFileSync(path.join(work, 'c1.mp4'), Buffer.alloc(100, 1));
    fs.unlinkSync(out);
    const res = await new ChunkedRenderer(runner).render({ dir: work, chunks, outPath: out });
    assert.equal(res.rendered, 1); assert.equal(res.resumed, 2);
  } finally { h.rm(dir); }
});

test('ffmpeg hang: stall detector kills ffmpeg and reports it', async () => {
  const dir = h.tmp();
  try {
    const fakeFfmpeg = path.join(dir, 'hang.js');
    fs.writeFileSync(fakeFfmpeg, '#!/usr/bin/env node\nsetInterval(()=>{},1000);\n', { mode: 0o755 });
    const runner = new FfmpegRunner({ ffmpeg: fakeFfmpeg, defaultStallMs: 400, defaultTimeoutMs: 8000 });
    runner.supervisor.graceMs = 200;
    await assert.rejects(runner.run(['-i', 'x']), e => e.name === 'FfmpegError' && /hung/.test(e.message) && e.transient === true);
    assert.deepEqual(runner.supervisor.active(), []);
  } finally { h.rm(dir); }
});
