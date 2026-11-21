'use strict';
const path = require('path');
const { ProcessSupervisor } = require('./process-supervisor');

class FfmpegError extends Error {
  constructor(message, result) { super(message); this.name = 'FfmpegError'; this.result = result; this.transient = !!(result && (result.timedOut || result.stalled)); }
}

class FfmpegRunner {
  constructor({ ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || 'ffprobe', supervisor = new ProcessSupervisor(), defaultTimeoutMs = 20 * 60 * 1000, defaultStallMs = 90 * 1000 } = {}) {
    Object.assign(this, { ffmpeg, ffprobe, supervisor, defaultTimeoutMs, defaultStallMs });
  }

  /** Runs ffmpeg. -progress keeps stdout alive so the stall detector can tell "busy" from "hung". */
  async run(args, { cwd, timeoutMs = this.defaultTimeoutMs, stallMs = this.defaultStallMs, label = 'ffmpeg' } = {}) {
    const full = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args];
    const r = await this.supervisor.run(this.ffmpeg, full, { cwd, timeoutMs, stallMs, label });
    if (!r.ok) {
      const why = r.timedOut ? 'timed out after ' + Math.round(timeoutMs / 1000) + 's' : r.stalled ? 'produced no output for ' + Math.round(stallMs / 1000) + 's (hung)' : 'exit code ' + r.code;
      throw new FfmpegError(label + ' failed: ' + why + '. ' + r.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ').slice(0, 400), r);
    }
    return r;
  }

  async probe(file) {
    const r = await this.supervisor.run(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 60000, stallMs: 30000, label: 'ffprobe' });
    if (!r.ok) throw new FfmpegError('ffprobe failed for ' + path.basename(file), r);
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find(s => s.codec_type === 'video');
    const a = (j.streams || []).find(s => s.codec_type === 'audio');
    return { duration: parseFloat(j.format && j.format.duration) || 0, size: Number(j.format && j.format.size) || 0, width: v && v.width, height: v && v.height, hasVideo: !!v, hasAudio: !!a };
  }
}

module.exports = { FfmpegRunner, FfmpegError };
