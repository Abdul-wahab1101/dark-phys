'use strict';
/** Audio operations on top of the ffmpeg runner: dead-air/filler cutting and two-pass loudness. */
const pacing = require('../core/pacing');
const { replaceFileSync } = require('../infra/file-utils');
const loud = require('../core/loudness');

class AudioService {
  constructor(runner, { target = loud.DEFAULTS.target, truePeak = loud.DEFAULTS.truePeak, lra = loud.DEFAULTS.lra } = {}) {
    this.runner = runner;
    this.opts = { target, truePeak, lra };
  }

  async detectSilences(file, { noiseDb = -35, minSilence = 0.4 } = {}) {
    const info = await this.runner.probe(file);
    const r = await this.runner.run(['-i', file, '-af', 'silencedetect=noise=' + noiseDb + 'dB:d=' + minSilence, '-f', 'null', '-'], { label: 'silencedetect' });
    return { silences: pacing.parseSilenceDetect(r.stderr, info.duration), duration: info.duration };
  }

  async applyCuts(input, keeps, output) {
    await this.runner.run(['-i', input, '-filter_complex', pacing.buildCutFilter(keeps, { audio: true }), '-map', '[aout]', '-c:a', 'pcm_s16le', output], { label: 'cut-audio' });
    return output;
  }

  async measure(file) {
    const r = await this.runner.run(['-i', file, '-vn', '-af', loud.buildMeasureFilter(this.opts), '-f', 'null', '-'], { label: 'loudness-measure' });
    return loud.parseLoudnormJson(r.stderr);
  }

  async verify(file) {
    const r = await this.runner.run(['-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { label: 'loudness-verify' });
    return loud.parseEbur128(r.stderr);
  }

  /** Two-pass normalisation. Video (if any) is copied untouched. Output is written to .part then renamed. */
  async normalize(input, output) {
    const fs = require('fs');
    const before = await this.measure(input);
    const info = await this.runner.probe(input);
    const filter = loud.buildNormalizeFilter(before, this.opts);
    const part = output + '.part.' + (info.hasVideo ? 'mp4' : 'wav');
    const args = ['-i', input];
    if (info.hasVideo) args.push('-map', '0:v:0', '-c:v', 'copy');
    args.push('-map', '0:a:0', '-af', filter, '-ar', '48000');
    args.push(...(info.hasVideo ? ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] : ['-c:a', 'pcm_s16le']), part);
    await this.runner.run(args, { label: 'loudness-normalize' });
    replaceFileSync(part, output);
    const after = await this.verify(output);
    return { before, after, assessment: loud.assessLoudness(after, { target: this.opts.target }) };
  }
}

module.exports = { AudioService };
