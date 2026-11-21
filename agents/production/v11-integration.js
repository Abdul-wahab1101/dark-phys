'use strict';
/** Connects the v11 production pipeline to Dark Phys's existing approved Pixabay scene plan. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProductionSystem } = require('./v11');
const { getRenderProfile } = require('./render-profile');
const { buildSoundDesignPlan } = require('./sound-design');

function buildV11Job({ plan, manifest, narrationPath, musicPath, outputPath, projectDir, soundEffects }) {
  if (!plan || !Array.isArray(plan.scenes) || !plan.scenes.length) throw new Error('A valid Dark Phys scene plan is required.');
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('The approved Pixabay asset manifest is empty.');
  if (!narrationPath || !outputPath) throw new Error('Narration and output paths are required.');
  const narration = path.resolve(narrationPath), output = path.resolve(outputPath);
  const base = path.resolve(projectDir || path.dirname(output));
  if (!fs.existsSync(narration)) throw new Error('Approved narration file not found: ' + narration);
  const music = musicPath ? path.resolve(musicPath) : '';
  if (music && !fs.existsSync(music)) throw new Error('Music file not found: ' + music);
  const canonical = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  if ([narration, music, ...manifest.map(record => record.downloadedFile ? (path.isAbsolute(record.downloadedFile) ? record.downloadedFile : path.resolve(process.cwd(), record.downloadedFile)) : '')]
    .filter(Boolean).some(input => canonical(input) === canonical(output))) {
    throw new Error('Output path must not overwrite narration, music or an approved source clip.');
  }
  if (path.extname(output).toLowerCase() !== '.mp4') throw new Error('The v11 production output must use an .mp4 extension.');

  const scenes = new Map(plan.scenes.map(scene => [String(scene.id), scene]));
  const clips = [], assets = [], covered = new Set();
  let musicAssetId = null;
  for (const record of manifest) {
    if (record.rightsApprovedByUser !== true) throw new Error('Rights approval is missing for Pixabay asset ' + record.assetId);
    const scene = scenes.get(String(record.sceneId));
    if (!scene || scene.rightsApproved !== true || String(scene.selectedAssetId) !== String(record.assetId)) {
      throw new Error('Approved manifest does not match the selected scene asset: ' + record.sceneId);
    }
    const clipPath = path.isAbsolute(record.downloadedFile) ? record.downloadedFile : path.resolve(process.cwd(), record.downloadedFile || '');
    if (!record.downloadedFile || !fs.existsSync(clipPath)) throw new Error('Approved footage file not found: ' + clipPath);
    const assetId = 'pixabay-' + String(record.assetId);
    const licenseId = /pixabay content license/i.test(String(record.license || '')) ? 'pixabay-content-license' : 'unknown';
    clips.push({ path: clipPath, assetId, sceneId: String(record.sceneId), durationSec: Number(scene.durationSeconds) || 4, visualIntent: scene.visualIntent || scene.visual || '', shotType: scene.shotType || 'medium', movement: scene.movement || 'static', colourGrade: scene.colourGrade || 'consistent-documentary-neutral' });
    assets.push({ assetId, kind: 'video', source: record.provider || 'Pixabay',
      sourceUrl: record.sourcePage || null, author: record.creator || null, licenseId,
      retrievedAt: record.retrievedAt || undefined });
    covered.add(String(record.sceneId));
  }
  for (const scene of plan.scenes) if (!covered.has(String(scene.id))) throw new Error('Scene has no rights-approved footage: ' + scene.id);
  if (music) {
    const rights = plan.musicRights || {};
    const musicHash = crypto.createHash('sha256').update(fs.readFileSync(music)).digest('hex');
    musicAssetId = 'music-' + musicHash.slice(0, 16);
    const proofPath = rights.proofPath ? (path.isAbsolute(rights.proofPath) ? rights.proofPath : path.resolve(base, rights.proofPath)) : '';
    const rightsApproved = rights.commercialUseVerified === true && rights.reviewStatus === 'approved' &&
      (String(rights.licenseUrl || '').startsWith('https://') || (proofPath && fs.existsSync(proofPath)));
    assets.push({ assetId: musicAssetId, kind: 'audio', source: rights.source || 'Unverified local music file',
      sourceUrl: rights.sourceUrl || null, author: rights.creator || null,
      licenseId: rightsApproved ? (rights.licenseId || 'unknown') : 'unknown', licenseUrl: rights.licenseUrl || null,
      retrievedAt: rights.retrievedAt || undefined, sha256: musicHash });
  }
  const configuredAudioBeds = [
    ...(Array.isArray(plan.musicSegments) ? plan.musicSegments.map(segment => ({ ...segment, type: segment.type || 'music' })) : []),
    ...(Array.isArray(plan.ambienceSegments) ? plan.ambienceSegments.map(segment => ({ ...segment, type: 'ambience', gainDb: segment.gainDb ?? -32 })) : [])
  ];
  const musicTracks = configuredAudioBeds.map((segment, index) => {
    const trackPath = path.isAbsolute(segment.path || '') ? segment.path : path.resolve(base, segment.path || '');
    if (!segment.path || !fs.existsSync(trackPath)) throw new Error('Act-wise music track missing: ' + trackPath);
    const rights = segment.rights || plan.musicRights || {};
    const trackHash = crypto.createHash('sha256').update(fs.readFileSync(trackPath)).digest('hex');
    const assetId = 'music-' + trackHash.slice(0, 16);
    const proofPath = rights.proofPath ? (path.isAbsolute(rights.proofPath) ? rights.proofPath : path.resolve(base, rights.proofPath)) : '';
    const rightsApproved = rights.commercialUseVerified === true && rights.reviewStatus === 'approved' &&
      (String(rights.licenseUrl || '').startsWith('https://') || (proofPath && fs.existsSync(proofPath)));
    assets.push({ assetId, kind: 'audio', source: rights.source || 'Unverified act-wise music file',
      sourceUrl: rights.sourceUrl || null, author: rights.creator || null,
      licenseId: rightsApproved ? (rights.licenseId || 'unknown') : 'unknown',
      licenseUrl: rights.licenseUrl || null, retrievedAt: rights.retrievedAt || undefined, sha256: trackHash });
    return { ...segment, path: trackPath, assetId, gainDb: Number.isFinite(Number(segment.gainDb)) ? Number(segment.gainDb) : (segment.type === 'ambience' ? -32 : -25) };
  });
  if (musicTracks.some(track => canonical(track.path) === canonical(output))) throw new Error('Output path must not overwrite an act-wise music source track.');
  const script = plan.scenes.map(scene => String(scene.narration || '').trim()).filter(Boolean).join(' ');
  if (!script) throw new Error('Scene plan has no narration text.');
  const jobId = 'dark-phys-' + String(plan.projectId || 'project') + '-' + crypto.createHash('sha256').update(output).digest('hex').slice(0, 10);
  const job = { scenePlan: plan.scenes, jobId, title: String(plan.title || 'Dark Phys video'), description: String(plan.description || ''),
    script, narrationPath: narration, clips, outPath: output, hasOriginalCommentary: true,
    ...(music ? { musicPath: music, musicAssetId } : {}),
    ...(musicTracks.length ? { musicSegments: musicTracks, musicAssetIds: musicTracks.map(x => x.assetId) } : {}),
    ...(plan.captionsAss ? { captionsAss: path.resolve(plan.captionsAss) } : {}),
    ...(plan.thumbnail && plan.thumbnail.path ? { thumbnail: { ...plan.thumbnail, path: path.resolve(plan.thumbnail.path) } } : {}) };
  let soundLibrary = Array.isArray(soundEffects) ? soundEffects : (Array.isArray(plan.soundEffects) ? plan.soundEffects : []);
  const soundManifest = plan.soundEffectsManifest ? path.resolve(base, plan.soundEffectsManifest) : path.join(base, 'sound-effects', 'manifest.json');
  if (!soundLibrary.length && fs.existsSync(soundManifest)) {
    const parsed = JSON.parse(fs.readFileSync(soundManifest, 'utf8'));
    soundLibrary = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.assets) ? parsed.assets : []);
  }
  const soundDesignPlan = buildSoundDesignPlan({ scenes: plan.scenes, library: soundLibrary,
    durationSeconds: plan.scenes.reduce((sum, scene) => sum + (Number(scene.durationSeconds) || 5), 0),
    musicPath: music, voicePath: narration, musicRights: plan.musicRights || {}, musicSegments: musicTracks });
  soundDesignPlan.cues = soundDesignPlan.cues.map(cue => {
    const resolved = path.isAbsolute(cue.path) ? cue.path : path.resolve(base, cue.path);
    if (!fs.existsSync(resolved)) throw new Error('Sound effect asset not found: ' + resolved);
    return { ...cue, path: resolved };
  });
  job.soundDesignPlan = soundDesignPlan;
  const profile = getRenderProfile();
  return { job, assets, root: path.join(base, '.dark-phys-v11-state'), profile };
}

async function runApprovedProduction(options) {
  const prepared = buildV11Job(options);
  const system = createProductionSystem({ root: prepared.root, logger: options.logger || null,
    config: { width: prepared.profile.width, height: prepared.profile.height, fps: prepared.profile.fps, maxAttempts: 2, backoffMs: 1500 } });
  const registered = system.ledger.records().assets;
  for (const asset of prepared.assets) {
    const current = registered.get(asset.assetId);
    const changed = !current || ['kind', 'source', 'sourceUrl', 'author', 'licenseId', 'licenseUrl', 'retrievedAt']
      .some(key => String(current[key] || '') !== String(asset[key] || ''));
    // Append a new ledger version when source/licence metadata changes so cached preflight
    // fingerprints cannot keep trusting an older approval record.
    if (changed) system.ledger.register(asset);
  }
  const result = await system.pipeline.run(prepared.job);
  if (['ready', 'review'].includes(result.status) && fs.existsSync(path.resolve(options.outputPath))) {
    const safety = require('./monetization-safety');
    const channelId = String(options.channelId || options.plan.channelId || 'unassigned');
    const history = safety.readChannelStore(channelId, options.historyRoot);
    const reviewed = await safety.reviewRenderedOutput({
      outputPath: options.outputPath, channelId, videoId: options.plan.projectId || path.basename(options.outputPath),
      title: options.plan.title || prepared.job.title, script: prepared.job.script,
      editorialAngle: options.plan.editorialAngle || '', scenes: options.plan.scenes,
      templateId: options.plan.templateId || '', layoutId: options.plan.layoutId || '',
      structureFingerprint: options.plan.structureFingerprint || '',
      channelHistory: history.episodes, uploadHistory: history.uploads,
      realisticSyntheticMedia: options.plan.realisticSyntheticMedia === true,
      syntheticDisclosureDecision: options.plan.syntheticDisclosureDecision || 'not_applicable',
      deceptiveRealScene: options.plan.deceptiveRealScene === true
    });
    return { ...result, status: reviewed.report.autoHold ? 'held_for_monetization_review' : result.status,
      engine: 'v11', renderProfile: prepared.profile, monetizationSafety: reviewed.report,
      riskReportFiles: reviewed.files, audioPath: reviewed.audioPath, quarantinePath: reviewed.quarantinePath };
  }
  return { ...result, engine: 'v11', renderProfile: prepared.profile };
}
module.exports = { buildV11Job, runApprovedProduction };
