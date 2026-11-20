'use strict';

const STOP = new Set('the a an and or of to in on for with is are was were be been being this that these those it its you your they them their we our i me my he she his her at by from as but not no so if then than about into over under how what why when who which can will just more most very really also have has had do does did out up down off too'.split(' '));

function words(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

function keywords(text) {
  return [...new Set(words(text).filter(w => w.length > 2 && !STOP.has(w)))];
}

function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function shingles(text, n = 5) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

module.exports = { words, keywords, sentences, shingles, jaccard };
