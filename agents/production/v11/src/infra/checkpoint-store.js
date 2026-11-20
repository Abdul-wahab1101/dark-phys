'use strict';
/**
 * Per-job checkpoint file. Each stage records its outputs; on resume a stage counts as done only if its
 * output files still exist with the same size. Writes are atomic, a corrupt file is quarantined, and a lock
 * file stops two processes from running the same job.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic, isPidAlive, safeName } = require('./file-utils');

class CheckpointStore {
  constructor(dir, { now = () => Date.now() } = {}) {
    this.dir = dir; this.now = now;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(jobId) { return path.join(this.dir, safeName(jobId) + '.json'); }
  lockFile(jobId) { return path.join(this.dir, safeName(jobId) + '.lock'); }

  acquire(jobId) {
    const lock = this.lockFile(jobId);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: this.now() }), { flag: 'wx' });
        return () => { try { fs.unlinkSync(lock); } catch (_) { /* already released */ } };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let owner = null;
        try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch (_) { /* unreadable lock */ }
        if (owner && owner.pid !== process.pid && isPidAlive(owner.pid)) throw new Error('job ' + jobId + ' is already running (pid ' + owner.pid + ')');
        try { fs.unlinkSync(lock); } catch (_) { /* raced */ }
      }
    }
    throw new Error('could not lock job ' + jobId);
  }

  load(jobId) {
    const f = this.file(jobId);
    if (!fs.existsSync(f)) return this.fresh(jobId);
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!s || typeof s !== 'object' || !s.stages) throw new Error('bad shape');
      return s;
    } catch (_) {
      fs.renameSync(f, f + '.corrupt-' + this.now());
      return this.fresh(jobId);
    }
  }

  fresh(jobId) { return { jobId, version: 1, createdAt: this.now(), stages: {}, meta: {} }; }

  save(state) { state.updatedAt = this.now(); writeFileAtomic(this.file(state.jobId), JSON.stringify(state, null, 2)); }

  describeFiles(paths) {
    return paths.map(p => ({ path: p, size: fs.existsSync(p) ? fs.statSync(p).size : -1 }));
  }

  /** Is the recorded stage still trustworthy? */
  isValid(stage) {
    if (!stage || stage.status !== 'done') return false;
    return (stage.outputs || []).every(o => fs.existsSync(o.path) && fs.statSync(o.path).size === o.size && o.size > 0);
  }

  /** Invalidate a stage and everything after it. */
  invalidateFrom(state, stageName, order) {
    const i = order.indexOf(stageName);
    for (const n of order.slice(Math.max(0, i))) delete state.stages[n];
  }

  reset(jobId) { try { fs.unlinkSync(this.file(jobId)); } catch (_) { /* no checkpoint yet */ } }

  clear(jobId) { for (const f of [this.file(jobId), this.lockFile(jobId)]) { try { fs.unlinkSync(f); } catch (_) { /* none */ } } }

  listJobs() { return fs.readdirSync(this.dir).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)); }
}

module.exports = { CheckpointStore };
