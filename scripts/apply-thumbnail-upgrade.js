'use strict';
const fs = require('node:fs');
const path = require('node:path');

const METHOD_START = '  async processThumbnail(thumbnail, script) {';
const METHOD_END = '\n  calculatePublishTime(strategy) {';
const MARKER = 'DARK_PHYS_REVIEWED_THUMBNAIL_ENGINE';

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, value) { fs.writeFileSync(file, value, 'utf8'); }

function upgradedProcessThumbnailMethod() {
  return `  async processThumbnail(thumbnail, script) {
    // DARK_PHYS_REVIEWED_THUMBNAIL_ENGINE
    // Never replace a reviewed, approved Dark Phys thumbnail with a generic second AI image.
    const reviewed = thumbnail &&
      thumbnail.qualityChecks?.allCandidatesPassedVisualGate === true &&
      Array.isArray(thumbnail.variants) && thumbnail.variants.length === 3 &&
      thumbnail.variants.every(item => item.reviewPassed === true) &&
      thumbnail.dimensions?.width === 1280 && thumbnail.dimensions?.height === 720;
    if (reviewed && thumbnail.path && await fs.access(thumbnail.path).then(() => true).catch(() => false)) {
      const stat = await fs.stat(thumbnail.path);
      if (stat.size > 0 && stat.size <= 2 * 1024 * 1024) {
        const productionThumbnailPath = path.join(
          __dirname, '..', 'data', 'assets',
          \`thumbnail_\${Date.now()}.jpg\`
        );
        await fs.mkdir(path.dirname(productionThumbnailPath), { recursive: true });
        await fs.copyFile(thumbnail.path, productionThumbnailPath);
        return {
          path: productionThumbnailPath,
          originalPath: thumbnail.path,
          dimensions: thumbnail.dimensions,
          fileSize: stat.size,
          generatedWith: 'Dark Phys reviewed thumbnail engine',
          recommendedCandidate: thumbnail.recommendedCandidate,
          qualityChecks: thumbnail.qualityChecks,
          variants: thumbnail.variants.map(item => ({
            label: item.label, path: item.path, hook: item.hook,
            designFamily: item.designFamily, visualStrategyId: item.visualStrategyId,
            reviewScore: item.reviewScore, reviewPassed: item.reviewPassed
          }))
        };
      }
      this.logger.warn('Reviewed Dark Phys thumbnail failed the final file-size check; using the existing provider fallback.');
    }

    // Backward-compatible provider fallback for legacy/unreviewed thumbnail payloads.
    try {
      const thumbnailScript = thumbnail?.script || script || { title: thumbnail?.title || 'Untitled Video' };
      const aiThumbnail = await this.aiVideoGenerator.generateThumbnail(thumbnailScript, 'ethereal');
      if (!aiThumbnail.simulated) {
        return {
          path: aiThumbnail.path,
          originalPath: thumbnail?.path,
          dimensions: aiThumbnail.dimensions,
          fileSize: aiThumbnail.fileSize,
          generatedWith: 'AI'
        };
      }
    } catch (error) {
      this.logger.error('AI thumbnail generation failed:', error);
    }

    const productionThumbnailPath = path.join(
      __dirname, '..', 'data', 'assets',
      \`thumbnail_\${Date.now()}.jpg\`
    );
    if (thumbnail?.path && await fs.access(thumbnail.path).then(() => true).catch(() => false)) {
      const originalBuffer = await fs.readFile(thumbnail.path);
      await fs.mkdir(path.dirname(productionThumbnailPath), { recursive: true });
      await fs.writeFile(productionThumbnailPath, originalBuffer);
      return {
        path: productionThumbnailPath,
        originalPath: thumbnail.path,
        dimensions: thumbnail.dimensions || { width: 1792, height: 1024 },
        fileSize: thumbnail.fileSize || 0
      };
    }

    await fs.mkdir(path.dirname(productionThumbnailPath), { recursive: true });
    await fs.writeFile(productionThumbnailPath + '.placeholder', 'Thumbnail placeholder');
    return {
      path: productionThumbnailPath + '.placeholder',
      originalPath: thumbnail?.path,
      dimensions: thumbnail?.dimensions || { width: 1792, height: 1024 },
      fileSize: 0,
      simulated: true
    };
  }`;
}

function patchUpstreamIndex(source) {
  if (source.includes('DARK_PHYS_THUMBNAIL_CANDIDATE_ASSETS')) return source;
  const assetAnchor = [
    "        experimentThumbnails: (experiment?.thumbnailVariants || []).map((_variant, index) =>",
    "          `/api/content/${bundle.id}/asset/experiment-thumbnail-${index}`",
    "        ),",
    "        captions: bundle.assets?.captions?.path ? `/api/content/${bundle.id}/asset/captions` : null,"
  ].join("\n");
  const assetReplacement = [
    "        experimentThumbnails: (experiment?.thumbnailVariants || []).map((_variant, index) =>",
    "          `/api/content/${bundle.id}/asset/experiment-thumbnail-${index}`",
    "        ),",
    "        // DARK_PHYS_THUMBNAIL_CANDIDATE_ASSETS",
    "        thumbnailCandidates: (bundle.assets?.thumbnail?.variants || []).map((_variant, index) =>",
    "          `/api/content/${bundle.id}/asset/thumbnail-candidate-${index}`",
    "        ),",
    "        captions: bundle.assets?.captions?.path ? `/api/content/${bundle.id}/asset/captions` : null,"
  ].join("\n");
  const routeAnchor = [
    "        const experimentMatch = req.params.kind.match(/^experiment-thumbnail-(\\d+)$/);",
    "        const experimentPath = experimentMatch",
    "          ? bundle.editorData?.packagingExperiment?.thumbnailVariants?.[Number(experimentMatch[1])]?.path",
    "          : null;",
    "        const filePath = allowed[req.params.kind] || experimentPath;"
  ].join("\n");
  const routeReplacement = [
    "        // DARK_PHYS_THUMBNAIL_CANDIDATE_ASSETS",
    "        const candidateMatch = req.params.kind.match(/^thumbnail-candidate-(\\d+)$/);",
    "        const candidatePath = candidateMatch",
    "          ? bundle.assets?.thumbnail?.variants?.[Number(candidateMatch[1])]?.path",
    "          : null;",
    "        const experimentMatch = req.params.kind.match(/^experiment-thumbnail-(\\d+)$/);",
    "        const experimentPath = experimentMatch",
    "          ? bundle.editorData?.packagingExperiment?.thumbnailVariants?.[Number(experimentMatch[1])]?.path",
    "          : null;",
    "        const filePath = allowed[req.params.kind] || candidatePath || experimentPath;"
  ].join("\n");
  if (!source.includes(assetAnchor) || !source.includes(routeAnchor)) {
    throw new Error('Pinned upstream index.js no longer matches the expected asset URL/serving routes; refusing an unsafe thumbnail UI patch.');
  }
  return source.replace(assetAnchor, assetReplacement).replace(routeAnchor, routeReplacement);
}

function patchDashboardApp(source) {
  if (source.includes('DARK_PHYS_THUMBNAIL_CANDIDATE_PANEL')) return source;
  const selectionAnchor = "    const selectedThumbnailVariant = Number(data.selectedThumbnailVariant || 0);";
  const selectionReplacement = [
    selectionAnchor,
    "    // DARK_PHYS_THUMBNAIL_CANDIDATE_PANEL",
    "    const thumbnailCandidates = (item.assets?.thumbnail?.variants || []).map((variant, index) => ({ ...variant, url: item.assetUrls.thumbnailCandidates?.[index] || '' }));",
    "    const thumbnailQuality = item.assets?.thumbnail?.qualityChecks || {};",
    "    const recommendedCandidate = item.assets?.thumbnail?.recommendedCandidate || '';"
  ].join("\n");
  if (!source.includes(selectionAnchor)) throw new Error('Pinned dashboard/app.js no longer has the expected content-review setup; refusing an unsafe thumbnail UI patch.');
  source = source.replace(selectionAnchor, selectionReplacement);
  const qualityStart = source.indexOf('            <div class="quality-grid">');
  if (qualityStart < 0) throw new Error('Pinned dashboard/app.js quality panel not found; refusing an unsafe thumbnail UI patch.');
  const qualityEnd = source.indexOf("\n", qualityStart);
  if (qualityEnd < 0) throw new Error('Could not locate dashboard quality panel line ending.');
  const panel = [
    "            ${thumbnailCandidates.length ? `<section class=\"experiment-panel thumbnail-candidates-panel\">",
    "              <div><p class=\"eyebrow\">THUMBNAIL CANDIDATES</p><strong>Recommended: ${escapeHTML(recommendedCandidate || 'Top score')}</strong><p>${thumbnailQuality.visionInspectionAvailable ? 'AI visual review + technical checks' : 'Technical/layout checks; AI vision unavailable'}</p></div>",
    "              <div class=\"experiment-thumbnails\">${thumbnailCandidates.map((variant, index) => `<div class=\"experiment-thumb ${variant.label === recommendedCandidate ? 'selected' : ''}\"><img src=\"${escapeHTML(variant.url || '')}\" alt=\"${escapeHTML(variant.label || 'Candidate')}\"><span>${escapeHTML(variant.label || 'Candidate')} · ${Number(variant.reviewScore || 0)}/100</span><small>${escapeHTML(variant.hook || '')} · ${escapeHTML(variant.designFamily || '')}</small></div>`).join('')}</div>",
    "            </section>` : ''}"
  ].join("\n");
  return source.slice(0, qualityEnd + 1) + panel + "\n" + source.slice(qualityEnd + 1);
}

function patchDashboardStyles(source) {
  if (source.includes('DARK_PHYS_THUMBNAIL_CANDIDATE_STYLE')) return source;
  const anchor = '.experiment-thumb:has(input:checked) { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(110, 168, 255, .18); }';
  if (!source.includes(anchor)) throw new Error('Pinned dashboard/styles.css thumbnail card style not found; refusing an unsafe style patch.');
  return source.replace(anchor, anchor + '\\n/* DARK_PHYS_THUMBNAIL_CANDIDATE_STYLE */\\n.thumbnail-candidates-panel .experiment-thumb.selected { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(110, 168, 255, .18); }\\n.thumbnail-candidates-panel .experiment-thumb { cursor: default; }\\n.thumbnail-candidates-panel .experiment-thumb small { display: block; color: var(--muted); font-size: 10px; line-height: 1.35; margin-top: 4px; text-align: center; }');
}

function applyThumbnailUpgrade({ root = path.resolve(__dirname, '..'), engine } = {}) {
  if (!engine) throw new Error('Pass --engine <path> to the pinned YouTube Automation Agent checkout.');
  const engineRoot = path.resolve(engine);
  const agentsDir = path.join(engineRoot, 'agents');
  const productionFile = path.join(agentsDir, 'production-management-agent.js');
  const upstreamDesigner = path.join(agentsDir, 'thumbnail-designer-agent.js');
  const extraFamilies = path.join(agentsDir, 'thumbnail-families-extra.js');
  const indexFile = path.join(engineRoot, 'index.js');
  const dashboardFile = path.join(engineRoot, 'dashboard', 'app.js');
  const stylesFile = path.join(engineRoot, 'dashboard', 'styles.css');
  if (![indexFile, dashboardFile, stylesFile, productionFile].every(fs.existsSync)) {
    throw new Error('Target is not a compatible YouTube Automation Agent checkout: ' + engineRoot);
  }

  const sourceDesigner = path.join(root, 'agents', 'thumbnail-designer-agent.js');
  const sourceFamilies = path.join(root, 'agents', 'thumbnail-families-extra.js');
  for (const file of [sourceDesigner, sourceFamilies]) {
    if (!fs.existsSync(file)) throw new Error('Dark Phys thumbnail upgrade source is missing: ' + file);
  }

  const productionSource = read(productionFile);
  if (!productionSource.includes(METHOD_START)) throw new Error('Pinned upstream production-management-agent.js no longer has the expected processThumbnail method; refusing an unsafe patch.');
  const methodStart = productionSource.indexOf(METHOD_START);
  const methodEnd = productionSource.indexOf(METHOD_END, methodStart);
  if (methodEnd < 0) throw new Error('Could not locate the end of upstream processThumbnail method; refusing an unsafe patch.');
  const indexSource = read(indexFile);
  const dashboardSource = read(dashboardFile);
  const stylesSource = read(stylesFile);
  const patchedIndex = patchUpstreamIndex(indexSource);
  const patchedDashboard = patchDashboardApp(dashboardSource);
  const patchedStyles = patchDashboardStyles(stylesSource);

  const backupDir = path.join(engineRoot, '.dark-phys-backups');
  const backups = {
    designer: path.join(backupDir, 'thumbnail-designer-agent.upstream.js'),
    families: path.join(backupDir, 'thumbnail-families-extra.upstream.js'),
    production: path.join(backupDir, 'production-management-agent.upstream.js'),
    index: path.join(backupDir, 'index.upstream.js'),
    dashboard: path.join(backupDir, 'dashboard-app.upstream.js'),
    styles: path.join(backupDir, 'dashboard-styles.upstream.css')
  };
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(upstreamDesigner) && !fs.existsSync(backups.designer)) fs.copyFileSync(upstreamDesigner, backups.designer);
  if (fs.existsSync(extraFamilies) && !fs.existsSync(backups.families)) fs.copyFileSync(extraFamilies, backups.families);
  if (!fs.existsSync(backups.production)) fs.copyFileSync(productionFile, backups.production);
  if (!fs.existsSync(backups.index)) fs.copyFileSync(indexFile, backups.index);
  if (!fs.existsSync(backups.dashboard)) fs.copyFileSync(dashboardFile, backups.dashboard);
  if (!fs.existsSync(backups.styles)) fs.copyFileSync(stylesFile, backups.styles);

  fs.copyFileSync(sourceDesigner, upstreamDesigner);
  fs.copyFileSync(sourceFamilies, extraFamilies);

  if (!productionSource.includes(MARKER)) {
    write(productionFile, productionSource.slice(0, methodStart) + upgradedProcessThumbnailMethod() + productionSource.slice(methodEnd));
  }
  if (patchedIndex !== indexSource) write(indexFile, patchedIndex);
  if (patchedDashboard !== dashboardSource) write(dashboardFile, patchedDashboard);
  if (patchedStyles !== stylesSource) write(stylesFile, patchedStyles);

  const { spawnSync } = require('node:child_process');
  for (const file of [upstreamDesigner, productionFile, indexFile, dashboardFile]) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error('Installed thumbnail upgrade failed JavaScript syntax validation: ' + file + '\n' + (check.stderr || ''));
  }
  return {
    engineRoot, designer: upstreamDesigner, families: extraFamilies,
    productionManager: productionFile, api: indexFile, dashboard: dashboardFile,
    backups: Object.values(backups),
    alreadyPatched: productionSource.includes(MARKER) &&
      indexSource.includes('DARK_PHYS_THUMBNAIL_CANDIDATE_ASSETS') &&
      dashboardSource.includes('DARK_PHYS_THUMBNAIL_CANDIDATE_PANEL') &&
      stylesSource.includes('DARK_PHYS_THUMBNAIL_CANDIDATE_STYLE')
  };
}

function main(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--engine');
  const engine = index >= 0 ? argv[index + 1] : '';
  const result = applyThumbnailUpgrade({ engine });
  process.stdout.write('Dark Phys reviewed thumbnail engine installed into pinned YouTube agent.\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write('Thumbnail upgrade install failed: ' + error.message + '\n'); process.exitCode = 1; }
}
module.exports = { applyThumbnailUpgrade, upgradedProcessThumbnailMethod };
