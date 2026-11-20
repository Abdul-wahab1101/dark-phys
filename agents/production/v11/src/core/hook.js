'use strict';
/**
 * Hook analysis for the first 5-15 seconds.
 * Heuristic checks on timed script segments. It scores craft rules that are widely used for short-form retention;
 * it cannot predict real audience retention.
 */
const { words, keywords, sentences } = require('./text');

const GREETING = /^\s*(hi|hello|hey|hii+|welcome|what'?s up|salam|assalam\w*|aoa|in this video|today (we|i|let'?s)|before (we|i) (start|begin)|(please )?(like|subscribe)|my name is)\b/i;

const DEVICES = {
  question: t => /\?/.test(t),
  'bold-claim': t => /\b(never|always|nobody|no one|everyone|secret|truth|hidden|lie|lies|dangerous|real reason|most people)\b/i.test(t),
  number: t => /\b\d+\b/.test(t),
  'open-loop': t => /\b(but|until|here'?s (why|how|what)|what happens next|and that'?s when|wait for|by the end|you'?ll see|the reason)\b/i.test(t),
  'direct-address': t => /\b(you|your|you'?re)\b/i.test(t),
  contrast: t => /\b(but|however|instead|actually|not what|yet)\b/i.test(t)
};

function detectDevices(text) {
  return Object.keys(DEVICES).filter(k => DEVICES[k](String(text || '')));
}

/** Build rough timings from plain script text when real TTS timings are not available. */
function segmentsFromScript(text, wordsPerMinute = 150) {
  const out = [];
  let t = 0;
  for (const s of sentences(text)) {
    const dur = Math.max(0.8, (words(s).length / wordsPerMinute) * 60);
    out.push({ start: Number(t.toFixed(2)), end: Number((t + dur).toFixed(2)), text: s });
    t += dur + 0.2;
  }
  return out;
}

function analyzeHook({ title = '', segments = [], windowSec = 15 } = {}) {
  const segs = [...segments].filter(s => s && s.text).sort((a, b) => a.start - b.start);
  const inWindow = segs.filter(s => s.start < windowSec);
  const checks = [];
  const add = (id, weight, pass, detail, suggestion) => checks.push({ id, weight, pass: !!pass, detail, suggestion: pass ? null : suggestion });

  if (!inWindow.length) {
    return { score: 0, grade: 'weak', windowSec, checks: [], issues: ['no_speech_in_window'], devices: [], suggestions: ['Speech must start inside the first 15 seconds; ideally within the first second.'], heuristic: true };
  }

  const first = inWindow[0];
  const hookText = inWindow.map(s => s.text).join(' ');
  const firstSentence = sentences(first.text)[0] || first.text;
  const early = inWindow.filter(s => s.start < 5).map(s => s.text).join(' ');

  add('fast-start', 15, first.start <= 1.0, 'speech starts at ' + first.start.toFixed(2) + 's', 'Start speaking within 1 second; trim leading silence.');
  add('no-greeting', 20, !GREETING.test(first.text), 'first line: "' + firstSentence.slice(0, 60) + '"', 'Drop greetings, channel intros and "in this video" openers; open with the claim, question or story.');
  add('punchy-first-line', 10, words(firstSentence).length <= 14, words(firstSentence).length + ' words in the first sentence', 'Keep the first sentence to 14 words or fewer.');
  add('device-in-5s', 15, detectDevices(early).length > 0, 'devices by 5s: ' + (detectDevices(early).join(', ') || 'none'), 'Use a question, a bold claim, a number or a story hint within the first 5 seconds.');

  const loopText = hookText;
  const hasLoop = DEVICES['open-loop'](loopText) || DEVICES.question(loopText) || (DEVICES.number(loopText) && /\b(signs?|ways?|tricks?|steps?|reasons?|mistakes?)\b/i.test(loopText));
  add('open-loop', 15, hasLoop, hasLoop ? 'curiosity gap present' : 'no curiosity gap by ' + windowSec + 's', 'Promise something that is paid off later ("...and the third one is the most dangerous").');
  add('direct-address', 5, DEVICES['direct-address'](hookText), 'speaks to the viewer: ' + DEVICES['direct-address'](hookText), 'Address the viewer directly with "you".');

  const lastEnd = Math.min(windowSec, Math.max(...inWindow.map(s => s.end)));
  const spanSec = Math.max(1, lastEnd - first.start);
  const wcount = inWindow.reduce((n, s) => {
    const dur = Math.max(0.1, s.end - s.start);
    const overlap = Math.max(0, Math.min(s.end, windowSec) - s.start);
    return n + words(s.text).length * (overlap / dur);
  }, 0);
  const wpm = (wcount / spanSec) * 60;
  add('pace', 10, wpm >= 125 && wpm <= 185, Math.round(wpm) + ' words per minute in the hook', 'Aim for roughly 125-185 words per minute in the hook.');

  let maxGap = 0;
  for (let i = 1; i < inWindow.length; i++) maxGap = Math.max(maxGap, inWindow[i].start - inWindow[i - 1].end);
  add('no-dead-air', 5, maxGap <= 0.8, 'longest gap ' + maxGap.toFixed(2) + 's', 'Remove pauses longer than 0.8 seconds inside the hook.');

  const tk = keywords(title);
  const hk = new Set(keywords(hookText));
  const overlap = tk.length ? tk.filter(k => hk.has(k)).length / tk.length : 1;
  add('title-match', 5, overlap >= 0.3, 'title keywords in hook: ' + Math.round(overlap * 100) + '%', 'Mention the title promise in the hook so the click is rewarded.');

  const score = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const grade = score >= 80 ? 'strong' : score >= 60 ? 'ok' : 'weak';
  return {
    score, grade, windowSec, checks,
    issues: checks.filter(c => !c.pass).map(c => c.id),
    devices: detectDevices(hookText),
    suggestions: checks.filter(c => !c.pass).map(c => c.suggestion),
    heuristic: true
  };
}

module.exports = { analyzeHook, detectDevices, segmentsFromScript, GREETING };
