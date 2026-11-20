'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildV11Job } = require('../agents/production/v11-integration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-phys-v11-adapter-'));
try {
  const narration = path.join(root, 'narration.mp3'), clip = path.join(root, 'clip.mp4');
  fs.writeFileSync(narration, 'narration fixture'); fs.writeFileSync(clip, 'clip fixture');
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
