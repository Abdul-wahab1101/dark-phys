'use strict';
const assert = require('assert');
const { evaluateMedia } = require('./quality-check');
const base = {
  format: { duration: '600' },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1' },
    { codec_type: 'audio', codec_name: 'aac' }
  ]
};
const long = evaluateMedia(base, 'long');
assert.strictEqual(long.passed, true, 'valid long-form media passes');
const noAudio = evaluateMedia({ ...base, streams: [base.streams[0]] }, 'long');
assert.strictEqual(noAudio.checks.find(c => c.name === 'audio stream').ok, false);
const short = evaluateMedia({ ...base, format: { duration: '35' }, streams: [
  { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1' },
  { codec_type: 'audio', codec_name: 'aac' }
]}, 'short');
assert.strictEqual(short.passed, true, 'valid vertical short passes');
const wrongAspect = evaluateMedia({ ...base, format: { duration: '35' } }, 'short');
assert.strictEqual(wrongAspect.passed, false);
const wrongDuration = evaluateMedia({ ...base, format: { duration: '90' } }, 'short');
assert.strictEqual(wrongDuration.checks.find(c => c.name === 'duration').ok, false);
console.log('Quality gate tests passed (5 assertions).');
