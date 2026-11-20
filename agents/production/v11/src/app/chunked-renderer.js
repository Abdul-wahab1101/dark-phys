'use strict';
/**
 * Renders a video as many small chunk files, then concatenates them. A manifest records finished chunks, so after
 * a crash, kill or power cut only the unfinished chunks are rendered again.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic, replaceFileSync } = require('../infra/file-utils');

class ChunkedRenderer {
  constructor(runner, { durationTolerance = 0.3, logger = null } = {}) {
    this.runner = runner; this.tol = durationTolerance; this.logger = logger;
  }

  manifestPath(dir) { return path.join(dir, 'manifest.json'); }

  readManifest(dir) {
    try { return JSON.parse(fs.readFileSync(this.manifestPath(dir), 'utf8')); } catch (_) { return { chunks: {} }; }
  }

  async chunkIsValid(file, expectedSec) {
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) return false;
    try {
      const info = await this.runner.probe(file);
      return info.hasVideo && Math.abs(info.duration - expectedSec) <= this.tol + 0.05 * expectedSec;
    } catch (_) { return false; }
  }

  /**
   * @param {{dir:string, chunks:Array<{id:string, durationSec:number, args:string[]}>, outPath:string}} job
   *        each chunk's args are the ffmpeg arguments WITHOUT the output file name
   */
  async render({ dir, chunks, outPath }) {
    fs.mkdirSync(dir, { recursive: true });
    const manifest = this.readManifest(dir);
    let resumed = 0, rendered = 0;

    for (const c of chunks) {
      const file = path.join(dir, c.id + '.mp4');
      const rec = manifest.chunks[c.id];
      if (rec && rec.durationSec === c.durationSec && await this.chunkIsValid(file, c.durationSec)) { resumed++; continue; }
      const part = path.join(dir, c.id + '.part.mp4');
      try { fs.unlinkSync(part); } catch (_) { /* none */ }
      await this.runner.run([...c.args, part], { cwd: dir, label: 'render ' + c.id });
      replaceFileSync(part, file);
      manifest.chunks[c.id] = { durationSec: c.durationSec, size: fs.statSync(file).size };
      writeFileAtomic(this.manifestPath(dir), JSON.stringify(manifest));
      rendered++;
    }

    const list = chunks.map(c => "file '" + c.id + ".mp4'").join('\n');
    fs.writeFileSync(path.join(dir, 'list.txt'), list);
    const part = outPath + '.part.mp4';
    await this.runner.run(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', path.resolve(part)], { cwd: dir, label: 'concat' });
    fs.renameSync(part, outPath);
    const total = chunks.reduce((n, c) => n + c.durationSec, 0);
    const info = await this.runner.probe(outPath);
    if (!info.hasVideo || Math.abs(info.duration - total) > 1.0) throw new Error('joined video is ' + info.duration.toFixed(2) + 's, expected ' + total.toFixed(2) + 's');
    return { path: outPath, resumed, rendered, durationSec: info.duration };
  }
}

module.exports = { ChunkedRenderer };
