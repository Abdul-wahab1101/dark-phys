'use strict';

const CUE_LIBRARY = Object.freeze({
  hook: { tags: ['impact', 'reverse', 'low-hit'], maxCues: 2, gainDb: -13 },
  reveal: { tags: ['riser', 'impact', 'sparkle'], maxCues: 2, gainDb: -16 },
  transition: { tags: ['whoosh', 'sweep'], maxCues: 1, gainDb: -18 },
  tension: { tags: ['drone', 'pulse', 'texture'], maxCues: 1, gainDb: -22 },
  evidence: { tags: ['subtle-tick', 'soft-hit'], maxCues: 1, gainDb: -24 },
  payoff: { tags: ['impact', 'warm-hit', 'tail'], maxCues: 2, gainDb: -15 }
});
const MOOD_BY_KIND = Object.freeze({
  hook: 'cinematic-tension', reveal: 'discovery', transition: 'forward-motion',
  tension: 'dark-ambient', evidence: 'restrained-documentary', payoff: 'emotional-resolution'
});
function seconds(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function classifyScene(scene, index, total) {
  const text = [scene.type, scene.kind, scene.purpose, scene.title, scene.narration, scene.visual].join(' ').toLowerCase();
  if (index === 0 || /hook|cold open|opening/.test(text)) return 'hook';
  if (index === total - 1 || /payoff|ending|conclusion|resolution/.test(text)) return 'payoff';
  if (/reveal|discover|unexpected|turning point/.test(text)) return 'reveal';
  if (/evidence|study|research|data|fact|proof/.test(text)) return 'evidence';
  if (/tension|threat|danger|mystery|uncertain/.test(text)) return 'tension';
  return 'transition';
}
function chooseAsset(library, tags, used = new Set()) {
  const candidates = (Array.isArray(library) ? library : []).filter(asset =>
    asset && asset.path && !used.has(asset.id || asset.path) &&
    tags.some(tag => (asset.tags || []).map(x => String(x).toLowerCase()).includes(tag))
  );
  return candidates[0] || null;
}
function buildSoundDesignPlan({ scenes = [], library = [], durationSeconds, musicPath, voicePath } = {}) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('Sound design requires a non-empty scene plan.');
  const total = seconds(durationSeconds, scenes.reduce((sum, scene) => sum + seconds(scene.durationSeconds, 5), 0));
  const used = new Set(), cues = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const duration = seconds(scene.durationSeconds, 5);
    const kind = classifyScene(scene, index, scenes.length);
    const preset = CUE_LIBRARY[kind];
    const cueOffsets = kind === 'hook' ? [0.12] : kind === 'payoff' ? [Math.max(0, duration - 1.2)] : kind === 'evidence' ? [0.35] : [Math.min(0.6, duration * 0.2)];
    for (const offset of cueOffsets.slice(0, preset.maxCues)) {
      const asset = chooseAsset(library, preset.tags, used);
      if (!asset) continue;
      const key = asset.id || asset.path;
      used.add(key);
      cues.push({ id: 'cue-' + (cues.length + 1), path: asset.path,
        atSeconds: Math.min(total, cursor + offset), gainDb: Number.isFinite(Number(asset.gainDb)) ? Number(asset.gainDb) : preset.gainDb,
        kind, tags: asset.tags || [] });
    }
    cursor += duration;
  });
  return {
    version: 1,
    durationSeconds: total,
    music: musicPath ? { path: musicPath, gainDb: -25, ducking: true, fadeInSeconds: 1.5, fadeOutSeconds: 2.5 } : null,
    voice: voicePath ? { path: voicePath, targetLufs: -16, highpassHz: 80, compressorRatio: 3 } : null,
    cues,
    scenes: scenes.map((scene, index) => ({ index, startSeconds: scenes.slice(0, index).reduce((sum, item) => sum + seconds(item.durationSeconds, 5), 0),
      durationSeconds: seconds(scene.durationSeconds, 5), mood: MOOD_BY_KIND[classifyScene(scene, index, scenes.length)] })),
    mix: { targetIntegratedLufs: -14, truePeakDbtp: -1.5, musicDuckDb: -10, voicePriority: true, stereoOutput: true }
  };
}
module.exports = { buildSoundDesignPlan, classifyScene, CUE_LIBRARY, MOOD_BY_KIND };
