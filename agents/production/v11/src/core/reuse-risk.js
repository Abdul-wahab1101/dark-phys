'use strict';
/**
 * Reused-content risk checks. These reduce the chance of "repetitive / mass-produced" patterns
 * (same clips, near-identical scripts, same hook every time). They are risk signals, not a policy ruling.
 */
const { shingles, jaccard, words } = require('./text');

const LIMITS = {
  priorShareWarn: 0.35, priorShareBlock: 0.65,
  singleAssetShareWarn: 0.4, singleAssetUses: 4,
  scriptWarn: 0.35, scriptBlock: 0.6,
  secondsPerUniqueAsset: 12, hookRepeatWindow: 5
};

function assessReuse({ videoId, durationSec, assets = [], history = [], script = '', hookText = '', hasOriginalCommentary = true } = {}) {
  const findings = [];
  const add = (level, id, detail) => findings.push({ level, id, detail });
  const prior = history.filter(h => h.videoId !== videoId);
  const priorUse = new Map();
  for (const h of prior) for (const id of new Set((h.assets || []).map(a => a.assetId))) priorUse.set(id, (priorUse.get(id) || 0) + 1);

  const total = assets.reduce((n, a) => n + (a.secondsUsed || 0), 0) || durationSec || 1;
  const reusedSec = assets.filter(a => (priorUse.get(a.assetId) || 0) >= 2).reduce((n, a) => n + (a.secondsUsed || 0), 0);
  const priorShare = reusedSec / total;
  if (priorShare >= LIMITS.priorShareBlock) add('block', 'footage_mostly_reused_from_other_videos', Math.round(priorShare * 100) + '% of footage time');
  else if (priorShare >= LIMITS.priorShareWarn) add('warn', 'footage_often_reused_from_other_videos', Math.round(priorShare * 100) + '% of footage time');

  const perAsset = new Map();
  for (const a of assets) {
    const cur = perAsset.get(a.assetId) || { sec: 0, uses: 0 };
    cur.sec += a.secondsUsed || 0; cur.uses += a.uses || 1;
    perAsset.set(a.assetId, cur);
  }
  for (const [id, v] of perAsset) {
    if (perAsset.size >= 3 && v.sec / total >= LIMITS.singleAssetShareWarn) add('warn', 'one_clip_dominates', id + ' = ' + Math.round((v.sec / total) * 100) + '% of footage');
    if (v.uses >= LIMITS.singleAssetUses) add('warn', 'clip_repeated_in_video', id + ' used ' + v.uses + ' times');
  }

  const sameHash = new Map();
  for (const a of assets) if (a.sha256) sameHash.set(a.sha256, (sameHash.get(a.sha256) || new Set()).add(a.assetId));
  for (const [hash, ids] of sameHash) if (ids.size > 1) add('warn', 'same_file_registered_under_different_ids', hash.slice(0, 12) + ': ' + [...ids].join(', '));

  const need = Math.max(1, Math.floor((durationSec || total) / LIMITS.secondsPerUniqueAsset));
  if (perAsset.size < need) add('warn', 'few_unique_clips', perAsset.size + ' unique clips for ' + Math.round(durationSec || total) + 's (suggest at least ' + need + ')');

  let maxSim = 0, simWith = null;
  const mine = shingles(script);
  for (const h of prior) {
    const sim = jaccard(mine, shingles(h.scriptText || ''));
    if (sim > maxSim) { maxSim = sim; simWith = h.videoId; }
  }
  if (maxSim >= LIMITS.scriptBlock) add('block', 'script_nearly_identical_to_earlier_video', simWith + ' (' + Math.round(maxSim * 100) + '% overlap)');
  else if (maxSim >= LIMITS.scriptWarn) add('warn', 'script_similar_to_earlier_video', simWith + ' (' + Math.round(maxSim * 100) + '% overlap)');

  const opener = words(hookText).slice(0, 4).join(' ');
  if (opener) {
    const recent = prior.slice(-LIMITS.hookRepeatWindow).filter(h => words(h.hookText || '').slice(0, 4).join(' ') === opener).length;
    if (recent >= 2) add('warn', 'same_hook_opening_repeated', '"' + opener + '" used in ' + recent + ' of the last ' + LIMITS.hookRepeatWindow + ' videos');
  }

  if (!hasOriginalCommentary) add('warn', 'no_original_commentary', 'stock footage with no original analysis or voice reads as mass-produced');

  const level = findings.some(f => f.level === 'block') ? 'block' : findings.length ? 'warn' : 'ok';
  return {
    level, findings,
    metrics: { priorShare: Number(priorShare.toFixed(3)), uniqueAssets: perAsset.size, maxScriptSimilarity: Number(maxSim.toFixed(3)) },
    note: 'Risk signals only. They do not decide how YouTube will treat a channel.'
  };
}

module.exports = { assessReuse, LIMITS };
