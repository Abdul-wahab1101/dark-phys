'use strict';
const fs = require('node:fs');

const CUE_LIBRARY = Object.freeze({
  hook: { tags: ['impact', 'reverse', 'low-hit'], maxCues: 2, gainDb: -13 },
  reveal: { tags: ['riser', 'impact', 'sparkle'], maxCues: 2, gainDb: -16 },
  transition: { tags: ['whoosh', 'sweep'], maxCues: 1, gainDb: -18 },
  tension: { tags: ['drone', 'pulse', 'texture'], maxCues: 1, gainDb: -22 },
  evidence: { tags: ['subtle-tick', 'soft-hit'], maxCues: 1, gainDb: -24 },
  payoff: { tags: ['impact', 'warm-hit', 'tail'], maxCues: 2, gainDb: -15 },
  ambience: { tags: ['ambience', 'room-tone', 'atmosphere'], maxCues: 1, gainDb: -28 }
});
const MOOD_BY_KIND = Object.freeze({
  hook: 'cinematic-tension', reveal: 'discovery', transition: 'forward-motion',
  tension: 'dark-ambient', evidence: 'restrained-documentary', payoff: 'emotional-resolution', ambience: 'natural-atmosphere'
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
  if (scene.ambience === true || /room tone|ambient bed|atmosphere|environmental ambience/.test(text)) return 'ambience';
  return 'transition';
}
function chooseAsset(library, tags, used = new Set()) {
  const candidates = (Array.isArray(library) ? library : []).filter(asset =>
    asset && asset.path && !used.has(asset.id || asset.path) &&
    tags.some(tag => (asset.tags || []).map(x => String(x).toLowerCase()).includes(tag))
  );
  return candidates[0] || null;
}
function buildSoundDesignPlan({ scenes = [], library = [], durationSeconds, musicPath, voicePath, musicRights = {}, musicSegments = [], ambienceSegments = [] } = {}) {
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
  const acts = new Map();
  let sceneCursor = 0;
  scenes.forEach((scene, index) => {
    const start = sceneCursor, end = start + seconds(scene.durationSeconds, 5);
    const act = String(scene.act || scene.actName || scene.section || (scene.beat ? 'Act ' + scene.beat : 'Act ' + (index + 1)));
    const current = acts.get(act) || { act, startSeconds: start, endSeconds: end, moods: [] };
    current.endSeconds = end;
    const mood = scene.musicMood || MOOD_BY_KIND[classifyScene(scene, index, scenes.length)];
    if (!current.moods.includes(mood)) current.moods.push(mood);
    acts.set(act, current);
    sceneCursor = end;
  });
  const silenceWindows = [];
  sceneCursor = 0;
  scenes.forEach((scene, index) => {
    const duration = seconds(scene.durationSeconds, 5);
    if (scene.silence === true || scene.musicMode === 'silence' || scene.ambience === 'silence') {
      silenceWindows.push({ startSeconds: sceneCursor, endSeconds: sceneCursor + duration, reason: scene.silenceReason || 'intentional dramatic silence', sceneIndex: index });
    }
    sceneCursor += duration;
  });
  const musicRightsRecord = musicPath ? {
    path: musicPath, source: musicRights.source || 'Unverified local music',
    sourceUrl: musicRights.sourceUrl || null, creator: musicRights.creator || null,
    licenseId: musicRights.licenseId || 'unknown', licenseUrl: musicRights.licenseUrl || null,
    retrievedAt: musicRights.retrievedAt || null, proofPath: musicRights.proofPath || null,
    reviewStatus: musicRights.reviewStatus || 'pending', attributionRequired: musicRights.attributionRequired === true,
    attributionText: musicRights.attributionText || '', commercialUseVerified: musicRights.commercialUseVerified === true
  } : null;
  const normalizedTracks = [...(Array.isArray(musicSegments) ? musicSegments.map(x => ({ ...x, type: x.type || 'music' })) : []), ...(Array.isArray(ambienceSegments) ? ambienceSegments.map(x => ({ ...x, type: 'ambience', gainDb: x.gainDb ?? -32 })) : [])].map((segment, index) => {
    const startSeconds = seconds(segment.startSeconds, 0);
    const endSeconds = segment.endSeconds === undefined || segment.endSeconds === null ? total : seconds(segment.endSeconds, total);
    if (!segment.path || endSeconds <= startSeconds || endSeconds > total + 0.05) throw new Error('Audio bed needs a path and a valid start/end range within the video duration.');
    return { id: segment.id || 'audio-bed-' + (index + 1), type: segment.type, act: segment.act || 'Act ' + (index + 1), path: segment.path, startSeconds, endSeconds, mood: segment.mood || 'documentary-ambient', gainDb: Number.isFinite(Number(segment.gainDb)) ? Math.max(-48, Math.min(0, Number(segment.gainDb))) : (segment.type === 'ambience' ? -32 : -25), fadeInSeconds: seconds(segment.fadeInSeconds, 0.5), fadeOutSeconds: seconds(segment.fadeOutSeconds, 0.8), ducking: segment.ducking !== false, rights: segment.rights || musicRights };
  });
  const trackRightsLedger = normalizedTracks.map(track => ({ id: track.id, type: track.type, path: track.path, ...track.rights }));
  const cueSheet = [
    ...normalizedTracks.map(track => ({ type: track.type === 'ambience' ? 'ambience-bed' : 'music-bed', id: track.id, act: track.act, mood: track.mood, path: track.path, startSeconds: track.startSeconds, endSeconds: track.endSeconds, gainDb: track.gainDb, ducking: track.ducking })),
    ...scenes.map((scene, index) => ({ type: 'scene-mood', atSeconds: scenes.slice(0, index).reduce((sum, item) => sum + seconds(item.durationSeconds, 5), 0), act: String(scene.act || scene.actName || scene.section || 'Act ' + (index + 1)), mood: scene.musicMood || MOOD_BY_KIND[classifyScene(scene, index, scenes.length)] })),
    ...cues.map(cue => ({ type: 'sound-effect', id: cue.id, atSeconds: cue.atSeconds, path: cue.path, gainDb: cue.gainDb, kind: cue.kind })),
    ...silenceWindows.map(window => ({ type: 'intentional-silence', ...window }))
  ].sort((a, b) => a.atSeconds - b.atSeconds);
  return {
    version: 2,
    durationSeconds: total,
    music: musicPath ? { path: musicPath, gainDb: -25, ducking: true, fadeInSeconds: 1.5, fadeOutSeconds: 2.5 } : null,
    musicSegments: normalizedTracks,
    trackRightsLedger,
    musicRightsLedger: musicRightsRecord,
    musicActs: [...acts.values()].map(x => ({ ...x, durationSeconds: Number((x.endSeconds - x.startSeconds).toFixed(2)) })),
    silenceWindows,
    cueSheet,
    voice: voicePath ? { path: voicePath, targetLufs: -16, highpassHz: 80, compressorRatio: 3 } : null,
    cues,
    scenes: scenes.map((scene, index) => ({ index, startSeconds: scenes.slice(0, index).reduce((sum, item) => sum + seconds(item.durationSeconds, 5), 0),
      durationSeconds: seconds(scene.durationSeconds, 5), mood: MOOD_BY_KIND[classifyScene(scene, index, scenes.length)] })),
    mix: { targetIntegratedLufs: -14, truePeakDbtp: -1.5, musicDuckDb: -10, voicePriority: true, stereoOutput: true }
  };
}
function secureHttps(value) { try { return new URL(String(value)).protocol === 'https:'; } catch (_) { return false; } }
function validateMusicRights(record) {
  if (!record) return { passed: true, required: false, errors: [] };
  const errors = [];
  if (!record.source) errors.push('Music source is required');
  if (!record.licenseId || record.licenseId === 'unknown') errors.push('A verified music license is required');
  if (record.licenseId && !['pixabay-content-license','pexels-license','cc0','cc-by-4.0','cc-by-sa-4.0','own','purchased','ai-generated'].includes(record.licenseId)) errors.push('Unsupported or non-commercial music license');
  if (!record.commercialUseVerified) errors.push('Commercial use must be verified');
  if (!record.licenseUrl && !record.proofPath) errors.push('A license URL or local rights evidence file is required');
  if (record.licenseUrl && !secureHttps(record.licenseUrl)) errors.push('License URL must use HTTPS');
  if (record.sourceUrl && !secureHttps(record.sourceUrl)) errors.push('Source URL must use HTTPS');
  if (record.proofPath && !secureHttps(record.proofPath) && !fs.existsSync(record.proofPath)) errors.push('Local rights evidence file does not exist');
  if (record.retrievedAt && !Number.isFinite(Date.parse(record.retrievedAt))) errors.push('Rights retrieval date/time is invalid');
  if (record.attributionRequired && !String(record.attributionText || '').trim()) errors.push('Required music attribution text is missing');
  if (record.reviewStatus !== 'approved') errors.push('Music rights require explicit human approval');
  return { passed: errors.length === 0, required: true, errors };
}
module.exports = { buildSoundDesignPlan, classifyScene, CUE_LIBRARY, MOOD_BY_KIND, validateMusicRights };
