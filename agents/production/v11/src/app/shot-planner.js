'use strict';
const { mulberry32, seedFrom } = require('../core/rng');

/** Cuts the timeline into shots, cycling through all clips first so as many unique clips as possible are used. */
function planShots({ clips, totalSec, seed = 'shots', shotRange = [2.2, 3.8] }) {
  if (!clips.length) throw new Error('no clips to plan shots from');
  if (!(totalSec > 0)) throw new Error('totalSec must be positive');
  const rng = mulberry32(seedFrom(seed));
  const used = new Array(clips.length).fill(0);
  const shots = [];
  let t = 0, i = 0;
  while (t < totalSec - 0.05) {
    let len = shotRange[0] + rng() * (shotRange[1] - shotRange[0]);
    len = Math.min(len, totalSec - t);
    if (totalSec - t - len < 1) len = totalSec - t;
    const ci = i % clips.length;
    const span = Math.max(0.1, (clips[ci].duration || 5) - len);
    const ss = used[ci] === 0 ? rng() * Math.min(span, 2) : (used[ci] * (len + 0.7)) % span;
    used[ci]++;
    shots.push({ id: 'shot_' + String(i).padStart(3, '0'), assetId: clips[ci].assetId, source: clips[ci].path, ss: Number(ss.toFixed(2)), dur: Number(len.toFixed(2)) });
    t += len; i++;
  }
  const usage = new Map();
  for (const s of shots) {
    const u = usage.get(s.assetId) || { assetId: s.assetId, secondsUsed: 0, uses: 0 };
    u.secondsUsed = Number((u.secondsUsed + s.dur).toFixed(2)); u.uses++;
    usage.set(s.assetId, u);
  }
  return { shots, usage: [...usage.values()] };
}

function shotArgs(shot, { width = 1080, height = 1920, fps = 30 } = {}) {
  return ['-stream_loop', '-1', '-ss', String(shot.ss), '-i', shot.source, '-t', String(shot.dur),
    '-vf', 'scale=' + width + ':' + height + ':force_original_aspect_ratio=increase,crop=' + width + ':' + height + ',setsar=1,fps=' + fps,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
}

module.exports = { planShots, shotArgs };
