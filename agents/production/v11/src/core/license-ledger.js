'use strict';
/**
 * Asset-level licence ledger. Storage is injected (see infra/jsonl-store.js).
 * The licence table is a convenience; always confirm terms at the asset's source page.
 */

const LICENSES = {
  'pixabay-content-license': { commercial: true, attribution: false },
  'pexels-license': { commercial: true, attribution: false },
  'cc0': { commercial: true, attribution: false },
  'cc-by-4.0': { commercial: true, attribution: true },
  'cc-by-sa-4.0': { commercial: true, attribution: true, shareAlike: true },
  'cc-by-nc-4.0': { commercial: false, attribution: true },
  'own': { commercial: true, attribution: false },
  'purchased': { commercial: true, attribution: false },
  'ai-generated': { commercial: true, attribution: false, ai: true },
  'unknown': { commercial: false, attribution: false }
};

const KINDS = ['video', 'image', 'audio', 'font', 'voiceover', 'ai-image'];

class LicenseLedger {
  constructor(store, { now = () => new Date() } = {}) {
    this.store = store;
    this.now = now;
  }

  records() {
    const assets = new Map();
    const videos = new Map();
    let usage = [];
    for (const r of this.store.readAll()) {
      if (r.type === 'asset') assets.set(r.assetId, r);
      else if (r.type === 'usage') usage.push(r);
      else if (r.type === 'usage-reset') usage = usage.filter(u => u.videoId !== r.videoId);
      else if (r.type === 'video') videos.set(r.videoId, r);
    }
    return { assets, usage, videos };
  }

  register(asset) {
    const errors = [];
    if (!asset.assetId) errors.push('assetId is required');
    if (!KINDS.includes(asset.kind)) errors.push('kind must be one of ' + KINDS.join(', '));
    if (!asset.source) errors.push('source is required');
    if (errors.length) throw new Error('Invalid asset: ' + errors.join('; '));
    const rec = {
      type: 'asset', assetId: asset.assetId, kind: asset.kind, source: asset.source,
      sourceUrl: asset.sourceUrl || null, author: asset.author || null,
      licenseId: LICENSES[asset.licenseId] ? asset.licenseId : 'unknown',
      licenseUrl: asset.licenseUrl || null, sha256: asset.sha256 || null,
      aiGenerated: !!asset.aiGenerated || asset.licenseId === 'ai-generated',
      retrievedAt: asset.retrievedAt || this.now().toISOString()
    };
    this.store.append(rec);
    return rec;
  }

  recordUsage(videoId, assetId, { secondsUsed = 0, uses = 1 } = {}) {
    const rec = { type: 'usage', videoId, assetId, secondsUsed, uses, at: this.now().toISOString() };
    this.store.append(rec);
    return rec;
  }

  /** Idempotent: replaces everything recorded as used by this video (safe when a stage is re-run). */
  setUsage(videoId, list) {
    this.store.append({ type: 'usage-reset', videoId, at: this.now().toISOString() });
    for (const u of list) this.recordUsage(videoId, u.assetId, { secondsUsed: u.secondsUsed, uses: u.uses });
  }

  recordVideo(videoId, { scriptText = '', hookText = '', title = '' } = {}) {
    this.store.append({ type: 'video', videoId, title, scriptText, hookText, at: this.now().toISOString() });
  }

  usageForVideo(videoId) {
    const { usage } = this.records();
    const merged = new Map();
    for (const u of usage.filter(x => x.videoId === videoId)) {
      const cur = merged.get(u.assetId) || { assetId: u.assetId, secondsUsed: 0, uses: 0 };
      cur.secondsUsed += u.secondsUsed; cur.uses += u.uses;
      merged.set(u.assetId, cur);
    }
    return [...merged.values()];
  }

  /** Channel history shaped for reuse-risk. */
  historyByVideo() {
    const { assets, usage, videos } = this.records();
    const byVideo = new Map();
    const get = id => {
      if (!byVideo.has(id)) {
        const meta = videos.get(id) || {};
        byVideo.set(id, { videoId: id, assets: [], scriptText: meta.scriptText || '', hookText: meta.hookText || '' });
      }
      return byVideo.get(id);
    };
    for (const id of videos.keys()) get(id);
    for (const u of usage) get(u.videoId).assets.push({ assetId: u.assetId, sha256: (assets.get(u.assetId) || {}).sha256, secondsUsed: u.secondsUsed });
    return [...byVideo.values()];
  }

  attributionText(videoId) {
    const { assets } = this.records();
    const lines = [];
    for (const u of this.usageForVideo(videoId)) {
      const a = assets.get(u.assetId);
      if (a && (LICENSES[a.licenseId] || {}).attribution) lines.push((a.author || 'Unknown author') + ' - ' + a.source + (a.sourceUrl ? ' (' + a.sourceUrl + ')' : '') + ' [' + a.licenseId + ']');
    }
    return lines;
  }

  /**
   * @param {object} opts { description, hashOf(assetId) -> sha256 | null, realisticAiDisclosed }
   */
  auditVideo(videoId, { description = '', hashOf = null, realisticAiDisclosed = null } = {}) {
    const { assets } = this.records();
    const used = this.usageForVideo(videoId);
    const findings = [];
    const add = (level, id, assetId, detail) => findings.push({ level, id, assetId, detail });
    if (!used.length) add('warn', 'no_assets_logged_for_video', null, 'nothing was recorded as used');

    for (const u of used) {
      const a = assets.get(u.assetId);
      if (!a) { add('block', 'asset_not_in_ledger', u.assetId, 'used but never registered'); continue; }
      const lic = LICENSES[a.licenseId] || LICENSES.unknown;
      if (a.licenseId === 'unknown') add('block', 'unknown_license', a.assetId, 'licence is not recorded');
      else if (!lic.commercial) add('block', 'non_commercial_license', a.assetId, a.licenseId + ' does not allow monetised use');
      if (!a.sourceUrl && a.kind !== 'voiceover' && a.licenseId !== 'own') add('warn', 'no_source_url', a.assetId, 'cannot prove where it came from');
      if (lic.attribution) {
        const credited = (a.author && description.toLowerCase().includes(String(a.author).toLowerCase())) || (a.sourceUrl && description.includes(a.sourceUrl));
        if (!credited) add('block', 'attribution_missing_in_description', a.assetId, 'credit ' + (a.author || a.source) + ' in the description');
      }
      if (a.sha256 && typeof hashOf === 'function') {
        const now = hashOf(a.assetId);
        if (now && now !== a.sha256) add('warn', 'file_changed_since_registered', a.assetId, 'hash differs from the ledger');
      }
      if (a.aiGenerated && realisticAiDisclosed === false) add('warn', 'ai_asset_without_disclosure_decision', a.assetId, 'if the result looks realistic, use the altered/synthetic content label');
    }
    const level = findings.some(f => f.level === 'block') ? 'block' : findings.length ? 'warn' : 'ok';
    return { level, findings, assetsChecked: used.length, note: 'Based on what was recorded. Confirm terms at each source; this is not legal advice.' };
  }
}

module.exports = { LicenseLedger, LICENSES, KINDS };
