'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHook, segmentsFromScript, detectDevices } = require('../src/core/hook');

const strong = [
  { start: 0.2, end: 3.2, text: 'Your brain is lying to you right now.' },
  { start: 3.4, end: 7.5, text: 'Most people never notice these 3 tricks, but the last one is the most dangerous.' },
  { start: 7.8, end: 12.5, text: 'Stay with me, because by the end you will see why your choices are not really yours.' }
];

test('strong hook scores high with no issues', () => {
  const r = analyzeHook({ title: '3 Tricks Your Brain Uses', segments: strong });
  assert.ok(r.score >= 80, 'score ' + r.score);
  assert.equal(r.grade, 'strong');
  assert.equal(r.heuristic, true);
});

test('greeting opener and late start are flagged', () => {
  const r = analyzeHook({ title: 'Gaslighting signs', segments: [
    { start: 3.5, end: 7, text: 'Hello guys welcome back to my channel, please subscribe.' },
    { start: 8, end: 12, text: 'Today we talk about something.' }] });
  assert.ok(r.issues.includes('no-greeting'));
  assert.ok(r.issues.includes('fast-start'));
  assert.equal(r.grade, 'weak');
  assert.ok(r.suggestions.length >= 2);
});

test('no speech in window gives zero', () => {
  const r = analyzeHook({ segments: [{ start: 20, end: 25, text: 'Late.' }] });
  assert.equal(r.score, 0);
  assert.deepEqual(r.issues, ['no_speech_in_window']);
});

test('long pauses inside the hook are flagged', () => {
  const r = analyzeHook({ title: 'x', segments: [
    { start: 0.2, end: 2, text: 'You will not believe this?' },
    { start: 4.5, end: 6, text: 'But here is why it matters to you.' }] });
  assert.ok(r.issues.includes('no-dead-air'));
});

test('device detection', () => {
  assert.deepEqual(detectDevices('Why do you do this?').sort(), ['direct-address', 'question']);
  assert.ok(detectDevices('7 signs').includes('number'));
});

test('segmentsFromScript produces increasing timings', () => {
  const s = segmentsFromScript('One two three four. Five six seven eight nine ten.');
  assert.equal(s.length, 2);
  assert.ok(s[1].start > s[0].end);
});
