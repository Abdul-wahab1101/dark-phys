'use strict';

function buildReport({ job, data }) {
  const must = [], consider = [];
  const take = (source, list, hard) => (list || []).forEach(f => (f.level === 'block' || f.level === 'fail' || hard ? must : consider).push({ source, id: f.id, detail: f.detail || f.assetId || '' }));

  const pre = data.preflight || {};
  take('license', pre.license && pre.license.findings);
  take('reuse', pre.reuse && pre.reuse.findings);
  take('thumbnail', pre.thumbnail && pre.thumbnail.findings);

  const hook = data.hook;
  if (hook && hook.grade === 'weak') hook.issues.forEach((id, i) => must.push({ source: 'hook', id, detail: hook.suggestions[i] }));
  else if (hook) hook.issues.forEach((id, i) => consider.push({ source: 'hook', id, detail: hook.suggestions[i] }));

  const ints = data.interrupts;
  if (ints && !ints.validation.ok) ints.validation.issues.forEach(id => consider.push({ source: 'interrupts', id, detail: '' }));

  const loud = data.loudness;
  if (loud && !loud.assessment.pass) loud.assessment.issues.forEach(id => must.push({ source: 'loudness', id, detail: '' }));

  const blocked = [pre.license, pre.reuse].some(x => x && x.level === 'block');
  const status = blocked ? 'blocked' : must.length ? 'review' : consider.length ? 'review' : 'ready';
  return {
    jobId: job.jobId, title: job.title, status, mustFix: must, consider,
    summary: {
      hookScore: hook ? hook.score : null,
      interruptsPerMinute: ints ? ints.stats.perMinute : null,
      deadAirRemovedSec: data['audio-clean'] ? data['audio-clean'].removedSec : null,
      loudnessLufs: loud ? Number(loud.after.integrated.toFixed(1)) : null,
      thumbnail: pre.thumbnail ? pre.thumbnail.level : 'not checked',
      license: pre.license ? pre.license.level : null,
      reuse: pre.reuse ? pre.reuse.level : null
    },
    note: 'Automated checks. A person should still watch the video before publishing.'
  };
}

function toMarkdown(r) {
  const L = ['# Production report: ' + (r.title || r.jobId), '', '**Status: ' + r.status.toUpperCase() + '**', '', '| Check | Result |', '|---|---|'];
  for (const [k, v] of Object.entries(r.summary)) L.push('| ' + k + ' | ' + v + ' |');
  const list = (t, a) => { if (a.length) { L.push('', '## ' + t); a.forEach(x => L.push('- [' + x.source + '] ' + x.id + (x.detail ? ': ' + x.detail : ''))); } };
  list('Must fix', r.mustFix); list('Consider', r.consider);
  L.push('', '_' + r.note + '_');
  return L.join('\n');
}

module.exports = { buildReport, toMarkdown };
