#!/usr/bin/env node
'use strict';
/** Builds tiny synthetic inputs with ffmpeg and runs the whole pipeline once. Needs ffmpeg + ffprobe on PATH. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createProductionSystem } = require('../src');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdemo_'));
const ff = args => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };

const tone = (d, f) => ['-f', 'lavfi', '-t', String(d), '-i', 'sine=frequency=' + f + ':sample_rate=44100'];
const gap = d => ['-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=mono'];
ff([...tone(2, 220), ...gap(1.4), ...tone(2.5, 200), ...gap(0.9), ...tone(2.5, 230),
  '-filter_complex', '[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[a]', '-map', '[a]', path.join(work, 'narration.wav')]);
const clips = [0, 1, 2].map(i => {
  const p = path.join(work, 'clip' + i + '.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=6', '-vf', 'hue=h=' + i * 80, '-pix_fmt', 'yuv420p', p]);
  return { path: p, assetId: 'demo-' + i };
});

const sys = createProductionSystem({ root: path.join(work, 'state'), logger: { info: m => process.stdout.write('  ' + m + '\n') }, config: { width: 540, height: 960 } });
clips.forEach(c => sys.ledger.register({ assetId: c.assetId, kind: 'video', source: 'demo', sourceUrl: 'https://example.invalid/' + c.assetId, licenseId: 'own' }));

sys.pipeline.run({
  jobId: 'demo-1', title: 'Why Your Brain Lies To You', description: 'Demo footage is synthetic.',
  script: 'Your brain is lying to you right now. Most people never notice. Here is why.',
  segments: [{ start: 0.2, end: 2, text: 'Your brain is lying to you right now.' }, { start: 3.4, end: 5.9, text: 'Most people never notice, but you can learn to.' }, { start: 6.8, end: 9.3, text: 'Here is why it happens.' }],
  narrationPath: path.join(work, 'narration.wav'), clips, outPath: path.join(work, 'out', 'demo.mp4')
}).then(r => {
  process.stdout.write('\nstatus: ' + r.status + '\n' + JSON.stringify(r.report.summary, null, 2) + '\nfiles in ' + path.join(work, 'out') + '\n');
}).catch(e => { process.stderr.write('demo failed: ' + e.message + '\n'); process.exitCode = 1; });
