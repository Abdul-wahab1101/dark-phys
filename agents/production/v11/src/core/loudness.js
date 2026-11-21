'use strict';
/** Loudness helpers (EBU R128 / ffmpeg loudnorm). YouTube-style target: about -14 LUFS integrated. */

const DEFAULTS = { target: -14, truePeak: -1.5, lra: 11 };

class LoudnessError extends Error {}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (String(v).toLowerCase().includes('-inf') ? -Infinity : NaN);
}

function parseLoudnormJson(stderr) {
  const blocks = String(stderr || '').match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) throw new LoudnessError('loudnorm measurement not found in ffmpeg output');
  const j = JSON.parse(blocks[blocks.length - 1]);
  return {
    input_i: num(j.input_i), input_tp: num(j.input_tp), input_lra: num(j.input_lra),
    input_thresh: num(j.input_thresh), target_offset: num(j.target_offset)
  };
}

function parseEbur128(stderr) {
  const text = String(stderr || '');
  const grab = re => { const all = [...text.matchAll(re)]; return all.length ? num(all[all.length - 1][1]) : NaN; };
  const result = { integrated: grab(/\bI:\s+(-?[\d.]+|-inf)\s+LUFS/g), lra: grab(/\bLRA:\s+(-?[\d.]+)\s+LU/g), truePeak: grab(/\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/g) };
  if (!Number.isFinite(result.integrated)) throw new LoudnessError('ebur128 summary not found in ffmpeg output');
  return result;
}

function buildMeasureFilter({ target, truePeak, lra } = DEFAULTS) {
  return 'loudnorm=I=' + target + ':TP=' + truePeak + ':LRA=' + lra + ':print_format=json';
}

/** Second pass: linear normalisation using the measurements of the first pass. */
function buildNormalizeFilter(m, { target, truePeak, lra } = DEFAULTS) {
  if (!Number.isFinite(m.input_i) || !Number.isFinite(m.input_tp) || !Number.isFinite(m.input_thresh)) {
    throw new LoudnessError('audio is silent or unmeasurable; cannot normalise');
  }
  return 'loudnorm=I=' + target + ':TP=' + truePeak + ':LRA=' + lra +
    ':measured_I=' + m.input_i + ':measured_TP=' + m.input_tp + ':measured_LRA=' + m.input_lra +
    ':measured_thresh=' + m.input_thresh + ':offset=' + (Number.isFinite(m.target_offset) ? m.target_offset : 0) + ':linear=true';
}

function assessLoudness({ integrated, truePeak, lra }, { target = -14, tolerance = 1.0, maxTruePeak = -1.0, maxLra = 16 } = {}) {
  const issues = [];
  if (!Number.isFinite(integrated)) issues.push('silent_or_unmeasurable');
  else if (Math.abs(integrated - target) > tolerance) issues.push('integrated_' + integrated.toFixed(1) + '_LUFS_outside_target_' + target + '_+-' + tolerance);
  if (Number.isFinite(truePeak) && truePeak > maxTruePeak) issues.push('true_peak_' + truePeak.toFixed(1) + '_dBTP_too_hot');
  if (Number.isFinite(lra) && lra > maxLra) issues.push('loudness_range_' + lra.toFixed(1) + '_LU_too_wide');
  return { pass: issues.length === 0, issues };
}

/** Channel consistency: all videos should sit within a narrow loudness band. */
function checkConsistency(valuesLufs, { maxSpread = 1.5 } = {}) {
  const v = valuesLufs.filter(Number.isFinite);
  if (v.length < 2) return { pass: true, spread: 0, count: v.length };
  const spread = Math.max(...v) - Math.min(...v);
  return { pass: spread <= maxSpread, spread: Number(spread.toFixed(2)), count: v.length, mean: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) };
}

module.exports = { DEFAULTS, LoudnessError, parseLoudnormJson, parseEbur128, buildMeasureFilter, buildNormalizeFilter, assessLoudness, checkConsistency };
