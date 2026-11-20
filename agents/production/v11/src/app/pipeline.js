'use strict';
/**
 * Orchestrates the production run. Stages are checkpointed: re-running a job resumes at the first stage whose
 * recorded outputs are missing or changed. Cheap checks (licence, reuse, thumbnail) run BEFORE the expensive render.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pacing = require('../core/pacing');
const { analyzeHook, segmentsFromScript } = require('../core/hook');
const { planPatternInterrupts, validateInterruptPlan, buildInterruptFilter } = require('../core/interrupts');
const { assessReuse } = require('../core/reuse-risk');
const { planShots, planSceneShots, shotArgs } = require('./shot-planner');
const { ChunkedRenderer } = require('./chunked-renderer');
const { buildReport, toMarkdown } = require('./report');
const { hashFile, safeName, replaceFileSync } = require('../infra/file-utils');
const { analyzeThumbnail } = require('../infra/thumbnail-pixels');

const ORDER = ['audio-clean', 'hook', 'shot-plan', 'preflight', 'interrupts', 'render-shots', 'mux', 'loudness', 'finalize'];
const DEFAULT_CONFIG = { width: 1080, height: 1920, fps: 30, hookWindowSec: 15, maxAttempts: 2, backoffMs: 1500, aggressiveFillers: false, tailPadSec: 0.4 };

class ProductionPipeline {
  constructor({ runner, audio, checkpoints, temp, ledger, thumbnailAnalyzer = analyzeThumbnail, logger = null, sleep = ms => new Promise(r => setTimeout(r, ms)), config = {} }) {
    Object.assign(this, { runner, audio, checkpoints, temp, ledger, thumbnailAnalyzer, logger, sleep });
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.renderer = new ChunkedRenderer(runner);
  }

  log(m) { if (this.logger) this.logger.info(m); }

  fingerprint(job) {
    // A checkpoint is reusable only when every input that can affect a stage is unchanged.
    // Include approval metadata and the current ledger records: otherwise a previously-cleared
    // preflight could be reused after an asset's licence/rights record or review decision changes.
    const stat = p => {
      if (!p) return null;
      try {
        const s = fs.statSync(p);
        return { path: path.resolve(p), size: s.size, mtimeMs: s.mtimeMs, ino: Number(s.ino) || 0 };
      } catch (_) { return { path: path.resolve(p), missing: true }; }
    };
    const ledgerAssets = this.ledger.records().assets;
    const clips = (job.clips || []).map(c => ({
      file: stat(c.path), assetId: c.assetId,
      ledger: ledgerAssets.get(c.assetId) || null
    }));
    const thumbnail = job.thumbnail ? {
      file: stat(job.thumbnail.path), text: job.thumbnail.text || '',
      textBoxes: job.thumbnail.textBoxes || []
    } : null;
    const inputs = {
      title: job.title, description: job.description || '', script: job.script || '',
      segments: job.segments || null, words: job.words || null, scenePlan: job.scenePlan || null, soundDesignPlan: job.soundDesignPlan || null,
      narration: stat(job.narrationPath), music: stat(job.musicPath),
      clips, captions: stat(job.captionsAss), thumbnail,
      hasOriginalCommentary: job.hasOriginalCommentary !== false,
      realisticAiDisclosed: job.realisticAiDisclosed ?? null,
      // Reuse-risk preflight depends on prior channel videos; exclude this job so its own
      // checkpoint writes do not invalidate themselves, but include every other video.
      channelHistory: this.ledger.historyByVideo().filter(video => video.videoId !== job.jobId),
      outPath: path.resolve(job.outPath), config: this.cfg
    };
    return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
  }

  async run(job) {
    this.validateJob(job);
    const release = this.checkpoints.acquire(job.jobId);
    let dir = null;
    let ok = false;
    try {
      // Create the workspace inside the guarded block so a disk/permission failure
      // cannot strand the job lock and block every subsequent retry.
      dir = this.temp.create(job.jobId);
      this.temp.cleanupStale({ isResumable: id => this.checkpoints.listJobs().includes(safeName(id)) });
      let state = this.checkpoints.load(job.jobId);
      const fp = this.fingerprint(job);
      if (state.meta.fingerprint && state.meta.fingerprint !== fp) { this.log('inputs changed; starting over'); this.checkpoints.reset(job.jobId); state = this.checkpoints.fresh(job.jobId); }
      state.meta.fingerprint = fp;

      const ctx = { job, dir, state, data: {}, cfg: this.cfg };
      const resumed = [];
      for (const name of ORDER) {
        const rec = state.stages[name];
        if (this.checkpoints.isValid(rec)) { ctx.data[name] = rec.data; resumed.push(name); continue; }
        this.checkpoints.invalidateFrom(state, name, ORDER);
        const result = await this.attempt(name, ctx);
        ctx.data[name] = result.data;
        state.stages[name] = { status: result.halt ? 'halted' : 'done', data: result.data, outputs: this.checkpoints.describeFiles(result.outputs || []), finishedAt: Date.now() };
        this.checkpoints.save(state);
        this.temp.touch(dir);
        if (result.halt) return { jobId: job.jobId, status: result.halt, resumed, report: ctx.data.report || null, data: ctx.data };
      }
      ok = true;
      return { jobId: job.jobId, status: ctx.data.finalize.report.status, resumed, report: ctx.data.finalize.report, outPath: job.outPath, data: ctx.data };
    } finally {
      release();
      if (dir) {
        try { if (ok) this.temp.remove(dir); else this.temp.sweepJunk(dir); }
        finally { this.temp.release(dir); }
      }
    }
  }

  validateJob(job) {
    const need = ['jobId', 'title', 'narrationPath', 'outPath'];
    for (const k of need) if (!job[k]) throw new Error('job.' + k + ' is required');
    if (!Array.isArray(job.clips) || !job.clips.length) throw new Error('job.clips must list at least one clip {path, assetId}');
    if (!fs.existsSync(job.narrationPath)) throw new Error('narration file not found: ' + job.narrationPath);
    for (const c of job.clips) if (!c.assetId || !fs.existsSync(c.path)) throw new Error('clip missing or has no assetId: ' + c.path);
    for (const cue of (job.soundDesignPlan && job.soundDesignPlan.cues) || []) if (!cue.path || !fs.existsSync(cue.path)) throw new Error('sound design cue missing: ' + (cue.path || 'path not set'));
  }

  async attempt(name, ctx) {
    const fn = this['stage_' + name.replace(/-/g, '_')].bind(this);
    const retry = ['audio-clean', 'render-shots', 'mux', 'loudness'].includes(name) ? this.cfg.maxAttempts : 1;
    let lastErr;
    for (let i = 1; i <= retry; i++) {
      try { return await fn(ctx); } catch (e) {
        lastErr = e;
        ctx.state.stages[name] = { status: 'failed', error: String(e.message).slice(0, 500), attempts: i };
        this.checkpoints.save(ctx.state);
        this.log('stage ' + name + ' failed (attempt ' + i + '/' + retry + '): ' + e.message);
        if (i < retry) await this.sleep(this.cfg.backoffMs * i);
      }
    }
    throw lastErr;
  }

  /* ----------------------------- stages ----------------------------- */

  async stage_audio_clean({ job, dir, cfg }) {
    const { silences, duration } = await this.audio.detectSilences(job.narrationPath);
    const plan = pacing.planCuts({ duration, words: job.words || [], silences, aggressive: cfg.aggressiveFillers });
    const out = path.join(dir, 'cleaned.wav');
    await this.audio.applyCuts(job.narrationPath, plan.keeps, out);
    const info = await this.runner.probe(out);
    const estimated = !job.segments;
    const segments = estimated ? segmentsFromScript(job.script || '') : pacing.remapSegments(job.segments, plan.keeps);
    return {
      outputs: [out],
      data: { keeps: plan.keeps, cuts: plan.cuts, removedSec: plan.removedSec, byReason: plan.byReason, capped: plan.capped, durationBefore: duration, durationAfter: info.duration, deadAir: pacing.deadAirStats(silences, duration), segments, segmentsEstimated: estimated, cleaned: out }
    };
  }

  async stage_hook({ job, data, cfg }) { return { data: analyzeHook({ title: job.title, segments: data['audio-clean'].segments, windowSec: cfg.hookWindowSec }) }; }

  async stage_shot_plan({ job, data, cfg }) {
    const clips = [];
    for (const c of job.clips) clips.push({ ...c, duration: (await this.runner.probe(c.path)).duration });
    const total = data['audio-clean'].durationAfter + cfg.tailPadSec;
    const plan = Array.isArray(job.scenePlan) && job.scenePlan.length
      ? planSceneShots({ scenes: job.scenePlan, clips, totalSec: total })
      : planShots({ clips, totalSec: total, seed: job.jobId });
    const usage = [...plan.usage];
    if (job.musicAssetId && !(Array.isArray(job.musicSegments) && job.musicSegments.length)) usage.push({ assetId: job.musicAssetId, secondsUsed: total, uses: 1 });
    for (const assetId of (Array.isArray(job.musicAssetIds) ? job.musicAssetIds : [])) {
      const segment = (job.musicSegments || []).find(x => x.assetId === assetId);
      const segmentDuration = segment ? Number(segment.endSeconds) - Number(segment.startSeconds) : NaN;
      usage.push({ assetId, secondsUsed: Number.isFinite(segmentDuration) && segmentDuration > 0 ? segmentDuration : total, uses: 1 });
    }
    this.ledger.setUsage(job.jobId, usage);
    const hookText = data['audio-clean'].segments.filter(s => s.start < cfg.hookWindowSec).map(s => s.text).join(' ');
    this.ledger.recordVideo(job.jobId, { title: job.title, scriptText: job.script || '', hookText });
    return { data: { shots: plan.shots, usage: plan.usage, totalSec: total, hookText } };
  }

  async stage_preflight({ job, data }) {
    const hashes = new Map();
    for (const c of job.clips) hashes.set(c.assetId, await hashFile(c.path));
    const license = this.ledger.auditVideo(job.jobId, { description: job.description || '', hashOf: id => hashes.get(id) || null, realisticAiDisclosed: job.realisticAiDisclosed === undefined ? null : job.realisticAiDisclosed });
    const reuse = assessReuse({
      videoId: job.jobId, durationSec: data['shot-plan'].totalSec,
      assets: data['shot-plan'].usage.map(u => ({ ...u, sha256: hashes.get(u.assetId) })),
      history: this.ledger.historyByVideo(), script: job.script || '', hookText: data['shot-plan'].hookText,
      hasOriginalCommentary: job.hasOriginalCommentary !== false
    });
    let thumbnail = null;
    if (job.thumbnail && job.thumbnail.path) thumbnail = await this.thumbnailAnalyzer(job.thumbnail.path, { textBoxes: job.thumbnail.textBoxes || [], text: job.thumbnail.text || '' });
    const blocked = license.level === 'block' || reuse.level === 'block';
    return { data: { license, reuse, thumbnail }, halt: blocked ? 'blocked' : undefined };
  }

  async stage_interrupts({ job, data, cfg }) {
    const durationSec = data['audio-clean'].durationAfter;
    const plan = planPatternInterrupts({ durationSec, segments: data['audio-clean'].segments, hookWindowSec: cfg.hookWindowSec, seed: job.jobId });
    return { data: { ...plan, validation: validateInterruptPlan(plan, { durationSec, hookWindowSec: cfg.hookWindowSec }) } };
  }

  async stage_render_shots({ dir, data, cfg }) {
    const chunks = data['shot-plan'].shots.map(s => ({ id: s.id, durationSec: s.dur, args: shotArgs(s, cfg) }));
    const out = path.join(dir, 'video.mp4');
    const r = await this.renderer.render({ dir: path.join(dir, 'shots'), chunks, outPath: out });
    return { outputs: [out], data: { resumedChunks: r.resumed, renderedChunks: r.rendered, durationSec: r.durationSec } };
  }

  async stage_mux({ job, dir, data, cfg }) {
    const clean = data['audio-clean'];
    const total = clean.durationAfter;
    const inputs = ['-i', 'video.mp4', '-i', 'cleaned.wav'];
    let vf = buildInterruptFilter(data.interrupts.interrupts, { width: cfg.width, height: cfg.height });
    if (job.captionsAss && fs.existsSync(job.captionsAss)) {
      fs.writeFileSync(path.join(dir, 'cap.ass'), pacing.remapAss(fs.readFileSync(job.captionsAss, 'utf8'), clean.keeps));
      vf += ';[vi]ass=cap.ass[v]';
    } else vf += ';[vi]null[v]';

    const soundPlan = job.soundDesignPlan || {};
    const chains = [];
    const labels = [];
    const voiceChain = '[1:a]highpass=f=80,equalizer=f=240:t=q:w=1:g=-2,' +
      'equalizer=f=3200:t=q:w=1:g=1.5,acompressor=threshold=0.10:ratio=3:attack=12:release=180:makeup=2';
    const musicTracks = Array.isArray(job.musicSegments) && job.musicSegments.length
      ? job.musicSegments
      : (job.musicPath && fs.existsSync(job.musicPath) ? [{ path: job.musicPath, startSeconds: 0, endSeconds: total, gainDb: soundPlan.music && soundPlan.music.gainDb, fadeInSeconds: soundPlan.music && soundPlan.music.fadeInSeconds, fadeOutSeconds: soundPlan.music && soundPlan.music.fadeOutSeconds }] : []);
    let nextInput = 2;
    if (musicTracks.length) {
      const sidechainLabels = musicTracks.map((_, index) => '[sc' + index + ']').join('');
      chains.push(voiceChain + ',asplit=' + (musicTracks.length + 1) + '[vo]' + sidechainLabels);
      labels.push('[vo]');
      const silenceWindows = Array.isArray(soundPlan.silenceWindows) ? soundPlan.silenceWindows : [];
      const silenceExpression = silenceWindows.reduce((expr, window) =>
        'if(between(t,' + Math.max(0, Number(window.startSeconds) || 0).toFixed(2) + ',' + Math.max(0, Number(window.endSeconds) || 0).toFixed(2) + '),0,' + expr + ')', '1');
      musicTracks.forEach((track, index) => {
        if (!track.path || !fs.existsSync(track.path)) throw new Error('Act-wise music track missing: ' + (track.path || 'path not set'));
        const startAt = Math.max(0, Number(track.startSeconds) || 0);
        const endAt = Math.min(total, Number(track.endSeconds) > startAt ? Number(track.endSeconds) : total);
        const duration = Math.max(0.1, endAt - startAt);
        const delay = Math.round(startAt * 1000);
        const gain = Number.isFinite(Number(track.gainDb)) ? Math.max(-48, Math.min(0, Number(track.gainDb))) : -25;
        const fadeIn = Math.min(duration / 2, Math.max(0.05, Number(track.fadeInSeconds) || 0.5));
        const fadeOut = Math.min(duration / 2, Math.max(0.05, Number(track.fadeOutSeconds) || 0.8));
        inputs.push('-stream_loop', '-1', '-i', track.path);
        const bed = 'mb' + index, ducked = 'md' + index;
        chains.push('[' + nextInput + ':a]atrim=duration=' + duration.toFixed(2) + ',asetpts=PTS-STARTPTS,volume=' + gain +
          'dB,afade=t=in:st=0:d=' + fadeIn.toFixed(2) + ',afade=t=out:st=' + Math.max(0, duration - fadeOut).toFixed(2) +
          ':d=' + fadeOut.toFixed(2) + ',adelay=' + delay + '|' + delay + ',volume=\'' + silenceExpression + '\[' + bed + ']');
        chains.push('[' + bed + '][sc' + index + ']sidechaincompress=threshold=0.025:ratio=8:attack=20:release=450:makeup=1[' + ducked + ']');
        labels.push('[' + ducked + ']');
        nextInput++;
      });
    } else {
      chains.push(voiceChain + '[vo]');
      labels.push('[vo]');
    }

    const cues = Array.isArray(soundPlan.cues) ? soundPlan.cues : [];
    for (let index = 0; index < cues.length; index++) {
      const cue = cues[index];
      if (!cue || !cue.path || !fs.existsSync(cue.path)) throw new Error('Sound design cue file missing: ' + (cue && cue.path));
      inputs.push('-i', cue.path);
      const gain = Number.isFinite(Number(cue.gainDb)) ? Math.max(-48, Math.min(0, Number(cue.gainDb))) : -18;
      const delay = Math.round(Math.max(0, Number(cue.atSeconds) || 0) * 1000);
      const label = 'sfx' + index;
      chains.push('[' + nextInput + ':a]volume=' + gain + 'dB,afade=t=in:st=0:d=0.015,adelay=' + delay + '|' + delay + '[' + label + ']');
      labels.push('[' + label + ']');
      nextInput++;
    }
    chains.push(labels.join('') + 'amix=inputs=' + labels.length +
      ':duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.95[a]');
    const af = chains.join(';');
    const part = path.join(dir, 'muxed.part.mp4'), out = path.join(dir, 'muxed.mp4');
    await this.runner.run([...inputs, '-filter_complex', vf + ';' + af, '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'muxed.part.mp4'], { cwd: dir, label: 'mux' });
    replaceFileSync(part, out);
    return { outputs: [out], data: { path: out, soundDesign: { cueCount: cues.length, musicDucking: Boolean(job.musicPath), targetLufs: soundPlan.mix && soundPlan.mix.targetIntegratedLufs || -14 } } };
  }

  async stage_loudness({ job, dir }) {
    fs.mkdirSync(path.dirname(path.resolve(job.outPath)), { recursive: true });
    const r = await this.audio.normalize(path.join(dir, 'muxed.mp4'), path.resolve(job.outPath));
    return { outputs: [path.resolve(job.outPath)], data: r };
  }

  async stage_finalize({ job, data }) {
    const report = buildReport({ job, data });
    const base = path.resolve(job.outPath).replace(/\.[^.]+$/, '');
    fs.writeFileSync(base + '.report.json', JSON.stringify({ report, data }, null, 2));
    fs.writeFileSync(base + '.report.md', toMarkdown(report));
    return { data: { report, reportFiles: [base + '.report.json', base + '.report.md'] } };
  }
}

module.exports = { ProductionPipeline, ORDER, DEFAULT_CONFIG };
