'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function tmp(prefix = 'ysys_') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function ff(args) {
  const r = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg fixture failed: ' + r.stderr);
}

/** Speech-like narration: tone bursts separated by silences of known length. Returns { file, duration, silences }. */
function makeNarration(file) {
  const parts = [['t', 2.0], ['s', 1.6], ['t', 2.0], ['s', 0.7], ['t', 2.5], ['s', 0.3], ['t', 2.0]];
  const args = [];
  parts.forEach(([k, d]) => args.push('-f', 'lavfi', '-t', String(d), '-i', k === 't' ? 'sine=frequency=220:sample_rate=44100' : 'anullsrc=r=44100:cl=mono'));
  args.push('-filter_complex', parts.map((_, i) => '[' + i + ':a]').join('') + 'concat=n=' + parts.length + ':v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', file);
  ff(args);
  return { file, duration: parts.reduce((n, p) => n + p[1], 0) };
}

function makeClip(file, { seconds = 6, size = '640x360', hue = 0 } = {}) {
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=' + size + ':rate=25:duration=' + seconds, '-vf', 'hue=h=' + hue, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file]);
}

function makeTone(file, { seconds = 5, freq = 440, volume = 1 } = {}) {
  ff(['-f', 'lavfi', '-i', 'sine=frequency=' + freq + ':duration=' + seconds + ':sample_rate=44100', '-af', 'volume=' + volume, file]);
}

function ffprobeJson(file) {
  const r = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout);
}

/** True only for a really running process (a zombie that nobody reaped counts as dead). */
function alive(pid) {
  try { process.kill(pid, 0); } catch (_) { return false; }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8')); } catch (_) { return true; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { tmp, rm, ff, makeNarration, makeClip, makeTone, ffprobeJson, alive, sleep };
