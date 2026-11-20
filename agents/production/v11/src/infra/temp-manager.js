'use strict';
/**
 * Job work folders with an ownership marker. Cleanup only ever touches folders that carry the marker
 * and live directly under the base folder, so it cannot delete anything else.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isPidAlive, safeName } = require('./file-utils');

const MARKER = '.yt-work.json';
const JUNK = /(\.tmp|\.part|\.partial|\.temp)$|^ffmpeg2pass|^\.render_/i;

function pickBaseDir(preferred) {
  const candidates = [preferred, process.env.YT_WORK_DIR, os.tmpdir(), path.join(process.cwd(), '.work')].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.mkdirSync(c, { recursive: true });
      const probe = path.join(c, '.probe_' + process.pid);
      fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe);
      return c;
    } catch (_) { /* try next */ }
  }
  throw new Error('no writable work folder (check TEMP / YT_WORK_DIR)');
}

class TempManager {
  constructor({ baseDir, prefix = 'ytjob_', now = () => Date.now() } = {}) {
    this.baseDir = pickBaseDir(baseDir);
    this.prefix = prefix; this.now = now; this.activeDirs = ACTIVE_DIRS;
  }

  dirFor(jobId) { return path.join(this.baseDir, this.prefix + safeName(jobId)); }

  /** Creates the folder, or re-adopts it when resuming. */
  create(jobId) {
    const dir = this.dirFor(jobId);
    fs.mkdirSync(dir, { recursive: true });
    this.writeMarker(dir, jobId);
    this.activeDirs.add(path.resolve(dir));
    return dir;
  }

  writeMarker(dir, jobId) {
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ jobId, pid: process.pid, heartbeat: this.now() }));
  }

  touch(dir) {
    const m = this.readMarker(dir);
    if (m) this.writeMarker(dir, m.jobId);
  }

  readMarker(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')); } catch (_) { return null; }
  }

  isOwned(dir) {
    const real = path.resolve(dir);
    return path.dirname(real) === path.resolve(this.baseDir) && path.basename(real).startsWith(this.prefix) && !!this.readMarker(real);
  }

  release(dir) { this.activeDirs.delete(path.resolve(dir)); }

  remove(dir) {
    if (!this.isOwned(dir)) throw new Error('refusing to delete a folder this system did not create: ' + dir);
    fs.rmSync(dir, { recursive: true, force: true });
    this.release(dir);
  }

  /** Removes partial/temp files inside a job folder but keeps finished work. */
  sweepJunk(dir) {
    let removed = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && JUNK.test(e.name)) { fs.unlinkSync(path.join(dir, e.name)); removed++; }
    }
    return removed;
  }

  /**
   * Deletes abandoned job folders: owner process is gone AND the folder is older than maxAgeMs,
   * unless isResumable(jobId) says the job may still be resumed within resumeTtlMs.
   */
  cleanupStale({ maxAgeMs = 6 * 3600e3, resumeTtlMs = 48 * 3600e3, isResumable = () => false } = {}) {
    const removed = [], kept = [];
    for (const name of fs.readdirSync(this.baseDir)) {
      if (!name.startsWith(this.prefix)) continue;
      const dir = path.join(this.baseDir, name);
      if (!this.isOwned(dir)) continue;
      if (this.activeDirs.has(path.resolve(dir))) { kept.push({ dir, why: 'active in this process' }); continue; }
      const m = this.readMarker(dir);
      const age = this.now() - (m.heartbeat || 0);
      if (m.pid !== process.pid && isPidAlive(m.pid)) { kept.push({ dir, why: 'owner running' }); continue; }
      const limit = isResumable(m.jobId) ? resumeTtlMs : maxAgeMs;
      if (age > limit) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); } else kept.push({ dir, why: 'recent' });
    }
    return { removed, kept };
  }
}

module.exports = { TempManager, pickBaseDir, MARKER };
