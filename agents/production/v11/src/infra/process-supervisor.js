'use strict';
/**
 * Runs child processes with a hard timeout and a stall detector, and kills the whole process tree.
 * Every live child is tracked so nothing is left running when the app exits.
 */
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const MAX_BUFFER = 2 * 1024 * 1024;

class SupervisedError extends Error {
  constructor(message, result) { super(message); this.name = 'SupervisedError'; this.result = result; }
}

class ProcessSupervisor {
  constructor({ graceMs = 1500, logger = null } = {}) {
    this.graceMs = graceMs;
    this.logger = logger;
    this.children = new Map();
    this._hooked = false;
  }

  active() { return [...this.children.keys()]; }

  killTree(pid, force = false) {
    try {
      if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch (_) { /* already gone */ }
  }

  killAll() {
    for (const pid of this.children.keys()) this.killTree(pid, true);
  }

  installExitHandlers() {
    if (this._hooked) return;
    this._hooked = true;
    process.on('exit', () => this.killAll());
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { this.killAll(); process.exit(130); });
  }

  /**
   * @returns {Promise<{code,signal,stdout,stderr,timedOut,stalled,durationMs}>} resolves for any exit; use result.ok
   */
  run(cmd, args = [], { cwd, env, timeoutMs = 0, stallMs = 0, label = cmd, onData = null } = {}) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let child;
      try {
        child = spawn(cmd, args, { cwd, env: env || process.env, detached: !IS_WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { reject(e); return; }
      let stdout = '', stderr = '', timedOut = false, stalled = false, done = false;
      let timer = null, stallTimer = null, escalate = null;

      const clearAll = () => { clearTimeout(timer); clearTimeout(stallTimer); clearTimeout(escalate); };
      const kill = () => {
        this.killTree(child.pid, false);
        escalate = setTimeout(() => this.killTree(child.pid, true), this.graceMs);
        escalate.unref();
      };
      const armStall = () => {
        if (!stallMs) return;
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => { stalled = true; kill(); }, stallMs);
      };
      const push = (which, d) => {
        const s = d.toString();
        if (which === 'out') stdout = (stdout + s).slice(-MAX_BUFFER); else stderr = (stderr + s).slice(-MAX_BUFFER);
        if (onData) onData(s, which);
        armStall();
      };

      this.children.set(child.pid, label);
      child.stdout.on('data', d => push('out', d));
      child.stderr.on('data', d => push('err', d));
      if (timeoutMs) timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      armStall();

      child.on('error', err => {
        if (done) return;
        done = true; clearAll(); this.children.delete(child.pid);
        reject(new SupervisedError('could not start ' + label + ': ' + err.message, null));
      });
      child.on('close', (code, signal) => {
        if (done) return;
        done = true; clearAll();
        // make sure no grandchildren survive the leader
        this.killTree(child.pid, true);
        this.children.delete(child.pid);
        resolve({ ok: code === 0 && !timedOut && !stalled, code, signal, stdout, stderr, timedOut, stalled, durationMs: Date.now() - started });
      });
    });
  }
}

module.exports = { ProcessSupervisor, SupervisedError };
