'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const API = 'https://pixabay.com/api/videos/';
const LICENSE_NOTE = 'Pixabay Content License applies; verify the current license and asset-specific restrictions before publication.';
function cleanQuery(value) {
  const q = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!q) throw new Error('A non-empty footage search query is required.');
  return q.slice(0, 100);
}
function safeName(value) {
  return String(value || 'footage').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 64) || 'footage';
}
function normalizeHit(hit) {
  const variants = hit && hit.videos || {};
  let selected = null;
  for (const quality of ['medium', 'small', 'large', 'tiny']) {
    const v = variants[quality];
    if (v && v.url && Number(v.width) > 0 && Number(v.height) > 0) { selected = { quality, ...v }; break; }
  }
  if (!selected) return null;
  return { id: Number(hit.id), pageUrl: hit.pageURL || '', creator: hit.user || 'Unknown creator',
    tags: String(hit.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    durationSeconds: Number(hit.duration || 0), width: Number(selected.width), height: Number(selected.height),
    quality: selected.quality, videoUrl: selected.url, previewUrl: selected.thumbnail || '',
    license: 'Pixabay Content License', licenseNote: LICENSE_NOTE };
}
class PixabayFootageClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.PIXABAY_API_KEY ?? '';
    this.fetch = options.fetch || globalThis.fetch;
    this.outputDir = options.outputDir || path.resolve(process.cwd(), 'uploads', 'stock-footage');
    this.maxDownloadBytes = Number(options.maxDownloadBytes || 80 * 1024 * 1024);
  }
  async search(query, options = {}) {
    if (!this.apiKey) return { status: 'needs_api_key', provider: 'pixabay', items: [], message: 'Set PIXABAY_API_KEY locally; do not commit it.' };
    if (typeof this.fetch !== 'function') throw new Error('Node fetch is unavailable; use Node.js 18 or newer.');
    const params = new URLSearchParams({ key: this.apiKey, q: cleanQuery(query), per_page: String(Math.min(20, Math.max(3, Number(options.perPage) || 10))), safesearch: 'true', order: options.order === 'latest' ? 'latest' : 'popular' });
    if (options.videoType && ['film', 'animation'].includes(options.videoType)) params.set('video_type', options.videoType);
    const response = await this.fetch(API + '?' + params.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Pixabay search failed with HTTP ' + response.status + '. Check API access and retry later.');
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.hits)) throw new Error('Pixabay returned an unexpected search response.');
    return { status: 'ok', provider: 'pixabay', totalHits: Number(payload.totalHits || 0), items: payload.hits.map(normalizeHit).filter(Boolean) };
  }
  async download(item, options = {}) {
    if (!item || !Number.isInteger(Number(item.id)) || !item.videoUrl) throw new Error('Choose a valid search result before downloading.');
    if (!this.apiKey) throw new Error('Set PIXABAY_API_KEY locally before downloading.');
    const response = await this.fetch(item.videoUrl, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('Footage download failed with HTTP ' + response.status + '.');
    const declared = Number(response.headers && response.headers.get && response.headers.get('content-length') || 0);
    if (declared > this.maxDownloadBytes) throw new Error('Footage exceeds the configured download-size limit.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > this.maxDownloadBytes) throw new Error('Downloaded footage is empty or exceeds the configured size limit.');
    await fs.mkdir(this.outputDir, { recursive: true });
    const filename = safeName(options.filename || item.tags?.slice(0, 2).join('-') || 'pixabay') + '-' + item.id + '.mp4';
    const destination = path.join(this.outputDir, filename);
    await fs.writeFile(destination, buffer, { flag: 'wx' }).catch(error => {
      if (error.code === 'EEXIST') throw new Error('A file with this asset ID already exists: ' + destination);
      throw error;
    });
    const record = { provider: 'Pixabay', assetId: item.id, creator: item.creator, sourcePage: item.pageUrl,
      downloadedFile: path.relative(process.cwd(), destination).replace(/\\/g, '/'),
      retrievedAt: new Date().toISOString(), durationSeconds: item.durationSeconds, width: item.width, height: item.height,
      tags: item.tags, license: item.license || 'Pixabay Content License', licenseNote: LICENSE_NOTE,
      reviewRequired: true, restrictionsCheckedByUser: false };
    const manifestPath = path.join(this.outputDir, 'asset-manifest.json');
    let manifest = [];
    try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!Array.isArray(manifest)) throw new Error('Existing asset manifest is invalid; inspect manually.');
    manifest.push(record);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return { path: destination, manifestPath, record };
  }
}
module.exports = { PixabayFootageClient, cleanQuery, normalizeHit, safeName, LICENSE_NOTE };
