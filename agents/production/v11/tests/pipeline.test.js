'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FfmpegRunner } = require('../src/infra/ffmpeg-runner');
const { CheckpointStore } = require('../src/infra/checkpoint-store');
const { TempManager } = require('../src/infra/temp-manager');
const { MemoryStore } = require('../src/infra/jsonl-store');
const { LicenseLedger } = require('../src/core/license-ledger');
const { AudioService } = require('../src/app/audio-service');
const { ProductionPipeline } = require('../src/app/pipeline');
const h = require('./helpers');

const SEGMENTS = [
  { start: 0.2, end: 2.0, text: 'Your brain is lying to you right now.' },
  { start: 3.6, end: 5.6, text: 'Most people miss these 3 tricks, but the last one is the most dangerous.' },
  { start: 6.3, end: 8.8, text: 'Stay until the end and you will see why.' },
  { start: 9.1, end: 11.1, text: 'Your choices are not really yours.' }
];

function setup(dir, { runner = new FfmpegRunner(), licenseOverrides = {} } = {}) {
  const nar = h.makeNarration(path.join(dir, 'nar.wav'));
  const clips = [1, 2, 3].map(i => { const f = path.join(dir, 'clip' + i + '.mp4'); h.makeClip(f, { seconds: 6, hue: i * 60 }); return { path: f, assetId: 'pix-' + i }; });
  const music = path.join(dir, 'music.mp3'); h.makeTone(music, { seconds: 20, freq: 330 });
  const ass = path.join(dir, 'cap.ass');
  fs.writeFileSync(ass, '[Script Info]\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,0,2,40,40,300,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,0:00:00.20,0:00:02.00,Default,,0,0,0,,Your brain is lying\nDialogue: 0,0:00:06.30,0:00:08.80,Default,,0,0,0,,Stay until the end\n');
  const ledger = new LicenseLedger(new MemoryStore());
  clips.forEach(c => ledger.register({ assetId: c.assetId, kind: 'video', source: 'pixabay', sourceUrl: 'https://pixabay.com/v/' + c.assetId, author: 'Tester', licenseId: 'pixabay-content-license', ...(licenseOverrides[c.assetId] || {}) }));
  const root = path.join(dir, 'root');
  const checkpoints = new CheckpointStore(path.join(root, 'cp'));
  const temp = new TempManager({ baseDir: path.join(root, 'work') });
  const pipeline = new ProductionPipeline({ runner, audio: new AudioService(runner), checkpoints, temp, ledger, sleep: async () => {}, config: { width: 360, height: 640, fps: 25, backoffMs: 0 } });
  const job = {
    jobId: 'job-1', title: '3 Tricks Your Brain Uses', description: 'Footage: Pixabay', script: SEGMENTS.map(s => s.text).join(' '),
    segments: SEGMENTS, narrationPath: nar.file, clips, musicPath: music, captionsAss: ass, outPath: path.join(dir, 'out', 'final.mp4'), hasOriginalCommentary: true
  };
  return { job, pipeline, checkpoints, temp, ledger, root };
}

test('full run: cuts dead air, plans interrupts, renders 9:16, normalises loudness, writes report, cleans temp', async () => {
  const dir = h.tmp();
  try {
    const { job, pipeline, temp } = setup(dir);
    const r = await pipeline.run(job);
    assert.ok(['ready', 'review'].includes(r.status), r.status + ' ' + JSON.stringify(r.report.mustFix));
    const info = await new FfmpegRunner().probe(job.outPath);
    assert.equal(info.width, 360); assert.equal(info.height, 640); assert.equal(info.hasAudio, true);
    const clean = r.data['audio-clean'];
    assert.ok(clean.removedSec > 1.4, 'removed ' + clean.removedSec);
    assert.ok(Math.abs(info.duration - clean.durationAfter) < 0.5);
    assert.ok(r.data.interrupts.interrupts.length >= 2);
    const ld = r.data.loudness;
    assert.ok(Math.abs(ld.after.integrated - -14) <= 1.0, 'loudness ' + ld.after.integrated);
    assert.equal(ld.assessment.pass, true);
    assert.ok(fs.existsSync(job.outPath.replace(/\.mp4$/, '.report.md')));
    assert.equal(fs.existsSync(temp.dirFor(job.jobId)), false, 'job work folder removed after success');
    assert.deepEqual(fs.readdirSync(path.dirname(job.outPath)).filter(n => n.includes('.part')), []);
  } finally { h.rm(dir); }
});

test('crash during render then re-run: resumes finished stages and chunks, output is correct', async () => {
  const dir = h.tmp();
  try {
    const real = new FfmpegRunner();
    const flaky = Object.create(real);
    let failShot = true;
    flaky.run = (args, opts) => (failShot && opts && opts.label === 'render shot_002') ? Promise.reject(new Error('simulated power cut')) : real.run(args, opts);
    const s = setup(dir, { runner: flaky });
    await assert.rejects(s.pipeline.run(s.job), /simulated power cut/);
    assert.equal(fs.existsSync(s.job.outPath), false);
    assert.equal(fs.existsSync(s.temp.dirFor(s.job.jobId)), true, 'work folder kept for resume');
    assert.deepEqual(s.checkpoints.listJobs(), ['job-1']);

    failShot = false;
    const r = await s.pipeline.run(s.job);
    assert.ok(['audio-clean', 'hook', 'shot-plan', 'preflight', 'interrupts'].every(n => r.resumed.includes(n)), 'resumed: ' + r.resumed);
    assert.ok(r.data['render-shots'].resumedChunks >= 2, 'chunks resumed ' + r.data['render-shots'].resumedChunks);
    assert.ok(r.data['render-shots'].renderedChunks >= 1);
    assert.ok(fs.existsSync(s.job.outPath));
  } finally { h.rm(dir); }
});

test('licence block stops the run BEFORE any rendering', async () => {
  const dir = h.tmp();
  try {
    const s = setup(dir, { licenseOverrides: { 'pix-2': { licenseId: 'cc-by-nc-4.0' } } });
    const r = await s.pipeline.run(s.job);
    assert.equal(r.status, 'blocked');
    assert.ok(r.data.preflight.license.findings.some(f => f.id === 'non_commercial_license' && f.assetId === 'pix-2'));
    assert.equal(fs.existsSync(s.job.outPath), false);
    assert.equal(r.data['render-shots'], undefined);
    // A rights-ledger change is a production input change: restart all stages rather than reuse
    // outputs that were prepared under the previous approval state.
    s.ledger.register({ assetId: 'pix-2', kind: 'video', source: 'pixabay', sourceUrl: 'https://pixabay.com/v/pix-2', author: 'Tester', licenseId: 'pixabay-content-license' });
    const again = await s.pipeline.run(s.job);
    assert.ok(['ready', 'review'].includes(again.status), again.status);
    assert.deepEqual(again.resumed, [], 'rights change invalidates all downstream production stages');
    assert.ok(fs.existsSync(s.job.outPath));
  } finally { h.rm(dir); }
});

test('changed inputs invalidate the checkpoint; bad jobs are rejected early', async () => {
  const dir = h.tmp();
  try {
    const s = setup(dir);
    await assert.rejects(s.pipeline.run({ ...s.job, jobId: undefined }), /jobId/);
    await assert.rejects(s.pipeline.run({ ...s.job, clips: [] }), /clips/);
    await assert.rejects(s.pipeline.run({ ...s.job, narrationPath: '/nope.wav' }), /not found/);
    const first = await s.pipeline.run(s.job);
    assert.ok(first.status);
    s.job.script += ' extra';
    const second = await s.pipeline.run(s.job);
    assert.deepEqual(second.resumed, [], 'nothing reused after inputs changed');
  } finally { h.rm(dir); }
});

test('checkpoint fingerprint changes when review, rights, captions, thumbnail or render settings change', () => {
  const dir = h.tmp();
  try {
    const s = setup(dir);
    const base = s.pipeline.fingerprint(s.job);
    assert.notEqual(s.pipeline.fingerprint({ ...s.job, description: 'updated rights credit' }), base);
    assert.notEqual(s.pipeline.fingerprint({ ...s.job, hasOriginalCommentary: false }), base);
    assert.notEqual(s.pipeline.fingerprint({ ...s.job, realisticAiDisclosed: false }), base);
    assert.notEqual(s.pipeline.fingerprint({ ...s.job, segments: [...SEGMENTS, { start: 12, end: 13, text: 'new segment' }] }), base);
    assert.notEqual(s.pipeline.fingerprint({ ...s.job, thumbnail: { path: s.job.narrationPath, text: 'new thumbnail copy' } }), base);
    const originalWidth = s.pipeline.cfg.width;
    s.pipeline.cfg.width = originalWidth + 2;
    assert.notEqual(s.pipeline.fingerprint(s.job), base, 'render configuration is part of the checkpoint fingerprint');
    s.pipeline.cfg.width = originalWidth;
    s.ledger.register({ assetId: 'pix-1', kind: 'video', source: 'pixabay', sourceUrl: 'https://pixabay.com/v/pix-1', author: 'Tester', licenseId: 'cc-by-nc-4.0' });
    const afterRightsChange = s.pipeline.fingerprint(s.job);
    assert.notEqual(afterRightsChange, base, 'updated licence ledger forces preflight to run again');
    s.ledger.recordVideo('another-channel-video', { title: 'Earlier video', scriptText: 'A different script', hookText: 'Different hook' });
    s.ledger.recordUsage('another-channel-video', 'pix-1', { secondsUsed: 2, uses: 1 });
    assert.notEqual(s.pipeline.fingerprint(s.job), afterRightsChange, 'new channel history forces reuse-risk preflight to run again');
  } finally { h.rm(dir); }
});

test('workspace creation failure releases the job lock for a safe retry', async () => {
  const dir = h.tmp();
  try {
    const s = setup(dir);
    s.temp.create = () => { throw new Error('simulated disk full'); };
    await assert.rejects(s.pipeline.run(s.job), /simulated disk full/);
    const release = s.checkpoints.acquire(s.job.jobId);
    release();
  } finally { h.rm(dir); }
});
