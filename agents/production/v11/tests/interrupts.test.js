'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { planPatternInterrupts, validateInterruptPlan, buildInterruptFilter } = require('../src/core/interrupts');
const { FfmpegRunner } = require('../src/infra/ffmpeg-runner');
const h = require('./helpers');

test('plan is dense in the hook, deterministic and valid', () => {
  const a = planPatternInterrupts({ durationSec: 60, seed: 'v1' });
  const b = planPatternInterrupts({ durationSec: 60, seed: 'v1' });
  assert.deepEqual(a, b);
  assert.ok(a.stats.hookCount >= 3, 'hook count ' + a.stats.hookCount);
  assert.ok(a.interrupts[0].t < 4);
  assert.ok(a.interrupts.every(i => i.t < 57));
  const v = validateInterruptPlan(a, { durationSec: 60 });
  assert.equal(v.ok, true, v.issues.join(','));
});

test('no type repeats back to back and different seeds differ', () => {
  const a = planPatternInterrupts({ durationSec: 90, seed: 'a' });
  for (let i = 1; i < a.interrupts.length; i++) assert.notEqual(a.interrupts[i].type, a.interrupts[i - 1].type);
  const b = planPatternInterrupts({ durationSec: 90, seed: 'b' });
  assert.notDeepEqual(a.interrupts.map(i => i.t), b.interrupts.map(i => i.t));
});

test('snaps to sentence starts when close', () => {
  const p = planPatternInterrupts({ durationSec: 40, seed: 's', segments: [{ start: 3.0, end: 6, text: 'x' }, { start: 9.1, end: 12, text: 'y' }] });
  assert.ok(p.interrupts.some(i => i.t === 3.0 || i.t === 9.1));
});

test('validator catches static stretches', () => {
  const v = validateInterruptPlan({ interrupts: [{ t: 2, type: 'sfx-hit', durationSec: .1 }] }, { durationSec: 60 });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(x => x.startsWith('static_stretch')));
});

test('filter graph is a valid ffmpeg graph and renders', async () => {
  const dir = h.tmp();
  try {
    const clip = path.join(dir, 'in.mp4'); h.makeClip(clip, { seconds: 5, size: '360x640' });
    const filter = buildInterruptFilter([{ t: 0.5, type: 'cut-zoom', durationSec: 1 }, { t: 2, type: 'color-flash', durationSec: 0.2 }, { t: 3, type: 'cut-zoom', durationSec: 1 }], { width: 360, height: 640 });
    const runner = new FfmpegRunner();
    const out = path.join(dir, 'out.mp4');
    await runner.run(['-i', clip, '-filter_complex', filter, '-map', '[vi]', '-c:v', 'libx264', out]);
    const info = await runner.probe(out);
    assert.equal(info.width, 360); assert.equal(info.height, 640);
    assert.ok(Math.abs(info.duration - 5) < 0.3);
  } finally { h.rm(dir); }
});

test('very short videos are not penalised for a hook window they do not have', () => {
  const p = planPatternInterrupts({ durationSec: 9, seed: 'short' });
  assert.equal(validateInterruptPlan(p, { durationSec: 9 }).ok, true);
});

test('empty interrupt list gives a pass-through graph', () => {
  assert.equal(buildInterruptFilter([]), '[0:v]null[vi]');
});
