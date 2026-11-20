'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../src/core/pacing');
const { FfmpegRunner } = require('../src/infra/ffmpeg-runner');
const { AudioService } = require('../src/app/audio-service');
const h = require('./helpers');

test('parseSilenceDetect pairs starts and ends and closes a trailing silence', () => {
  const log = 'silence_start: 2\nsilence_end: 3.6 | silence_duration: 1.6\nsilence_start: 9.5\n';
  const s = P.parseSilenceDetect(log, 11);
  assert.equal(s.length, 2);
  assert.equal(s[0].duration, 1.6);
  assert.equal(s[1].end, 11);
});

test('safe filler detection ignores ambiguous words by default', () => {
  const w = [{ word: 'So', start: 0, end: .2 }, { word: 'um,', start: .3, end: .6 }, { word: 'basically', start: .7, end: 1.1 }, { word: 'you', start: 1.2, end: 1.3 }, { word: 'know', start: 1.3, end: 1.5 }];
  assert.deepEqual(P.detectFillers(w).map(f => f.text), ['um']);
  assert.deepEqual(P.detectFillers(w, { aggressive: true }).map(f => f.text), ['um', 'basically', 'you know']);
});

test('planCuts keeps a natural pause and never cuts into neighbouring words', () => {
  const plan = P.planCuts({ duration: 10, silences: [{ start: 2, end: 3.6, duration: 1.6 }, { start: 6, end: 6.3, duration: .3 }],
    words: [{ word: 'hi', start: 0, end: 1 }, { word: 'um', start: 4, end: 4.3 }, { word: 'there', start: 4.31, end: 5 }] });
  assert.equal(plan.cuts.length, 2);
  const silenceCut = plan.cuts.find(c => c.reason === 'dead-air');
  assert.ok(Math.abs((silenceCut.end - silenceCut.start) - 1.32) < 0.01);
  const filler = plan.cuts.find(c => c.reason === 'filler');
  assert.ok(filler.end <= 4.31 + 1e-9, 'filler cut must stop before next word');
  assert.ok(plan.keeps.every(k => k.end - k.start >= 0.25));
});

test('cut budget caps total removal and protect ranges are respected', () => {
  const sil = [{ start: 1, end: 4, duration: 3 }, { start: 5, end: 7, duration: 2 }];
  const capped = P.planCuts({ duration: 10, silences: sil, maxCutRatio: 0.3 });
  assert.equal(capped.capped, true);
  assert.ok(capped.ratio <= 0.3);
  const prot = P.planCuts({ duration: 10, silences: sil, protect: [{ start: 1, end: 4 }] });
  assert.ok(prot.cuts.every(c => c.end <= 1 || c.start >= 4));
});

test('remapTime / remapAss follow the cuts', () => {
  const keeps = [{ start: 0, end: 2 }, { start: 4, end: 10 }];
  assert.equal(P.remapTime(1, keeps), 1);
  assert.equal(P.remapTime(3, keeps), 2);
  assert.equal(P.remapTime(5, keeps), 3);
  const ass = 'Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,Hi\nDialogue: 0,0:00:02.50,0:00:03.50,Default,,0,0,0,,Gone';
  const out = P.remapAss(ass, keeps);
  assert.match(out, /0:00:03\.00,0:00:04\.00/);
  assert.doesNotMatch(out, /Gone/);
});

test('buildCutFilter has one trim per keep and a concat', () => {
  const f = P.buildCutFilter([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
  assert.equal((f.match(/atrim/g) || []).length, 2);
  assert.match(f, /concat=n=2:v=0:a=1\[aout\]/);
  assert.throws(() => P.buildCutFilter([]));
});

test('real audio: dead air is detected and removed', async () => {
  const dir = h.tmp();
  try {
    const nar = h.makeNarration(path.join(dir, 'n.wav'));
    const audio = new AudioService(new FfmpegRunner());
    const { silences, duration } = await audio.detectSilences(nar.file);
    assert.ok(Math.abs(duration - nar.duration) < 0.1);
    assert.equal(silences.length, 2, JSON.stringify(silences));
    const plan = P.planCuts({ duration, silences });
    const out = path.join(dir, 'c.wav');
    await audio.applyCuts(nar.file, plan.keeps, out);
    const info = await new FfmpegRunner().probe(out);
    assert.ok(Math.abs(info.duration - (duration - plan.removedSec)) < 0.1, info.duration + ' vs ' + (duration - plan.removedSec));
    const after = await audio.detectSilences(out);
    assert.ok(after.silences.every(s => s.duration < 0.5), 'remaining pauses are short');
  } finally { h.rm(dir); }
});
