'use strict';
/**
 * Dead-air and filler removal planning (pure functions) plus the ffmpeg filter that applies the plan.
 * Conservative by default: only unambiguous hesitation sounds are cut as fillers.
 */

const SAFE_FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'hmm', 'hmmm', 'ah', 'ahh']);
const AGGRESSIVE_PHRASES = [['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'], ['basically'], ['literally'], ['matlab'], ['yani'], ['yaani']];

const norm = w => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function parseSilenceDetect(stderr, durationSec) {
  const out = [];
  let open = null;
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) { open = Math.max(0, parseFloat(s[1])); continue; }
    const e = line.match(/silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (e && open !== null) {
      const end = parseFloat(e[1]);
      out.push({ start: open, end, duration: Number((end - open).toFixed(3)) });
      open = null;
    }
  }
  if (open !== null && durationSec > open) out.push({ start: open, end: durationSec, duration: Number((durationSec - open).toFixed(3)) });
  return out;
}

function detectFillers(wordList = [], { aggressive = false } = {}) {
  const out = [];
  for (let i = 0; i < wordList.length; i++) {
    const w = norm(wordList[i].word);
    if (SAFE_FILLERS.has(w)) { out.push({ start: wordList[i].start, end: wordList[i].end, text: w, index: i, count: 1 }); continue; }
    if (!aggressive) continue;
    for (const phrase of AGGRESSIVE_PHRASES) {
      if (phrase.every((p, k) => wordList[i + k] && norm(wordList[i + k].word) === p)) {
        out.push({ start: wordList[i].start, end: wordList[i + phrase.length - 1].end, text: phrase.join(' '), index: i, count: phrase.length });
        i += phrase.length - 1;
        break;
      }
    }
  }
  return out;
}

function mergeRanges(ranges, gap = 0.05) {
  const sorted = ranges.filter(r => r.end > r.start).map(r => ({ ...r })).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) {
      last.end = Math.max(last.end, r.end);
      last.reason = last.reason === r.reason ? last.reason : 'mixed';
    } else out.push(r);
  }
  return out;
}

function invertCuts(cuts, duration) {
  const keeps = [];
  let t = 0;
  for (const c of cuts) {
    if (c.start > t) keeps.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (t < duration) keeps.push({ start: t, end: duration });
  return keeps;
}

function planCuts({
  duration, words: wordList = [], silences = [], aggressive = false,
  minSilence = 0.55, keepPause = 0.28, fillerPad = 0.03, minKeep = 0.25, maxCutRatio = 0.3, protect = []
} = {}) {
  if (!(duration > 0)) throw new Error('duration is required');
  let cuts = [];

  for (const s of silences) {
    if (s.duration < minSilence) continue;
    const a = s.start + keepPause / 2, b = s.end - keepPause / 2;
    if (b - a >= 0.1) cuts.push({ start: a, end: b, reason: 'dead-air' });
  }

  const fillers = detectFillers(wordList, { aggressive });
  for (const f of fillers) {
    const prev = wordList[f.index - 1];
    const next = wordList[f.index + f.count];
    const a = Math.max(f.start - fillerPad, prev ? prev.end : 0);
    const b = Math.min(f.end + fillerPad, next ? next.start : duration);
    if (b - a >= 0.08) cuts.push({ start: a, end: b, reason: 'filler', text: f.text });
  }

  for (const p of protect) {
    cuts = cuts.flatMap(c => {
      if (c.end <= p.start || c.start >= p.end) return [c];
      const pieces = [];
      if (c.start < p.start) pieces.push({ ...c, end: p.start });
      if (c.end > p.end) pieces.push({ ...c, start: p.end });
      return pieces;
    });
  }

  cuts = mergeRanges(cuts.map(c => ({ ...c, start: Math.max(0, c.start), end: Math.min(duration, c.end) })));

  let capped = false;
  const budget = duration * maxCutRatio;
  let total = cuts.reduce((n, c) => n + (c.end - c.start), 0);
  if (total > budget) {
    capped = true;
    const byLen = [...cuts].sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const kept = [];
    let used = 0;
    for (const c of byLen) {
      const len = c.end - c.start;
      if (used + len <= budget) { kept.push(c); used += len; }
    }
    cuts = kept.sort((a, b) => a.start - b.start);
  }

  for (;;) {
    const keeps = invertCuts(cuts, duration);
    const bad = keeps.findIndex(k => k.end - k.start < minKeep);
    if (bad < 0 || !cuts.length) break;
    const k = keeps[bad];
    const adj = cuts.filter(c => Math.abs(c.end - k.start) < 1e-6 || Math.abs(c.start - k.end) < 1e-6);
    if (!adj.length) {
      if (k.start === 0 && cuts[0]) cuts.shift(); else cuts.pop();
      continue;
    }
    const drop = adj.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    cuts = cuts.filter(c => c !== drop);
  }

  total = cuts.reduce((n, c) => n + (c.end - c.start), 0);
  const byReason = {};
  for (const c of cuts) byReason[c.reason] = Number(((byReason[c.reason] || 0) + c.end - c.start).toFixed(2));
  return {
    cuts: cuts.map(c => ({ ...c, start: Number(c.start.toFixed(3)), end: Number(c.end.toFixed(3)) })),
    keeps: invertCuts(cuts, duration).map(k => ({ start: Number(k.start.toFixed(3)), end: Number(k.end.toFixed(3)) })),
    removedSec: Number(total.toFixed(2)),
    ratio: Number((total / duration).toFixed(3)),
    capped, byReason
  };
}

/** Map a time in the original recording to the time after cuts. A time inside a cut maps to the cut point. */
function remapTime(t, keeps) {
  let acc = 0;
  for (const k of keeps) {
    if (t < k.start) return acc;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return acc;
}

function remapSegments(segments, keeps) {
  return segments.map(s => ({ ...s, start: remapTime(s.start, keeps), end: remapTime(s.end, keeps) })).filter(s => s.end - s.start > 0.05);
}

function remapWords(wordList, keeps) {
  return wordList.filter(w => keeps.some(k => w.start >= k.start - 1e-6 && w.end <= k.end + 1e-6))
    .map(w => ({ ...w, start: remapTime(w.start, keeps), end: remapTime(w.end, keeps) }));
}

const assTime = s => {
  const cs = Math.round(Math.max(0, s) * 100);
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100);
  return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
};
const parseAss = t => { const m = t.match(/^(\d+):(\d+):(\d+)\.(\d+)$/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 100 : null; };

/** Re-time ASS Dialogue lines so captions still match the audio after cuts. */
function remapAss(assText, keeps) {
  return String(assText).split(/\r?\n/).map(line => {
    if (!/^Dialogue:/i.test(line)) return line;
    const parts = line.split(',');
    const a = parseAss(parts[1]), b = parseAss(parts[2]);
    if (a === null || b === null) return line;
    const na = remapTime(a, keeps), nb = remapTime(b, keeps);
    if (nb - na < 0.05) return null;
    parts[1] = assTime(na); parts[2] = assTime(nb);
    return parts.join(',');
  }).filter(l => l !== null).join('\n');
}

/** ffmpeg filter_complex that keeps only the given ranges (audio, and video when requested). */
function buildCutFilter(keeps, { video = false, audio = true, fadeSec = 0.012 } = {}) {
  if (!keeps.length) throw new Error('nothing to keep');
  const parts = [];
  const labels = [];
  keeps.forEach((k, i) => {
    const len = k.end - k.start;
    if (video) { parts.push('[0:v]trim=start=' + k.start.toFixed(3) + ':end=' + k.end.toFixed(3) + ',setpts=PTS-STARTPTS[v' + i + ']'); labels.push('[v' + i + ']'); }
    if (audio) {
      const f = Math.min(fadeSec, len / 4);
      parts.push('[0:a]atrim=start=' + k.start.toFixed(3) + ':end=' + k.end.toFixed(3) + ',asetpts=PTS-STARTPTS,afade=t=in:st=0:d=' + f.toFixed(3) + ',afade=t=out:st=' + (len - f).toFixed(3) + ':d=' + f.toFixed(3) + '[a' + i + ']');
      labels.push('[a' + i + ']');
    }
  });
  const order = keeps.map((_, i) => (video ? '[v' + i + ']' : '') + (audio ? '[a' + i + ']' : '')).join('');
  parts.push(order + 'concat=n=' + keeps.length + ':v=' + (video ? 1 : 0) + ':a=' + (audio ? 1 : 0) + (video ? '[vout]' : '') + (audio ? '[aout]' : ''));
  return parts.join(';');
}

function deadAirStats(silences, duration) {
  const total = silences.reduce((n, s) => n + s.duration, 0);
  const longest = silences.reduce((m, s) => Math.max(m, s.duration), 0);
  return { totalSec: Number(total.toFixed(2)), ratio: Number((total / duration).toFixed(3)), longestSec: Number(longest.toFixed(2)), count: silences.length };
}

module.exports = { parseSilenceDetect, detectFillers, planCuts, remapTime, remapSegments, remapWords, remapAss, buildCutFilter, deadAirStats, invertCuts, mergeRanges };
