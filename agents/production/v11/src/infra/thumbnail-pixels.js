'use strict';
/** Pixel-level thumbnail checks at phone-feed sizes (needs the `sharp` package). */
const geo = require('../core/thumbnail-geometry');

function loadSharp() {
  try { return require('sharp'); } catch (e) { throw new Error('thumbnail pixel checks need the "sharp" package (npm install sharp)'); }
}

async function greyAt(sharp, file, size) {
  const { data, info } = await sharp(file).resize(size.w, size.h, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function crop(grey, box, fullW) {
  const k = grey.w / fullW;
  const x0 = Math.max(0, Math.floor(box.x * k)), y0 = Math.max(0, Math.floor(box.y * k));
  const x1 = Math.min(grey.w, Math.ceil((box.x + box.w) * k)), y1 = Math.min(grey.h, Math.ceil((box.y + box.h) * k));
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(grey.data[y * grey.w + x]);
  return out;
}

/**
 * @param {string} file image path
 * @param {{textBoxes?: Array<{x,y,w,h,fontSize?}>, text?: string}} opts boxes are in 1280x720 pixels
 */
async function analyzeThumbnail(file, { textBoxes = [], text = '' } = {}) {
  const sharp = loadSharp();
  const meta = await sharp(file).metadata();
  const findings = [];
  const add = f => findings.push(f);
  if (meta.width !== geo.W || meta.height !== geo.H) add({ level: 'fail', id: 'wrong_dimensions', detail: meta.width + 'x' + meta.height + ', expected 1280x720' });

  for (const f of geo.checkSafeZones(textBoxes)) add(f);
  for (const f of geo.checkTextSize(textBoxes)) add(f);
  for (const f of geo.checkWordCount(text)) add(f);

  const large = await greyAt(sharp, file, geo.FEED.large);
  const small = await greyAt(sharp, file, geo.FEED.small);
  const contrasts = [];
  textBoxes.forEach((b, i) => {
    const cl = geo.regionContrast(crop(large, b, geo.W));
    const cs = geo.regionContrast(crop(small, b, geo.W));
    contrasts.push({ box: 'text#' + (i + 1), feed360: Number(cl.toFixed(2)), feed168: Number(cs.toFixed(2)) });
    if (cl < 3) add({ level: 'fail', id: 'low_text_contrast_in_feed', box: 'text#' + (i + 1), detail: cl.toFixed(2) + ':1 at 360px (need 3:1+)' });
    else if (cs < 3) add({ level: 'warn', id: 'low_text_contrast_in_search_results', box: 'text#' + (i + 1), detail: cs.toFixed(2) + ':1 at 168px' });
    else if (cl < 4.5) add({ level: 'warn', id: 'contrast_below_4.5', box: 'text#' + (i + 1), detail: cl.toFixed(2) + ':1' });
  });

  const all = Array.from(large.data);
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const std = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
  if (mean < 22) add({ level: 'warn', id: 'very_dark_overall', detail: 'mean brightness ' + mean.toFixed(0) });
  if (mean > 235) add({ level: 'warn', id: 'washed_out_overall', detail: 'mean brightness ' + mean.toFixed(0) });
  if (std < 25) add({ level: 'warn', id: 'flat_image_may_not_stand_out', detail: 'tonal spread ' + std.toFixed(0) });

  const level = findings.some(f => f.level === 'fail') ? 'fail' : findings.length ? 'warn' : 'ok';
  return { level, findings, contrasts, metrics: { meanBrightness: Number(mean.toFixed(1)), tonalSpread: Number(std.toFixed(1)) }, note: 'Programmatic checks at 360px and 168px widths; no OCR, no judgement of appeal.' };
}

module.exports = { analyzeThumbnail };
