'use strict';
/**
 * Thumbnail layout rules for phone feeds (pure geometry). Canvas is 1280x720.
 * The timestamp badge and the edge UI cover parts of a thumbnail, so text must stay clear of them.
 */
const W = 1280, H = 720;

const SAFE = {
  margin: { x: 64, y: 36 },
  timestampBadge: { x: 1070, y: 612, w: 210, h: 108 },
  progressBar: { x: 0, y: 706, w: 1280, h: 14 },
  hoverIcons: { x: 1170, y: 0, w: 110, h: 80 }
};

const FEED = { large: { w: 360, h: 202 }, small: { w: 168, h: 94 } };

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function checkSafeZones(boxes) {
  const issues = [];
  boxes.forEach((b, i) => {
    const tag = 'text#' + (i + 1);
    if (b.x < SAFE.margin.x || b.y < SAFE.margin.y || b.x + b.w > W - SAFE.margin.x || b.y + b.h > H - SAFE.margin.y) issues.push({ level: 'warn', id: 'outside_margin', box: tag });
    if (intersects(b, SAFE.timestampBadge)) issues.push({ level: 'fail', id: 'under_timestamp_badge', box: tag });
    if (intersects(b, SAFE.progressBar)) issues.push({ level: 'fail', id: 'under_progress_bar', box: tag });
    if (intersects(b, SAFE.hoverIcons)) issues.push({ level: 'warn', id: 'under_hover_icons', box: tag });
  });
  return issues;
}

/** Cap height is about 0.7 of the font size. */
function capHeightAt(fontPx, feedWidth) { return fontPx * 0.7 * (feedWidth / W); }

function checkTextSize(boxes) {
  const issues = [];
  boxes.forEach((b, i) => {
    if (!b.fontSize) return;
    const tag = 'text#' + (i + 1);
    if (capHeightAt(b.fontSize, FEED.large.w) < 11) issues.push({ level: 'fail', id: 'too_small_in_feed', box: tag, detail: b.fontSize + 'px font' });
    else if (capHeightAt(b.fontSize, FEED.small.w) < 7) issues.push({ level: 'warn', id: 'too_small_in_search_results', box: tag, detail: b.fontSize + 'px font' });
  });
  return issues;
}

function checkWordCount(text, { maxWords = 6, maxChars = 36 } = {}) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const issues = [];
  if (words.length > maxWords) issues.push({ level: 'warn', id: 'too_many_words', detail: words.length + ' words' });
  if (String(text || '').length > maxChars) issues.push({ level: 'warn', id: 'too_many_characters', detail: String(text).length + ' chars' });
  return issues;
}

function srgbToLinear(v) { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

/** WCAG contrast ratio from two 0-255 grey levels. */
function contrastRatio(a, b) {
  const la = srgbToLinear(a), lb = srgbToLinear(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]; }

/** Contrast inside a region that contains text: spread between dark and light pixels. */
function regionContrast(greyValues) {
  const s = Array.from(greyValues).sort((a, b) => a - b);
  if (!s.length) return 1;
  return contrastRatio(percentile(s, 0.08), percentile(s, 0.92));
}

module.exports = { W, H, SAFE, FEED, intersects, checkSafeZones, checkTextSize, checkWordCount, contrastRatio, regionContrast, capHeightAt };
