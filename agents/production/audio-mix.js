'use strict';

function finite(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function buildAudioFilter(options = {}) {
  const voiceGain = finite(options.voiceGainDb, 0, -24, 12);
  const musicGain = finite(options.musicGainDb, -25, -48, 0);
  const targetLufs = finite(options.targetLufs, -14, -24, -10);
  const truePeak = finite(options.truePeakDbtp, -1.5, -3, -0.5);
  const sfx = Array.isArray(options.sfx) ? options.sfx : [];
  const chains = [];
  const voice = '[1:a]volume=' + voiceGain + 'dB,highpass=f=80,' +
    'equalizer=f=240:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1:g=1.5,' +
    'acompressor=threshold=0.10:ratio=3:attack=12:release=180:makeup=2';
  if (options.voiceProcessing === false) {
    chains.push('[1:a]volume=' + voiceGain + 'dB,asplit=2[voicekey][voicemix]');
  } else if (options.duckMusic === false) {
    chains.push(voice + '[voicemix]');
  } else {
    chains.push(voice + ',asplit=2[voicekey][voicemix]');
  }
  if (options.duckMusic === false) {
    chains.push('[2:a]volume=' + musicGain + 'dB[musicduck]');
  } else {
    chains.push('[2:a]volume=' + musicGain + 'dB[musicbase]');
    chains.push('[musicbase][voicekey]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=450:makeup=1[musicduck]');
  }
  const inputs = ['[voicemix]', '[musicduck]'];
  sfx.forEach((item, index) => {
    if (!item || !item.path) throw new Error('Every sound effect needs a path.');
    const inputIndex = index + 3;
    const gain = finite(item.gainDb, -18, -48, 0);
    const delay = Math.round(finite(item.atSeconds, 0, 0, 86400) * 1000);
    const label = 'sfx' + index;
    chains.push('[' + inputIndex + ':a]volume=' + gain + 'dB,afade=t=in:st=0:d=0.015,adelay=' + delay + '|' + delay + '[' + label + ']');
    inputs.push('[' + label + ']');
  });
  chains.push(inputs.join('') + 'amix=inputs=' + inputs.length +
    ':duration=first:dropout_transition=2:normalize=0,' +
    'alimiter=limit=0.95,loudnorm=I=' + targetLufs + ':TP=' + truePeak + ':LRA=11[aout]');
  return { filter: chains.join(';'), output: '[aout]', targetIntegratedLufs: targetLufs, truePeakDbtp: truePeak };
}
function ffmpegArgs({ video, voice, music, output, filter, sfx = [], profile = {}, mix = {} }) {
  if (!video || !voice || !music || !output) throw new Error('video, voice, music and output paths are required.');
  const args = ['-y', '-i', video, '-i', voice, '-stream_loop', '-1', '-i', music];
  for (const item of sfx) {
    if (!item || !item.path) throw new Error('Every sound effect needs a path.');
    args.push('-i', item.path);
  }
  const audio = filter || buildAudioFilter({ ...mix, sfx }).filter;
  args.push('-filter_complex', audio, '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', profile.preset || 'ultrafast',
    '-crf', String(profile.crf == null ? 26 : profile.crf),
    '-threads', String(profile.threads || 2), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', output);
  return args;
}
module.exports = { buildAudioFilter, ffmpegArgs };
