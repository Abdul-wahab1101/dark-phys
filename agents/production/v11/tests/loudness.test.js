'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const L = require('../src/core/loudness');
const { FfmpegRunner } = require('../src/infra/ffmpeg-runner');
const { AudioService } = require('../src/app/audio-service');
const h = require('./helpers');

test('parsers read ffmpeg output', () => {
  const j = L.parseLoudnormJson('noise\n{\n "input_i" : "-23.50",\n "input_tp" : "-4.1",\n "input_lra" : "3.2",\n "input_thresh" : "-33.6",\n "target_offset" : "0.5"\n}\n');
  assert.equal(j.input_i, -23.5);
  const e = L.parseEbur128('Summary:\n  Integrated loudness:\n    I:         -14.2 LUFS\n  Loudness range:\n    LRA:         6.1 LU\n  True peak:\n    Peak:       -1.6 dBFS');
  assert.deepEqual(e, { integrated: -14.2, lra: 6.1, truePeak: -1.6 });
  assert.throws(() => L.parseLoudnormJson('nothing'), L.LoudnessError);
});

test('silent audio cannot be normalised', () => {
  assert.throws(() => L.buildNormalizeFilter({ input_i: -Infinity, input_tp: -Infinity, input_thresh: -70 }), L.LoudnessError);
});

test('assessment and cross-video consistency', () => {
  assert.equal(L.assessLoudness({ integrated: -14.3, truePeak: -1.6, lra: 5 }).pass, true);
  const bad = L.assessLoudness({ integrated: -20, truePeak: 0.5, lra: 5 });
  assert.equal(bad.pass, false); assert.equal(bad.issues.length, 2);
  assert.equal(L.checkConsistency([-14, -14.4, -13.8]).pass, true);
  assert.equal(L.checkConsistency([-14, -18]).pass, false);
});

test('real audio: quiet and loud sources both land on target', async () => {
  const dir = h.tmp();
  try {
    const audio = new AudioService(new FfmpegRunner());
    const results = [];
    for (const [name, vol] of [['quiet', 0.15], ['loud', 3.0]]) {
      const src = path.join(dir, name + '.wav'); h.makeTone(src, { seconds: 8, volume: vol });
      const out = path.join(dir, name + '_n.wav');
      const r = await audio.normalize(src, out);
      assert.ok(Math.abs(r.after.integrated - -14) <= 1.0, name + ' ' + r.after.integrated);
      assert.ok(r.after.truePeak <= -1.0, name + ' peak ' + r.after.truePeak);
      results.push(r.after.integrated);
    }
    assert.equal(L.checkConsistency(results).pass, true);
  } finally { h.rm(dir); }
});
