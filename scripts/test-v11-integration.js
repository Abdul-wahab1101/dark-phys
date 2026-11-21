'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildV11Job } = require('../agents/production/v11-integration');
const { buildTrackDuckFilter } = require('../agents/production/v11/src/app/pipeline');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-phys-v11-adapter-'));
try {
  const { resolveChannelId } = require('../agents/production/v11-integration');
  assert.equal(resolveChannelId({plan:{channelId:'dark-phys-ur'}}),'dark-phys-ur');
  assert.equal(resolveChannelId({}),'dark-phys-en');
  const duckedTrack = buildTrackDuckFilter({ ducking: true }, 0);
  assert.match(duckedTrack.filter, /\[mb0\]\[sc0\]sidechaincompress/);
  assert.equal(duckedTrack.label, '[md0]');
  const cleanTrack = buildTrackDuckFilter({ ducking: false }, 1);
  assert.equal(cleanTrack.filter, '[mb1]', 'non-ducked ambience/music must bypass the sidechain input');
  assert.equal(cleanTrack.label, '[mb1]');
  const narration = path.join(root, 'narration.mp3'), clip = path.join(root, 'clip.mp4'), music = path.join(root, 'music.mp3');
  fs.writeFileSync(narration, 'narration fixture'); fs.writeFileSync(clip, 'clip fixture'); fs.writeFileSync(music, 'music fixture');
  const plan = { projectId: 'test-project', title: 'Test documentary', scenes: [
    { id: 'scene-001', narration: 'An original opening.', selectedAssetId: 77, rightsApproved: true }
  ] };
  const manifest = [{ sceneId: 'scene-001', assetId: 77, downloadedFile: clip, rightsApprovedByUser: true,
    provider: 'Pixabay', sourcePage: 'https://pixabay.com/videos/test/', creator: 'Test creator',
    license: 'Pixabay Content License', retrievedAt: '2026-11-20T00:00:00.000Z' }];
  const prepared = buildV11Job({ plan, manifest, narrationPath: narration, outputPath: path.join(root, 'out', 'final.mp4'), projectDir: root });
  assert.equal(prepared.job.clips.length, 1); assert.equal(prepared.job.scenePlan[0].id, 'scene-001'); assert.equal(prepared.job.clips[0].sceneId, 'scene-001'); assert.equal(prepared.job.clips[0].assetId, 'pixabay-77');
  assert.equal(prepared.assets[0].licenseId, 'pixabay-content-license'); assert.equal(prepared.job.script, 'An original opening.');
  assert.equal(prepared.job.outPath, path.join(root, 'out', 'final.mp4')); assert.equal(prepared.root, path.join(root, '.dark-phys-v11-state'));
  assert.equal(prepared.profile.width > 0, true);
  const musicPrepared = buildV11Job({ plan: { ...plan, musicRights: { source: 'Original score', licenseId: 'own', licenseUrl: 'https://example.test/music-license', commercialUseVerified: true, reviewStatus: 'approved' }, scenes: plan.scenes.map(s => ({ ...s, durationSeconds: 5 })) }, manifest, narrationPath: narration, musicPath: music, outputPath: path.join(root, 'out', 'music.mp4'), projectDir: root });
  const actMusic = path.join(root, 'act-two.mp3'); fs.writeFileSync(actMusic, 'act two music fixture');
  const actPrepared = buildV11Job({ plan: { ...plan, scenes: plan.scenes.map(s => ({ ...s, durationSeconds: 5 })), musicSegments: [{ act: 'Act II', path: actMusic, startSeconds: 0, endSeconds: 5, mood: 'tension', rights: { source: 'Original act score', licenseId: 'own', licenseUrl: 'https://example.test/act-music-license', commercialUseVerified: true, reviewStatus: 'approved' } }] }, manifest, narrationPath: narration, outputPath: path.join(root, 'out', 'act-music.mp4'), projectDir: root });
  assert.equal(actPrepared.job.musicSegments[0].mood, 'tension');
  assert.equal(actPrepared.assets[1].kind, 'audio');
  assert.equal(actPrepared.assets[1].licenseId, 'own');
  assert.equal(actPrepared.job.musicAssetIds.length, 1);
  assert.equal(musicPrepared.assets[1].kind, 'audio');
  assert.equal(musicPrepared.assets[1].licenseId, 'own');
  assert.equal(musicPrepared.job.musicAssetId, musicPrepared.assets[1].assetId);
  const ambience = path.join(root, 'room-tone.wav'); fs.writeFileSync(ambience, 'ambience fixture');
  const ambiencePrepared = buildV11Job({ plan: { ...plan, scenes: plan.scenes.map(s => ({ ...s, durationSeconds: 5 })), ambienceSegments: [{ act: 'Act I', path: ambience, startSeconds: 0, endSeconds: 5, mood: 'natural-atmosphere', rights: { source: 'Original ambience', licenseId: 'own', licenseUrl: 'https://example.test/ambience-license', commercialUseVerified: true, reviewStatus: 'approved' } }] }, manifest, narrationPath: narration, outputPath: path.join(root, 'out', 'ambience.mp4'), projectDir: root });
  assert.equal(ambiencePrepared.job.musicSegments[0].type, 'ambience');
  assert.equal(ambiencePrepared.job.musicSegments[0].gainDb, -32);
  assert.equal(ambiencePrepared.job.soundDesignPlan.cueSheet.some(cue => cue.type === 'ambience-bed'), true);
  assert.equal(ambiencePrepared.assets[1].licenseId, 'own');

  assert.equal(musicPrepared.job.soundDesignPlan.musicRightsLedger.reviewStatus, 'approved');
  const unprovenMusic = buildV11Job({ plan: { ...plan, scenes: plan.scenes.map(s => ({ ...s, durationSeconds: 5 })), musicRights: { source: 'Claimed own music', licenseId: 'own', commercialUseVerified: true, reviewStatus: 'approved' } }, manifest, narrationPath: narration, musicPath: music, outputPath: path.join(root, 'out', 'unproven-music.mp4'), projectDir: root });
  assert.equal(unprovenMusic.assets[1].licenseId, 'unknown', 'music without a license URL or evidence file must remain blocked');
  assert.throws(() => buildV11Job({ plan, manifest: [{ ...manifest[0], rightsApprovedByUser: false }],
    narrationPath: narration, outputPath: path.join(root, 'out', 'bad.mp4'), projectDir: root }), /Rights approval/);
  assert.throws(() => buildV11Job({ plan, manifest, narrationPath: narration, outputPath: clip, projectDir: root }), /must not overwrite/);
  assert.throws(() => buildV11Job({ plan, manifest, narrationPath: narration, outputPath: narration, projectDir: root }), /must not overwrite/);
  assert.throws(() => buildV11Job({ plan, manifest, narrationPath: narration, outputPath: path.join(root, 'out', 'final.mov'), projectDir: root }), /\.mp4 extension/);

  const unknownLicense = buildV11Job({ plan, manifest: [{ ...manifest[0], license: 'unknown' }],
    narrationPath: narration, outputPath: path.join(root, 'out', 'unknown.mp4'), projectDir: root });
  assert.equal(unknownLicense.assets[0].licenseId, 'unknown', 'unknown licenses are passed to the pipeline for a blocking preflight');
  console.log('PASS v11 adapter: existing scene plan + approved Pixabay manifest -> unified production job');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
