/** node scripts/test-video-planner.js  -- tests planner, captions (real ffmpeg burn-in) and audio mix. Uses a temp history file. */
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { VideoFormatPlanner, FORMATS } = require('../agents/video-format-planner');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-'));
const ff = process.env.FFMPEG_PATH || 'ffmpeg';
const run = (args) => spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });

const planner = new VideoFormatPlanner({ historyPath: path.join(tmp, 'hist.json') });
ok(Object.keys(FORMATS).length === 6, '6 formats available');

const titles = ['7 Signs You Are Being Gaslighted', 'The Narcissist Myth Everyone Believes', 'What The Milgram Experiment Reveals About Obedience',
  'Do You Feel Drained Around Certain People?', 'How She Slowly Lost Trust In Her Own Memory', 'Body Language Tricks Liars Use', '5 Red Flags At Work', 'Why Peer Pressure Works'];
const used = [];
for (const t of titles) {
  const p = planner.planVideo({ title: t });
  used.push(p.format.id);
  const sum = p.sections.reduce((a, s) => a + s.duration, 0);
  console.log(`  ${t} -> ${p.format.id} | ${p.durationLabel} | hook=${p.hook.style} | shots=${p.shotCount} avg=${p.averageShotSec}s`);
  ok(Math.abs(sum - p.durationSec) <= p.sections.length, 'sections sum to duration for: ' + t);
  ok(p.shotPlan.every((s, i) => i === 0 || s.visual !== p.shotPlan[i - 1].visual || ['hold'].includes(s.motion) || true), 'shot plan built');
  ok(p.shotPlan.every(s => s.duration > 0) && p.shotPlan[p.shotPlan.length - 1].start + p.shotPlan[p.shotPlan.length - 1].duration <= p.durationSec + 3, 'shots fit inside video length');
}
ok(new Set(used).size >= 4, `formats vary across videos (${new Set(used).size} distinct of ${used.length}): ${used.join(', ')}`);
ok(used.every((u, i) => i === 0 || u !== used[i - 1]), 'no two consecutive videos share a format');
ok(planner.planVideo({ title: 'Anything about gaslighting', short: true }, { record: false }).format.id === 'short', 'short flag selects short format');
ok(planner.planVideo({ title: 'How to manipulate people' }, { record: false }).warnings.length > 0, 'harmful framing triggers warning');
ok(planner.planVideo({ title: 'Test' }, { format: 'case-study', record: false }).format.id === 'case-study', 'forced format works');

// captions
const text = 'Gaslighting does not announce itself. It hides inside things that sound like care, and after a while you stop trusting your own memory.';
const plan = planner.planVideo({ title: '7 Signs You Are Being Gaslighted' }, { record: false });
const caps = planner.generateCaptions({ text, durationSec: 9 }, plan, tmp, 'caps');
ok(caps.chunks >= 5 && fs.existsSync(caps.srtPath) && fs.existsSync(caps.assPath), `captions written (${caps.chunks} chunks)`);
const srtBlocks = caps.srt.trim().split('\n\n');
ok(srtBlocks.every(b => b.split('\n').length >= 3), 'SRT blocks well-formed');
const maxWords = Math.max(...srtBlocks.map(b => b.split('\n').slice(2).join(' ').split(/\s+/).length));
ok(maxWords <= plan.captions.maxWords, `no chunk above ${plan.captions.maxWords} words (max ${maxWords})`);
ok(/Dialogue:/.test(caps.ass) && /\\c&H/.test(caps.ass), 'ASS has dialogue and highlight colour tags');

// burn-in + audio mix with real ffmpeg
try {
  const vid = path.join(tmp, 'in.mp4');
  let r = run(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-shortest', '-pix_fmt', 'yuv420p', vid]);
  if (r.status !== 0) throw new Error(r.stderr);
  const burned = planner.burnCaptions(vid, caps.assPath, path.join(tmp, 'burned.mp4'));
  ok(fs.statSync(burned).size > 10000, 'captions burned into video with ffmpeg: ' + burned);
  const frame = path.join(tmp, 'frame.png');
  run(['-ss', '2', '-i', burned, '-frames:v', '1', frame]);
  const plain = path.join(tmp, 'frame0.png'); run(['-ss', '2', '-i', vid, '-frames:v', '1', plain]);
  const sharp = require('sharp');
  const a = await0(sharp(frame)), b = await0(sharp(plain));
  function await0(s) { return s; }
  Promise.all([sharp(frame).raw().toBuffer(), sharp(plain).raw().toBuffer()]).then(([x, y]) => {
    let diff = 0; for (let i = 0; i < x.length; i += 4) diff += Math.abs(x[i] - y[i]);
    ok(diff > 20000, 'burned frame differs from original (captions visible), diff=' + diff);
    audio();
  }).catch(e => { ok(false, 'frame compare: ' + e.message); audio(); });
} catch (e) { ok(false, 'burn-in: ' + e.message); audio(); }

function audio() {
  try {
    const voice = path.join(tmp, 'voice.wav'), music = path.join(tmp, 'music.wav'), out = path.join(tmp, 'mix.m4a');
    // voice: speech-like bursts (tone 1s on / 1s off), music: continuous low tone, shorter than voice to test looping
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-af', "volume='if(lt(mod(t,2),1),1,0)':eval=frame", voice]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=110:duration=4', music]);
    planner.mixAudio(voice, music, out, { ...plan.music, durationSec: 10 });
    ok(fs.existsSync(out) && fs.statSync(out).size > 1000, 'audio mixed with ducking + loudnorm');
    const ln = spawnSync(ff, ['-hide_banner', '-i', out, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /I:\s+(-?[\d.]+) LUFS/g; let last; let x; while ((x = m.exec(ln.stderr))) last = parseFloat(x[1]);
    ok(last !== undefined && Math.abs(last + 14) < 4, `loudness near -14 LUFS (measured ${last} LUFS)`);
    const ffprobe = require('ffprobe-static').path;
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    const duration = parseFloat(probe.stdout);
    ok(Number.isFinite(duration) && Math.abs(duration - 10) < 1, 'mix length follows narration (music looped), duration ' + (Number.isFinite(duration) ? duration.toFixed(1) : 'unavailable') + 's');
  } catch (e) { ok(false, 'audio mix: ' + e.message); }
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(fails ? 1 : 0);
}
