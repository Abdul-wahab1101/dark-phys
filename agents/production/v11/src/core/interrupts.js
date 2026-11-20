'use strict';
/**
 * Pattern interrupts: planned visual/audio changes so no stretch of the video stays static.
 * Dense in the hook window, relaxed afterwards. Deterministic for a given seed.
 */
const { mulberry32, seedFrom } = require('./rng');

const TYPES = ['cut-zoom', 'broll-swap', 'caption-emphasis', 'sfx-hit', 'text-card', 'speed-ramp', 'color-flash'];
const DURATION = {
  'cut-zoom': [0.9, 1.6], 'broll-swap': [0.1, 0.1], 'caption-emphasis': [0.6, 1.0],
  'sfx-hit': [0.1, 0.1], 'text-card': [1.2, 1.8], 'speed-ramp': [0.5, 0.9], 'color-flash': [0.12, 0.2]
};

function planPatternInterrupts({
  durationSec, segments = [], hookWindowSec = 15, seed = 'seed',
  hookGap = [2.6, 4.2], bodyGap = [5.5, 9.5], tailQuietSec = 3, maxPerMinute = 14
} = {}) {
  if (!(durationSec > 0)) throw new Error('durationSec is required');
  const rng = mulberry32(seedFrom(seed));
  const starts = segments.map(s => s.start).filter(Number.isFinite).sort((a, b) => a - b);
  const interrupts = [];
  const range = ([a, b]) => a + rng() * (b - a);
  let t = range([2.4, 3.6]);
  let lastTextCard = -99;

  while (t < durationSec - tailQuietSec) {
    let at = t;
    const near = starts.find(s => Math.abs(s - t) <= 0.6);
    const prev = interrupts.length ? interrupts[interrupts.length - 1].t : -99;
    if (near !== undefined && near - prev >= 2.0) at = near;

    const recent = interrupts.slice(-2).map(i => i.type);
    let pool = TYPES.filter(x => !recent.includes(x));
    if (at - lastTextCard < 8) pool = pool.filter(x => x !== 'text-card');
    if (at < hookWindowSec) pool = pool.filter(x => x !== 'speed-ramp');
    const type = pool[Math.floor(rng() * pool.length)];
    if (type === 'text-card') lastTextCard = at;

    const [d0, d1] = DURATION[type];
    const dur = Number((d0 + rng() * (d1 - d0)).toFixed(2));
    const minuteCount = interrupts.filter(i => i.t > at - 60).length;
    if (minuteCount < maxPerMinute) interrupts.push({ t: Number(at.toFixed(2)), type, durationSec: dur, phase: at < hookWindowSec ? 'hook' : 'body' });

    t = at + range(at < hookWindowSec ? hookGap : bodyGap);
  }
  return { interrupts, stats: statsOf(interrupts, durationSec, hookWindowSec) };
}

function statsOf(list, durationSec, hookWindowSec) {
  let maxGap = list.length ? list[0].t : durationSec;
  for (let i = 1; i < list.length; i++) maxGap = Math.max(maxGap, list[i].t - list[i - 1].t);
  if (list.length) maxGap = Math.max(maxGap, durationSec - list[list.length - 1].t);
  return {
    count: list.length,
    perMinute: Number((list.length / (durationSec / 60)).toFixed(1)),
    maxGapSec: Number(maxGap.toFixed(2)),
    hookCount: list.filter(i => i.t < hookWindowSec).length,
    typesUsed: [...new Set(list.map(i => i.type))]
  };
}

function validateInterruptPlan(plan, { durationSec, hookWindowSec = 15, maxGapSec = 11, minHookCount = 3 } = {}) {
  const issues = [];
  const list = plan.interrupts || [];
  const stats = statsOf(list, durationSec, hookWindowSec);
  const effectiveWindow = Math.min(hookWindowSec, Math.max(0, durationSec - 3));
  if (stats.hookCount < Math.min(minHookCount, Math.floor(effectiveWindow / 5))) issues.push('too_few_interrupts_in_hook');
  if (stats.maxGapSec > maxGapSec) issues.push('static_stretch_longer_than_' + maxGapSec + 's');
  for (let i = 1; i < list.length; i++) if (list[i].type === list[i - 1].type) { issues.push('same_type_twice_in_a_row'); break; }
  if (stats.perMinute > 16) issues.push('too_busy');
  return { ok: issues.length === 0, issues, stats };
}

/** ffmpeg filtergraph for the interrupts that can be done in video filters (zoom punch-in, flash). */
function buildInterruptFilter(interrupts, { width = 1080, height = 1920, inLabel = '0:v', outLabel = 'vi' } = {}) {
  const jobs = interrupts.filter(i => i.type === 'cut-zoom' || i.type === 'color-flash');
  if (!jobs.length) return '[' + inLabel + ']null[' + outLabel + ']';
  const parts = [];
  let cur = '[' + inLabel + ']';
  jobs.forEach((j, i) => {
    const a = j.t.toFixed(2), b = (j.t + j.durationSec).toFixed(2);
    const out = i === jobs.length - 1 ? outLabel : 'o' + i;
    if (j.type === 'cut-zoom') {
      const zw = Math.round(width * 1.1 / 2) * 2, zh = Math.round(height * 1.1 / 2) * 2;
      parts.push(cur + 'split[b' + i + '][z' + i + '];[z' + i + ']scale=' + zw + ':' + zh + ',crop=' + width + ':' + height + '[zz' + i + '];[b' + i + '][zz' + i + "]overlay=0:0:enable='between(t," + a + ',' + b + ")'[" + out + ']');
    } else {
      parts.push(cur + "drawbox=x=0:y=0:w=iw:h=ih:color=white@0.16:t=fill:enable='between(t," + a + ',' + b + ")'[" + out + ']');
    }
    cur = '[' + out + ']';
  });
  return parts.join(';');
}

module.exports = { planPatternInterrupts, validateInterruptPlan, buildInterruptFilter, TYPES };
