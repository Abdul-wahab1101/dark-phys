'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const geo = require('../src/core/thumbnail-geometry');
const { analyzeThumbnail } = require('../src/infra/thumbnail-pixels');
const h = require('./helpers');

let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* tests that need pixels are skipped */ }

async function makeThumb(file, { bg = '#101018', fg = '#ffffff', box = { x: 80, y: 200, w: 700, h: 220 } } = {}) {
  // white bars inside the box imitate glyph strokes on a plain background
  let bars = '';
  for (let i = 0; i < 6; i++) bars += '<rect x="' + (box.x + 10 + i * Math.floor(box.w / 6)) + '" y="' + (box.y + 10) + '" width="' + Math.floor(box.w / 12) + '" height="' + (box.h - 20) + '" fill="' + fg + '"/>';
  const svg = '<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="' + bg + '"/>' +
    '<rect x="0" y="0" width="1280" height="200" fill="#444"/><circle cx="1000" cy="300" r="150" fill="#c94"/>' + bars + '</svg>';
  await sharp(Buffer.from(svg)).png().toFile(file);
}

test('safe zones: timestamp badge, margins and progress bar', () => {
  assert.deepEqual(geo.checkSafeZones([{ x: 80, y: 200, w: 600, h: 200 }]), []);
  const under = geo.checkSafeZones([{ x: 1000, y: 620, w: 200, h: 80 }]);
  assert.ok(under.some(f => f.id === 'under_timestamp_badge' && f.level === 'fail'));
  assert.ok(geo.checkSafeZones([{ x: 10, y: 300, w: 300, h: 100 }]).some(f => f.id === 'outside_margin'));
  assert.ok(geo.checkSafeZones([{ x: 100, y: 690, w: 300, h: 25 }]).some(f => f.id === 'under_progress_bar'));
});

test('text size rules for 360px feed and 168px search results', () => {
  assert.ok(geo.checkTextSize([{ x: 0, y: 0, w: 1, h: 1, fontSize: 40 }]).some(f => f.id === 'too_small_in_feed'));
  assert.ok(geo.checkTextSize([{ x: 0, y: 0, w: 1, h: 1, fontSize: 60 }]).some(f => f.id === 'too_small_in_search_results'));
  assert.deepEqual(geo.checkTextSize([{ x: 0, y: 0, w: 1, h: 1, fontSize: 110 }]), []);
});

test('word and character limits', () => {
  assert.equal(geo.checkWordCount('THEY REWRITE YOUR MEMORY').length, 0);
  assert.ok(geo.checkWordCount('this is a very long headline with far too many words').length >= 1);
});

test('contrast maths', () => {
  assert.ok(geo.contrastRatio(0, 255) > 20);
  assert.ok(geo.contrastRatio(120, 130) < 1.2);
  assert.ok(geo.regionContrast([10, 10, 250, 250, 10, 250]) > 10);
});

test('pixels: a clear thumbnail passes', { skip: !sharp }, async () => {
  const dir = h.tmp();
  try {
    const f = path.join(dir, 't.png'); await makeThumb(f);
    const r = await analyzeThumbnail(f, { textBoxes: [{ x: 80, y: 200, w: 700, h: 220, fontSize: 120 }], text: 'WHO PULLS YOUR STRINGS' });
    assert.equal(r.level, 'ok', JSON.stringify(r.findings));
    assert.ok(r.contrasts[0].feed168 > 4);
  } finally { h.rm(dir); }
});

test('pixels: low contrast, wrong size and badge overlap are caught', { skip: !sharp }, async () => {
  const dir = h.tmp();
  try {
    const f = path.join(dir, 'low.png'); await makeThumb(f, { bg: '#777777', fg: '#7c7c7c' });
    const low = await analyzeThumbnail(f, { textBoxes: [{ x: 80, y: 200, w: 700, h: 220, fontSize: 120 }] });
    assert.equal(low.level, 'fail');
    assert.ok(low.findings.some(x => x.id === 'low_text_contrast_in_feed'));

    const g = path.join(dir, 'badge.png'); await makeThumb(g, { box: { x: 1000, y: 620, w: 220, h: 80 } });
    const badge = await analyzeThumbnail(g, { textBoxes: [{ x: 1000, y: 620, w: 220, h: 80, fontSize: 120 }] });
    assert.ok(badge.findings.some(x => x.id === 'under_timestamp_badge'));

    const small = path.join(dir, 'small.png'); await sharp({ create: { width: 640, height: 360, channels: 3, background: '#222' } }).png().toFile(small);
    const wrong = await analyzeThumbnail(small, {});
    assert.ok(wrong.findings.some(x => x.id === 'wrong_dimensions'));
  } finally { h.rm(dir); }
});
