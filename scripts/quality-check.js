'use strict';
/**
 * Final deliverable gate for Dark Phys.
 * Usage:
 * node scripts/quality-check.js --video uploads/final.mp4 --captions uploads/final.srt --thumbnail uploads/thumbnail.jpg --seo uploads/seo.json --mode long
 * Shorts: --mode short (duration 20-60 seconds, vertical 9:16)
 * Requires ffprobe (bundled with FFmpeg). Writes a JSON report beside the video.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function evaluateMedia(probe, mode = 'long') {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(s => s.codec_type === 'video');
  const audio = streams.find(s => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration || video?.duration || 0);
  const width = Number(video?.width || 0), height = Number(video?.height || 0);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  add('video stream', !!video, video ? video.codec_name || 'present' : 'missing');
  add('audio stream', !!audio, audio ? audio.codec_name || 'present' : 'missing');
  add('duration', mode === 'short' ? duration >= 20 && duration <= 60 : duration >= 480 && duration <= 720,
    duration ? duration.toFixed(1) + ' seconds' : 'unknown');
  add('resolution', mode === 'short' ? width >= 720 && height > width : width >= 1280 && width > height,
    width + 'x' + height);
  add('frame rate', (() => {
    const rate = String(video?.avg_frame_rate || '0/1').split('/');
    return Number(rate[1]) > 0 && Number(rate[0]) / Number(rate[1]) >= 23;
  })(), video?.avg_frame_rate || 'unknown');
  return { mode, duration_seconds: duration, width, height, checks, passed: checks.every(c => c.ok) };
}
function main() {
  const videoPath = path.resolve(arg('video'));
  const captionsPath = arg('captions') ? path.resolve(arg('captions')) : '';
  const thumbnailPath = arg('thumbnail') ? path.resolve(arg('thumbnail')) : '';
  const seoPath = arg('seo') ? path.resolve(arg('seo')) : '';
  const mode = arg('mode', 'long');
  if (!arg('video') || !['long', 'short'].includes(mode)) throw new Error('Provide --video <mp4> and --mode long|short');
  if (!fs.existsSync(videoPath)) throw new Error('Video file not found: ' + videoPath);
  const probeBin = process.env.FFPROBE_PATH || 'ffprobe';
  const probe = spawnSync(probeBin, ['-v','error','-show_streams','-show_format','-of','json',videoPath], { encoding:'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('ffprobe failed. Install FFmpeg or set FFPROBE_PATH. ' + (probe.stderr || probe.error?.message || ''));
  const report = evaluateMedia(JSON.parse(probe.stdout), mode);
  const add = (name, ok, detail) => report.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  add('captions file', !!captionsPath && fs.existsSync(captionsPath) && fs.statSync(captionsPath).size > 20, captionsPath || 'not supplied');
  add('thumbnail file', !!thumbnailPath && fs.existsSync(thumbnailPath) && fs.statSync(thumbnailPath).size > 1000, thumbnailPath || 'not supplied');
  let seo = null;
  try { seo = JSON.parse(fs.readFileSync(seoPath, 'utf8')); } catch (_) {}
  add('SEO metadata', !!seo && typeof seo.title === 'string' && seo.title.trim().length >= 10 &&
    typeof seo.description === 'string' && seo.description.trim().length >= 50 &&
    (Array.isArray(seo.tags) ? seo.tags.length > 0 : typeof seo.tags === 'string' && seo.tags.trim().length > 0),
    seo ? 'title, description and tags present' : 'missing/invalid SEO JSON (title, description, tags required)');
  report.passed = report.checks.every(c => c.ok);
  report.created_at = new Date().toISOString();
  report.video = videoPath;
  const reportPath = videoPath.replace(/\.[^.]+$/, '') + '.quality-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  for (const c of report.checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + ': ' + c.detail);
  console.log((report.passed ? 'QUALITY GATE PASSED' : 'QUALITY GATE BLOCKED') + ' — ' + reportPath);
  if (!report.passed) process.exitCode = 2;
}
if (require.main === module) {
  try { main(); } catch (e) { console.error('Quality check error:', e.message); process.exit(1); }
}
module.exports = { evaluateMedia };
