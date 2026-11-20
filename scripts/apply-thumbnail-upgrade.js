'use strict';
const fs = require('node:fs');
const path = require('node:path');

const METHOD_START = '  async processThumbnail(thumbnail, script) {';
const METHOD_END = '\n  calculatePublishTime(strategy) {';
const MARKER = 'DARK_PHYS_REVIEWED_THUMBNAIL_ENGINE';

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, value) { fs.writeFileSync(file, value, 'utf8'); }

function upgradedProcessThumbnailMethod() {
  return String.raw`  async processThumbnail(thumbnail, script) {
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

function applyThumbnailUpgrade({ root = path.resolve(__dirname, '..'), engine } = {}) {
  if (!engine) throw new Error('Pass --engine <path> to the pinned YouTube Automation Agent checkout.');
  const engineRoot = path.resolve(engine);
  const agentsDir = path.join(engineRoot, 'agents');
  const productionFile = path.join(engineRoot, 'agents', 'production-management-agent.js');
  const upstreamDesigner = path.join(agentsDir, 'thumbnail-designer-agent.js');
  const extraFamilies = path.join(agentsDir, 'thumbnail-families-extra.js');
  if (!fs.existsSync(path.join(engineRoot, 'index.js')) || !fs.existsSync(productionFile)) {
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

  const backupDir = path.join(engineRoot, '.dark-phys-backups');
  const designerBackup = path.join(backupDir, 'thumbnail-designer-agent.upstream.js');
  const productionBackup = path.join(backupDir, 'production-management-agent.upstream.js');
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(upstreamDesigner) && !fs.existsSync(designerBackup)) fs.copyFileSync(upstreamDesigner, designerBackup);
  if (!fs.existsSync(productionBackup)) fs.copyFileSync(productionFile, productionBackup);

  fs.copyFileSync(sourceDesigner, upstreamDesigner);
  fs.copyFileSync(sourceFamilies, extraFamilies);

  let patched = productionSource;
  if (!patched.includes(MARKER)) {
    patched = patched.slice(0, methodStart) + upgradedProcessThumbnailMethod() + patched.slice(methodEnd);
    write(productionFile, patched);
  }

  // Syntax-check the two runtime entry files before reporting success.
  const { spawnSync } = require('node:child_process');
  for (const file of [upstreamDesigner, productionFile]) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error('Installed thumbnail upgrade failed JavaScript syntax validation: ' + file + '\n' + (check.stderr || ''));
  }
  return { engineRoot, designer: upstreamDesigner, families: extraFamilies, productionManager: productionFile, backups: [designerBackup, productionBackup], alreadyPatched: productionSource.includes(MARKER) };
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
