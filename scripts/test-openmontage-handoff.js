'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const script = path.join(__dirname, 'export-openmontage.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-phys-om-'));
function run(args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
try {
  const missing = run(['--title', 'Test Long', '--mode', 'long', '--output', path.join(tmp, 'out')]);
  if (missing.status === 0 || !missing.stderr.includes('--script')) throw new Error('Long-form script requirement not enforced');
  const scriptFile = path.join(tmp, 'script.txt');
  fs.writeFileSync(scriptFile, 'Approved narration sample.');
  const long = run(['--title', 'Test Long', '--script', scriptFile, '--mode', 'long', '--output', path.join(tmp, 'out')]);
  if (long.status !== 0) throw new Error(long.stderr);
  const longDir = path.join(tmp, 'out', 'test-long');
  const brief = JSON.parse(fs.readFileSync(path.join(longDir, 'dark-phys-brief.json'), 'utf8'));
  if (brief.production.pipeline !== 'animated-explainer' || brief.production.acceptable_duration_seconds[0] !== 480) throw new Error('Long-form profile incorrect');
  if (!fs.readFileSync(path.join(longDir, 'OPENMONTAGE-PROMPT.md'), 'utf8').includes('8–12 minute')) throw new Error('Long prompt missing');
  const video = path.join(tmp, 'source.mp4'); fs.writeFileSync(video, 'fixture');
  const shorts = run(['--title', 'Test Shorts', '--source-video', video, '--mode', 'shorts', '--output', path.join(tmp, 'out')]);
  if (shorts.status !== 0) throw new Error(shorts.stderr);
  const shortBrief = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'test-shorts', 'dark-phys-brief.json'), 'utf8'));
  if (shortBrief.production.pipeline !== 'clip-factory' || shortBrief.production.aspect_ratio !== '9:16' || shortBrief.production.target_clip_count !== 5) throw new Error('Shorts profile incorrect');
  console.log('PASS: long-form handoff, shorts handoff, required-input guards');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
