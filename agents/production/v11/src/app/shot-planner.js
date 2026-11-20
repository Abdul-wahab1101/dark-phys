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


/** Preserves the approved sentence scene order while filling the full narration timeline. */
function planSceneShots({ scenes, clips, totalSec }) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('scenePlan must contain approved scenes');
  if (!Array.isArray(clips) || !clips.length) throw new Error('no approved scene clips supplied');
  const byScene = new Map(clips.map(clip => [String(clip.sceneId), clip]));
  const ordered = scenes.map(scene => {
    const clip = byScene.get(String(scene.id));
    if (!clip) throw new Error('approved footage missing for planned scene ' + scene.id);
    return { scene, clip };
  });
  const usage = new Map(), shots = [];
  let t = 0, index = 0;
  while (t < totalSec - 0.05) {
    const { scene, clip } = ordered[index % ordered.length];
    const dur = Number(Math.min(4, Math.max(1.5, Number(scene.durationSeconds) || 4), totalSec - t).toFixed(2));
    const sourceDuration = Number(clip.duration) || 5;
    const span = Math.max(0.1, sourceDuration - dur);
    const used = usage.get(clip.assetId)?.uses || 0;
    const ss = Number((used === 0 ? 0 : (used * (dur + 0.7)) % span).toFixed(2));
    shots.push({ id: 'scene_shot_' + String(index).padStart(4, '0'), assetId: clip.assetId, source: clip.path,
      ss, dur, sceneId: scene.id, visualIntent: scene.visualIntent || scene.visual || '',
      shotType: scene.shotType || 'medium', movement: scene.movement || 'static',
      colourGrade: scene.colourGrade || 'consistent-documentary-neutral' });
    const rec = usage.get(clip.assetId) || { assetId: clip.assetId, secondsUsed: 0, uses: 0 };
    rec.secondsUsed = Number((rec.secondsUsed + dur).toFixed(2)); rec.uses++;
    usage.set(clip.assetId, rec);
    t += dur; index++;
    if (index > 10000) throw new Error('scene shot plan exceeded safe 10,000-shot limit');
  }
  return { shots, usage: [...usage.values()] };
}

function shotArgs(shot, { width = 1080, height = 1920, fps = 30 } = {}) {
  return ['-stream_loop', '-1', '-ss', String(shot.ss), '-i', shot.source, '-t', String(shot.dur),
    '-vf', 'scale=' + width + ':' + height + ':force_original_aspect_ratio=increase,crop=' + width + ':' + height + ',setsar=1,fps=' + fps + (shot.colourGrade === 'consistent-documentary-neutral' ? ',eq=contrast=1.04:saturation=0.96:brightness=0.005' : ''),
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
}

module.exports = { planShots, planSceneShots, shotArgs };
