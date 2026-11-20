'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ProcessSupervisor } = require('../src/infra/process-supervisor');
const { CheckpointStore } = require('../src/infra/checkpoint-store');
const { TempManager } = require('../src/infra/temp-manager');
const h = require('./helpers');

const NODE = process.execPath;

test('supervisor: normal run returns output', async () => {
  const sup = new ProcessSupervisor();
  const r = await sup.run(NODE, ['-e', 'console.log("hi")'], { timeoutMs: 5000 });
  assert.equal(r.ok, true); assert.match(r.stdout, /hi/);
  assert.deepEqual(sup.active(), []);
});

test('supervisor: hard timeout kills the process', async () => {
  const sup = new ProcessSupervisor({ graceMs: 200 });
  const r = await sup.run(NODE, ['-e', 'setInterval(()=>console.log("tick"),50)'], { timeoutMs: 500 });
  assert.equal(r.timedOut, true); assert.equal(r.ok, false);
  assert.deepEqual(sup.active(), []);
});

test('supervisor: a silent hung process is killed by the stall detector, a chatty one is not', async () => {
  const sup = new ProcessSupervisor({ graceMs: 200 });
  const hung = await sup.run(NODE, ['-e', 'setInterval(()=>{},1000)'], { stallMs: 400, timeoutMs: 10000 });
  assert.equal(hung.stalled, true);
  assert.ok(hung.durationMs < 3000);
  const busy = await sup.run(NODE, ['-e', 'let n=0;const t=setInterval(()=>{console.log(n++);if(n>8){clearInterval(t)}},100)'], { stallMs: 400, timeoutMs: 10000 });
  assert.equal(busy.ok, true);
});

test('supervisor: grandchildren die with the leader', { skip: process.platform === 'win32' }, async () => {
  const sup = new ProcessSupervisor({ graceMs: 200 });
  const code = 'const {spawn}=require("child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log("GC:"+c.pid);setInterval(()=>{},1000)';
  const r = await sup.run(NODE, ['-e', code], { timeoutMs: 800 });
  const gc = Number(/GC:(\d+)/.exec(r.stdout)[1]);
  await h.sleep(400);
  assert.equal(h.alive(gc), false, 'grandchild still running');
});

test('supervisor: killAll stops everything and a missing binary rejects', async () => {
  const sup = new ProcessSupervisor({ graceMs: 100 });
  const p = sup.run(NODE, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 20000 });
  await h.sleep(300);
  assert.equal(sup.active().length, 1);
  sup.killAll();
  const r = await p;
  assert.equal(r.ok, false);
  await assert.rejects(sup.run('definitely-not-a-binary-xyz', []), /could not start/);
});

test('checkpoint: atomic save/load, validation of outputs, invalidate downstream', () => {
  const dir = h.tmp();
  try {
    const cp = new CheckpointStore(dir);
    const st = cp.load('job 1');
    const out = path.join(dir, 'o.bin'); fs.writeFileSync(out, 'data');
    st.stages.a = { status: 'done', outputs: cp.describeFiles([out]) };
    st.stages.b = { status: 'done', outputs: [] };
    cp.save(st);
    const again = cp.load('job 1');
    assert.equal(cp.isValid(again.stages.a), true);
    fs.writeFileSync(out, 'changed!');
    assert.equal(cp.isValid(cp.load('job 1').stages.a), false, 'size changed');
    fs.unlinkSync(out);
    assert.equal(cp.isValid(again.stages.a), false, 'file missing');
    cp.invalidateFrom(again, 'a', ['a', 'b']);
    assert.deepEqual(Object.keys(again.stages), []);
    assert.equal(fs.readdirSync(dir).some(n => n.endsWith('.tmp')), false);
  } finally { h.rm(dir); }
});

test('checkpoint: corrupt file is quarantined and lock rejects a second live owner', () => {
  const dir = h.tmp();
  try {
    const cp = new CheckpointStore(dir);
    fs.writeFileSync(cp.file('j'), '{broken');
    const st = cp.load('j');
    assert.deepEqual(st.stages, {});
    assert.ok(fs.readdirSync(dir).some(n => n.includes('.corrupt-')));
    const release = cp.acquire('j');
    assert.throws(() => cp.acquire('j'), /already running/);
    release();
    fs.writeFileSync(cp.lockFile('j'), JSON.stringify({ pid: 99999999, at: 1 }));
    const r2 = cp.acquire('j');
    r2();
  } finally { h.rm(dir); }
});

test('temp: only marked folders are cleaned, stale ones go, resumable ones stay', () => {
  const base = h.tmp();
  try {
    let clock = 1_000_000_000;
    const tm = new TempManager({ baseDir: base, now: () => clock });
    const mk = (job, pid, beat) => {
      const d = tm.create(job);
      fs.writeFileSync(path.join(d, '.yt-work.json'), JSON.stringify({ jobId: job, pid, heartbeat: beat }));
      return d;
    };
    const stale = mk('stale', 99999999, clock - 10 * 3600e3);
    const resumable = mk('resume', 99999999, clock - 10 * 3600e3);
    const fresh = mk('fresh', 99999999, clock - 60e3);
    const alive = mk('alive', process.ppid, clock - 50 * 3600e3);
    const foreign = path.join(base, 'ytjob_unmarked'); fs.mkdirSync(foreign);
    const res = tm.cleanupStale({ isResumable: id => id === 'resume' });
    assert.equal(fs.existsSync(stale), false);
    for (const d of [resumable, fresh, alive, foreign]) assert.equal(fs.existsSync(d), true, d);
    assert.equal(res.removed.length, 1);
    assert.throws(() => tm.remove(foreign), /refusing/);
    assert.throws(() => tm.remove(os_tmp()), /refusing/);
  } finally { h.rm(base); }
});

function os_tmp() { return require('os').tmpdir(); }

test('temp: sweepJunk removes partial files but keeps finished ones; broken base falls back', () => {
  const base = h.tmp();
  try {
    const tm = new TempManager({ baseDir: base });
    const d = tm.create('j');
    for (const n of ['a.part', 'b.tmp', 'ffmpeg2pass-0.log', 'keep.mp4']) fs.writeFileSync(path.join(d, n), 'x');
    assert.equal(tm.sweepJunk(d), 3);
    assert.deepEqual(fs.readdirSync(d).filter(n => !n.startsWith('.')), ['keep.mp4']);
    const fallback = new TempManager({ baseDir: path.join(base, 'file.txt', 'nope') });
    assert.ok(fs.existsSync(fallback.baseDir));
  } finally { h.rm(base); }
});

test('file replacement: an existing completed output is replaced without losing the old file on failure', () => {
  const dir = h.tmp();
  try {
    const { replaceFileSync } = require('../src/infra/file-utils');
    const source = path.join(dir, 'new.part.mp4'), destination = path.join(dir, 'final.mp4');
    fs.writeFileSync(source, 'new-render');
    fs.writeFileSync(destination, 'old-render');
    replaceFileSync(source, destination);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'new-render');
    assert.equal(fs.existsSync(source), false);
    assert.deepEqual(fs.readdirSync(dir), ['final.mp4']);
  } finally { h.rm(dir); }
});

test('checkpoint reset preserves the active job lock', () => {
  const dir = h.tmp();
  try {
    const cp = new CheckpointStore(dir);
    const release = cp.acquire('same-job');
    cp.save(cp.fresh('same-job'));
    cp.reset('same-job');
    assert.equal(fs.existsSync(cp.file('same-job')), false);
    assert.equal(fs.existsSync(cp.lockFile('same-job')), true);
    assert.throws(() => cp.acquire('same-job'), /already running/);
    release();
    const next = cp.acquire('same-job');
    next();
  } finally { h.rm(dir); }
});

test('temp cleanup never removes another active job from the same process', () => {
  const base = h.tmp();
  try {
    let clock = 1_000_000_000;
    const tm = new TempManager({ baseDir: base, now: () => clock });
    const first = tm.create('long-running-job');
    fs.writeFileSync(path.join(first, '.yt-work.json'), JSON.stringify({ jobId: 'long-running-job', pid: process.pid, heartbeat: clock - 10 * 3600e3 }));
    const second = tm.create('triggering-job');
    const otherSystem = new TempManager({ baseDir: base, now: () => clock });
    const result = otherSystem.cleanupStale();
    assert.equal(fs.existsSync(first), true);
    assert.ok(result.kept.some(x => x.dir === first && x.why === 'active in this process'));
    tm.release(first);
    const afterRelease = otherSystem.cleanupStale();
    assert.equal(fs.existsSync(first), false);
    tm.remove(second);
  } finally { h.rm(base); }
});
