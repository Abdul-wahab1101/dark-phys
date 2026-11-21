'use strict';
/**
 * Video Format Planner  (YouTube Automation Agent add-on)
 *
 * Picks one of 6 video formats per video (so channel does not look like one template),
 * and produces everything an editor/pipeline needs:
 *   - format + hook style + 3 hook lines + title options
 *   - section outline with target durations and script word target
 *   - shot plan (edit decision list: duration, visual type, motion, b-roll query)
 *   - music brief (mood, search tags, gain, ducking)
 *   - caption style + real SRT/ASS generation (3-5 word chunks, keyword highlight)
 *   - chapters text for description, policy/safety warnings
 *   - ffmpeg helpers: burnCaptions(), mixAudio() (music ducking + loudness normalisation)
 *
 * No paid APIs. Only Node built-ins (+ ffmpeg on PATH or FFMPEG_PATH for the two helpers).
 * Rotation history is stored in data/video-format-history.json so consecutive videos differ.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

/* ------------------------------ helpers ------------------------------ */

function seedFrom(value) {
  return parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STOP = new Set('the a an and or of to in on for with is are was were be been being this that these those it its you your they them their we our i me my he she his her at by from as but not no so if then than about into over under how what why when who which can will just more most very really also have has had do does did out up down off too'.split(' '));

const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

function weighted(rng, weights, avoid) {
  const entries = Object.entries(weights).filter(([k]) => k !== avoid);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

function srtTime(t) {
  t = Math.max(0, t);
  const ms = Math.round((t % 1) * 1000);
  const total = Math.floor(t);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function assTime(t) {
  t = Math.max(0, t);
  const cs = Math.round((t % 1) * 100);
  const total = Math.floor(t);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function hexToAss(hex, alpha = 0) {
  const h = String(hex).replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
}

/* ------------------------------ topic knowledge ------------------------------ */

const TOPICS = [
  { id: 'gaslighting', re: /gaslight/i, concept: 'gaslighting', emotion: 'self-doubt', symbols: ['cracked mirror', 'fog', 'broken glass', 'blank phone screen'] },
  { id: 'narcissism', re: /narciss/i, concept: 'narcissism', emotion: 'unease', symbols: ['golden mask', 'mirror', 'spotlight', 'pedestal'] },
  { id: 'manipulation', re: /manipulat|mind game|puppet|coerc/i, concept: 'manipulation', emotion: 'suspicion', symbols: ['puppet strings', 'chess pieces', 'shadow behind person'] },
  { id: 'emotional-control', re: /guilt|love.?bomb|silent treatment|emotional (abuse|control|blackmail)|controlling/i, concept: 'emotional control', emotion: 'pressure', symbols: ['red thread', 'glass jar', 'tangled rope'] },
  { id: 'relationships', re: /relationship|toxic|partner|red flag|dating|betray/i, concept: 'toxic relationship patterns', emotion: 'heartache', symbols: ['empty chair', 'two silhouettes apart', 'cracked wall'] },
  { id: 'workplace', re: /workplace|office|boss|colleague|coworker|corporate/i, concept: 'office power games', emotion: 'tension', symbols: ['glass office', 'long shadow', 'meeting table'] },
  { id: 'body-language', re: /body language|micro.?expression|eye contact|gesture|nonverbal|lie detect/i, concept: 'body language', emotion: 'attention', symbols: ['eyes close up', 'hands', 'crossed arms'] },
  { id: 'persuasion', re: /persua|influence|negotiat|sales|charisma/i, concept: 'persuasion', emotion: 'curiosity', symbols: ['handshake', 'speaker on stage', 'hypnotic spiral'] },
  { id: 'social-influence', re: /peer pressure|conformity|groupthink|crowd|social proof|social media|algorithm/i, concept: 'social pressure', emotion: 'isolation', symbols: ['crowd one person apart', 'phone glow', 'identical figures'] },
  { id: 'cognitive-bias', re: /bias|fallac|heuristic|dunning|anchoring|sunk cost|illusion/i, concept: 'cognitive bias', emotion: 'surprise', symbols: ['blindfolded brain', 'tinted glasses', 'maze'] }
];
const DEFAULT_TOPIC = { id: 'human-behavior', concept: 'hidden human behavior', emotion: 'curiosity', symbols: ['silhouette', 'city at night', 'reflection in window'] };

/* ------------------------------ formats ------------------------------ */

const FORMATS = {
  'signs-list': {
    name: 'Signs List', nameUrdu: 'Nishaniyan ki list', minutes: [8, 11], shotRange: [3, 4.5],
    sections: [
      { id: 'hook', label: 'Hook', share: 0.05, purpose: 'Name the feeling the viewer has had; promise they will recognise the pattern.', visual: ['closeup', 'symbolic'] },
      { id: 'promise', label: 'What you will learn', share: 0.04, purpose: 'One-line promise plus why most people miss these signs.', visual: ['textcard', 'animation'] },
      { id: 'item', label: 'Sign', share: 0.76, items: true, purpose: 'Sign name, short everyday example (2 sentences), why it works on the mind, what to notice.', visual: null },
      { id: 'action', label: 'What to do', share: 0.10, purpose: 'Three protective steps. Calm, practical, no diagnosis.', visual: ['animation', 'textcard'] },
      { id: 'outro', label: 'Outro', share: 0.05, purpose: 'One reflection question, a pointer to the next video.', visual: ['closeup', 'symbolic'] }
    ],
    hookStyles: ['pov', 'question', 'bold-claim'],
    visualMix: { footage: 3, closeup: 2, animation: 2, textcard: 2, symbolic: 1 },
    music: { mood: 'tense dark ambient', tags: ['Dark', 'Suspenseful', 'Ambient'], gainDb: -19, duckDb: 10, swell: false },
    captions: 'bold-bottom', thumbnailFamilies: ['bold-illustration', 'viral-contrast', 'split-screen', 'editorial-collage'],
    titles: ['{n} Signs of {Concept} Most People Miss', 'The {n} Quiet Signs of {Concept}', '{n} {Concept} Signs You Are Ignoring']
  },
  'story-case': {
    name: 'Story + Analysis', nameUrdu: 'Kahani aur tajziya', minutes: [9, 12], shotRange: [4, 6],
    sections: [
      { id: 'hook', label: 'Cold open scene', share: 0.07, purpose: 'Open in the middle of a tense moment of the story. No intro.', visual: ['closeup', 'footage'] },
      { id: 'story1', label: 'Story part 1', share: 0.17, purpose: 'Meet the character; everything looks normal.', visual: ['footage', 'symbolic'] },
      { id: 'pause1', label: 'Psychology pause 1', share: 0.14, purpose: 'Stop the story and name the first tactic and why it works.', visual: ['diagram', 'animation'] },
      { id: 'story2', label: 'Story part 2', share: 0.17, purpose: 'Escalation; the character starts doubting.', visual: ['footage', 'closeup'] },
      { id: 'pause2', label: 'Psychology pause 2', share: 0.14, purpose: 'Name the pattern, show how it repeats.', visual: ['diagram', 'split'] },
      { id: 'turn', label: 'Turning point', share: 0.13, purpose: 'The character notices the pattern.', visual: ['closeup', 'symbolic'] },
      { id: 'action', label: 'Protect yourself', share: 0.13, purpose: 'Three steps the viewer can use. Calm tone.', visual: ['textcard', 'animation'] },
      { id: 'outro', label: 'Outro', share: 0.05, purpose: 'Reflection question and next video.', visual: ['symbolic'] }
    ],
    hookStyles: ['mini-story', 'pov', 'contrast'],
    visualMix: { footage: 4, closeup: 2, symbolic: 2, diagram: 1, animation: 1 },
    music: { mood: 'cinematic suspense with slow swells', tags: ['Dramatic', 'Suspenseful', 'Cinematic'], gainDb: -18, duckDb: 9, swell: true },
    captions: 'cinema-subtle', thumbnailFamilies: ['cinematic-documentary', 'dark-thriller', 'face-closeup', 'manipulation-story'],
    titles: ['The Story That Shows How {Concept} Really Works', 'How {Concept} Slowly Took Over Her Life', 'A Quiet Case of {Concept}']
  },
  'myth-buster': {
    name: 'Myth Buster', nameUrdu: 'Ghalat fehmi todna', minutes: [6, 9], shotRange: [2.5, 3.5],
    sections: [
      { id: 'hook', label: 'Hook', share: 0.07, purpose: 'State the popular belief confidently, then say it is incomplete.', visual: ['textcard', 'split'] },
      { id: 'belief', label: 'Why people believe it', share: 0.14, purpose: 'Where the myth comes from; why it feels true.', visual: ['footage', 'animation'] },
      { id: 'item', label: 'Myth', share: 0.56, items: true, purpose: 'Myth, what is actually true, one concrete example.', visual: ['split', 'textcard', 'animation'] },
      { id: 'rule', label: 'Better rule of thumb', share: 0.17, purpose: 'One simple, honest rule viewers can remember.', visual: ['textcard', 'diagram'] },
      { id: 'outro', label: 'Outro', share: 0.06, purpose: 'Challenge question; next video.', visual: ['closeup'] }
    ],
    hookStyles: ['contrast', 'bold-claim', 'question'],
    visualMix: { split: 3, textcard: 3, animation: 2, footage: 2, diagram: 1 },
    music: { mood: 'minimal pulse, low tension', tags: ['Dark', 'Tense', 'Minimal'], gainDb: -20, duckDb: 10, swell: false },
    captions: 'bold-bottom', thumbnailFamilies: ['split-screen', 'viral-contrast', 'magazine-editorial', 'bold-illustration'],
    titles: ['The {Concept} Myth Almost Everyone Believes', '{n} Myths About {Concept} That Need to Stop', 'What People Get Wrong About {Concept}']
  },
  'direct-address': {
    name: 'Does This Happen To You?', nameUrdu: 'Kya aap ke saath hota hai?', minutes: [7, 10], shotRange: [3, 5],
    sections: [
      { id: 'hook', label: 'Rapid-fire questions', share: 0.08, purpose: 'Four short "Have you ever..." questions that create recognition.', visual: ['closeup', 'footage'] },
      { id: 'recognise', label: 'Recognition', share: 0.12, purpose: 'Tell the viewer they are not imagining it.', visual: ['footage', 'symbolic'] },
      { id: 'explain', label: 'What is really going on', share: 0.30, purpose: 'The psychology behind it in plain words, with one example.', visual: ['diagram', 'animation', 'footage'] },
      { id: 'reframe', label: 'Reframe', share: 0.17, purpose: 'Why this is not their fault; what it says about the other behaviour.', visual: ['closeup', 'textcard'] },
      { id: 'action', label: 'What you can do', share: 0.25, purpose: 'Three concrete steps; suggest talking to a professional for serious situations.', visual: ['textcard', 'animation'] },
      { id: 'outro', label: 'Outro', share: 0.08, purpose: 'Warm closing line; next video.', visual: ['closeup'] }
    ],
    hookStyles: ['question', 'pov', 'bold-claim'],
    visualMix: { closeup: 3, footage: 3, textcard: 2, animation: 1, symbolic: 1 },
    music: { mood: 'warm dark ambient, slow', tags: ['Calm', 'Dark', 'Ambient'], gainDb: -19, duckDb: 8, swell: false },
    captions: 'bold-bottom', thumbnailFamilies: ['face-closeup', 'editorial-collage', 'viral-contrast', 'split-screen'],
    titles: ['If This Keeps Happening, It Is Not In Your Head', 'Why Do You Feel Like This Around Certain People?', 'The Feeling You Cannot Explain: {Concept}']
  },
  'case-study': {
    name: 'Research / Case Study', nameUrdu: 'Research ya asli misaal', minutes: [10, 13], shotRange: [5, 7],
    sections: [
      { id: 'hook', label: 'Hook', share: 0.06, purpose: 'The surprising result first; do not explain yet.', visual: ['symbolic', 'closeup'] },
      { id: 'setup', label: 'The setup', share: 0.16, purpose: 'Who, when, what they tried. Only verified facts; name the source.', visual: ['footage', 'textcard'] },
      { id: 'event', label: 'What happened', share: 0.24, purpose: 'Step by step, as a story.', visual: ['footage', 'animation', 'diagram'] },
      { id: 'result', label: 'The result', share: 0.14, purpose: 'The finding, with honest limits (what the study cannot prove).', visual: ['diagram', 'textcard'] },
      { id: 'meaning', label: 'What it reveals', share: 0.18, purpose: 'The psychological principle behind it.', visual: ['diagram', 'symbolic'] },
      { id: 'everyday', label: 'In everyday life', share: 0.16, purpose: 'Two modern examples the viewer recognises.', visual: ['footage', 'closeup'] },
      { id: 'outro', label: 'Outro', share: 0.06, purpose: 'Reflection and next video. Put sources in the description.', visual: ['symbolic'] }
    ],
    hookStyles: ['bold-claim', 'contrast', 'question'],
    visualMix: { footage: 3, diagram: 3, textcard: 2, symbolic: 1, animation: 1 },
    music: { mood: 'documentary, restrained, slow build', tags: ['Documentary', 'Dark', 'Serious'], gainDb: -20, duckDb: 9, swell: true },
    captions: 'clean-lowerthird', thumbnailFamilies: ['magazine-editorial', 'neuro-illustration', 'cinematic-documentary', 'surreal-conceptual'],
    titles: ['The Experiment That Explains {Concept}', 'What a Famous Study Reveals About {Concept}', 'Inside the Research on {Concept}']
  },
  'short': {
    name: 'Short (30-60s)', nameUrdu: 'Short video', minutes: [0.5, 1], shotRange: [1.5, 2.5],
    sections: [
      { id: 'hook', label: 'Hook', share: 0.12, purpose: 'One striking line in the first 2 seconds.', visual: ['closeup', 'textcard'] },
      { id: 'point', label: 'One point', share: 0.60, purpose: 'One idea, one example. No extras.', visual: ['footage', 'animation', 'textcard'] },
      { id: 'payoff', label: 'Payoff', share: 0.20, purpose: 'The line people will remember.', visual: ['textcard', 'closeup'] },
      { id: 'loop', label: 'Loop line', share: 0.08, purpose: 'End so it flows back into the hook; invite to the long video.', visual: ['symbolic'] }
    ],
    hookStyles: ['bold-claim', 'question', 'contrast'],
    visualMix: { closeup: 2, textcard: 3, footage: 2, animation: 1 },
    music: { mood: 'punchy low pulse', tags: ['Dark', 'Tense', 'Driving'], gainDb: -17, duckDb: 8, swell: false },
    captions: 'center-punch', thumbnailFamilies: ['viral-contrast', 'bold-illustration', 'face-closeup'],
    titles: ['{Concept} in 30 Seconds', 'Do Not Ignore This About {Concept}', 'One Sign of {Concept}']
  }
};

const FORMAT_IDS = Object.keys(FORMATS);

const CAPTION_STYLES = {
  'bold-bottom': { font: 'Montserrat', fallback: 'Inter', size: 66, outline: 5, shadow: 2, align: 2, marginV: 90, maxWords: 4, maxChars: 26, text: '#FFFFFF', hi: '#FFD84A', outlineColor: '#000000', box: false, pop: true },
  'cinema-subtle': { font: 'Inter', fallback: 'Arial', size: 54, outline: 3, shadow: 2, align: 2, marginV: 70, maxWords: 5, maxChars: 34, text: '#F4F1EA', hi: '#F2A23A', outlineColor: '#000000', box: false, pop: false },
  'center-punch': { font: 'Montserrat', fallback: 'Inter', size: 92, outline: 7, shadow: 3, align: 5, marginV: 40, maxWords: 3, maxChars: 18, text: '#FFFFFF', hi: '#FF4B4B', outlineColor: '#000000', box: false, pop: true },
  'clean-lowerthird': { font: 'Inter', fallback: 'Arial', size: 50, outline: 0, shadow: 0, align: 2, marginV: 80, maxWords: 5, maxChars: 34, text: '#FFFFFF', hi: '#7DE2D1', outlineColor: '#000000', box: true, pop: false }
};

const HOOKS = {
  question: [
    'Have you ever felt something was off in a conversation, but could not explain what?',
    'What if {concept} has been happening around you, and you never had a name for it?',
    'Why does {concept} work so well on smart, caring people?'
  ],
  'bold-claim': [
    '{Concept} does not announce itself. It hides inside things that sound like care.',
    'The most effective {concept} never feels like {concept}. That is the whole trick.',
    'Most people learn about {concept} only after it has already cost them something.'
  ],
  'mini-story': [
    'It started with one small sentence: "That never happened." Two years later, she no longer trusted her own memory.',
    'He was kind, helpful and always available. It took her months to notice that everything she did had to pass through him first.',
    'Nothing dramatic happened. That was the problem. It was a hundred tiny moments, each easy to explain away.'
  ],
  contrast: [
    'Everyone thinks they can spot {concept}. Almost nobody can. Here is why.',
    'You were told {concept} is loud and obvious. In real life it is quiet and polite.',
    'People say it is just a personality clash. Psychology says it is a pattern.'
  ],
  pov: [
    'You replay the conversation again. Something felt wrong, but you cannot say what. That feeling has a name.',
    'You apologise, even though you are not sure what you did. You do this more than you would like to admit.',
    'You tell yourself you are overreacting. Again. Pay attention to how often you say that.'
  ]
};

const HARMFUL = /\bhow to (manipulate|control|brainwash|seduce|trick|deceive|gaslight|stalk|exploit)\b|\bmanipulate (her|him|them|women|men|people)\b|\bmake (her|him|them) (obey|submit|fall)\b/i;
const MEDICAL = /diagnos|disorder|cure|treat(ment)?|therapy|symptom|mental illness|bipolar|depress|ptsd/i;

/* ------------------------------ planner ------------------------------ */

class VideoFormatPlanner {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.historyPath = options.historyPath || path.join(this.dataDir, 'video-format-history.json');
    this.useHistory = options.useHistory !== false;
    this.ffmpeg = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  }

  static get FORMATS() { return FORMATS; }
  static get FORMAT_IDS() { return FORMAT_IDS; }

  /* ---------- history ---------- */
  readHistory() {
    if (!this.useHistory) return [];
    try {
      const d = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      return Array.isArray(d.videos) ? d.videos : [];
    } catch (_) { return []; }
  }

  recordHistory(entry) {
    if (!this.useHistory) return;
    try {
      fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
      const videos = this.readHistory().concat([{ ...entry, at: new Date().toISOString() }]).slice(-40);
      fs.writeFileSync(this.historyPath, JSON.stringify({ updatedAt: new Date().toISOString(), videos }, null, 2));
    } catch (_) { /* history is best effort */ }
  }

  /* ---------- analysis ---------- */
  getText(script) {
    const parts = [];
    const push = v => {
      if (!v) return;
      if (typeof v === 'string') parts.push(v);
      else if (Array.isArray(v)) v.forEach(push);
      else if (typeof v === 'object') ['text', 'narration', 'content', 'voiceover', 'script', 'hook', 'body'].forEach(k => push(v[k]));
    };
    ['hook', 'intro', 'script', 'content', 'narration', 'sections', 'segments', 'description'].forEach(k => push(script[k]));
    return parts.join(' ').slice(0, 8000);
  }

  analyze(script) {
    const title = String(script.title || script.topic || '').trim();
    const body = this.getText(script);
    const all = title + ' ' + body;
    const topic = TOPICS.find(t => t.re.test(title)) || TOPICS.find(t => t.re.test(all)) || DEFAULT_TOPIC;

    const numMatch = title.match(/\b(\d{1,2})\b\s+(signs?|red flags?|tactics?|ways|traps|tricks|phrases|lies|habits|rules|reasons|mistakes|myths?|things)/i);
    const count = numMatch ? Math.min(10, Math.max(3, parseInt(numMatch[1], 10))) : null;
    const noun = numMatch ? numMatch[2].toLowerCase() : null;

    const words = all.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
    const freq = new Map();
    words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
    const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);

    return { title, topic, count, noun, keywords, isQuestion: /\?/.test(title), hasBody: body.length > 0, wantsShort: !!(script.short || script.isShort || /\bshort\b/i.test(script.format || '')) };
  }

  /* ---------- format selection ---------- */
  scoreFormats(analysis, history, forcedFormat) {
    const t = analysis.title;
    const rng = mulberry32(seedFrom(t + '|format'));
    const recent = history.slice(-4).reverse();
    const scores = {};

    for (const id of FORMAT_IDS) {
      let s = 1 + rng() * 0.8;
      if (id === 'signs-list' && analysis.count && /sign|flag|tactic|phrase|habit|trap|trick/i.test(analysis.noun || '')) s += 4;
      if (id === 'myth-buster' && (/myth|truth|wrong|really|actually|lie|isn't|not what|misunderstood/i.test(t) || /myth/i.test(analysis.noun || ''))) s += 4;
      if (id === 'story-case' && /story|case|how (she|he|they|a|an|the)\b|when (she|he|they)|diary|real life|what happened|victim/i.test(t)) s += 3.5;
      if (id === 'direct-address' && (/\byou(r)?\b/i.test(t) || analysis.isQuestion)) s += 2.5;
      if (id === 'case-study' && /experiment|study|research|history|famous|milgram|stanford|psychology of|science|why (do|does|are|is)/i.test(t)) s += 3.5;
      if (id === 'short') s += analysis.wantsShort ? 20 : -6;
      if (analysis.count && id === 'myth-buster' && /myth/i.test(analysis.noun || '')) s += 1;
      const idx = recent.findIndex(v => v.formatId === id);
      if (idx === 0) s -= 7; else if (idx > 0) s -= Math.max(1, 3.6 - idx * 0.9);
      scores[id] = s;
    }

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const chosen = forcedFormat && FORMATS[forcedFormat] ? forcedFormat : ranked[0][0];
    return { chosen, ranked: ranked.map(([id, score]) => ({ id, score: Number(score.toFixed(2)) })) };
  }

  /* ---------- planning ---------- */
  planVideo(script = {}, options = {}) {
    const analysis = this.analyze(script);
    if (!analysis.title) throw new Error('A title or topic is required');
    const history = this.readHistory();
    const { chosen, ranked } = this.scoreFormats(analysis, history, options.format || script.format);
    const fmt = FORMATS[chosen];
    const rng = mulberry32(seedFrom(analysis.title + '|' + chosen));

    const totalSec = Math.round(options.durationSec || (fmt.minutes[0] + rng() * (fmt.minutes[1] - fmt.minutes[0])) * 60);

    // hook style rotates: prefer a style not used by the previous video
    const lastHook = history.length ? history[history.length - 1].hookStyle : null;
    const styles = fmt.hookStyles.filter(s => s !== lastHook);
    const hookStyle = (styles.length ? styles : fmt.hookStyles)[Math.floor(rng() * (styles.length || fmt.hookStyles.length))];

    const concept = analysis.topic.concept;
    const fill = tpl => tpl.replace(/\{Concept\}/g, cap(concept)).replace(/\{concept\}/g, concept).replace(/\{n\}/g, analysis.count || 5);
    const hookLines = HOOKS[hookStyle].map(fill);
    const titleOptions = fmt.titles.map(fill);

    // sections
    const itemCount = fmt.sections.some(s => s.items) ? (analysis.count || (chosen === 'myth-buster' ? 4 : 5)) : 0;
    const sections = [];
    let cursor = 0;
    for (const sec of fmt.sections) {
      const secDur = totalSec * sec.share;
      if (sec.items) {
        const per = secDur / itemCount;
        for (let i = 0; i < itemCount; i++) {
          sections.push({ id: `${sec.id}${i + 1}`, label: `${sec.label} ${i + 1}`, purpose: sec.purpose, start: cursor, duration: per, visual: sec.visual });
          cursor += per;
        }
      } else {
        sections.push({ id: sec.id, label: sec.label, purpose: sec.purpose, start: cursor, duration: secDur, visual: sec.visual });
        cursor += secDur;
      }
    }
    sections.forEach(s => { s.start = Math.round(s.start); s.duration = Math.round(s.duration); });

    const shotPlan = this.buildShotPlan(sections, fmt, analysis, rng);

    const warnings = [];
    if (HARMFUL.test(analysis.title)) warnings.push('Title reads like instructions for harming/controlling people. Reframe as protection ("how to recognise / protect yourself from ..."), otherwise limited ads or removal is more likely.');
    if (MEDICAL.test(analysis.title + ' ' + this.getText(script).slice(0, 2000))) warnings.push('Medical/clinical wording found. Avoid diagnosing; say "signs to watch" and keep the disclaimer in the description.');
    if (history.length >= 3 && history.slice(-3).every(v => v.formatId === chosen)) warnings.push('Same format used 4 times in a row; pick another format for variety.');

    const plan = {
      title: analysis.title,
      topic: analysis.topic.id,
      format: { id: chosen, name: fmt.name, nameUrdu: fmt.nameUrdu },
      formatRanking: ranked,
      durationSec: totalSec,
      durationLabel: fmtClock(totalSec),
      scriptWordTarget: Math.round(totalSec * 2.5),
      hook: { style: hookStyle, options: hookLines, rule: 'Say the hook in the first 2 seconds. No greeting, no channel intro before it.' },
      titleOptions,
      itemCount: itemCount || null,
      sections,
      shotPlan,
      shotCount: shotPlan.length,
      averageShotSec: Number((totalSec / shotPlan.length).toFixed(2)),
      music: this.buildMusicBrief(fmt, totalSec, sections),
      captions: { style: fmt.captions, ...CAPTION_STYLES[fmt.captions] },
      thumbnailFamilies: fmt.thumbnailFamilies,
      chapters: this.buildChapters(sections),
      descriptionDisclaimer: 'This video is for education and awareness only. It is not medical or psychological advice. If you feel unsafe or are in a harmful situation, please reach out to a qualified professional or a trusted person.',
      warnings
    };

    if (options.record !== false) this.recordHistory({ title: analysis.title, formatId: chosen, hookStyle });
    return plan;
  }

  buildShotPlan(sections, fmt, analysis, rng) {
    const shots = [];
    const motions = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'hold'];
    const symbols = analysis.topic.symbols;
    const queries = {
      footage: () => `${analysis.topic.emotion} person conversation cinematic`,
      closeup: () => 'face close up serious expression eyes',
      animation: () => `motion graphic dark minimal ${analysis.topic.concept}`,
      textcard: () => 'key phrase on dark background',
      symbolic: () => pick(rng, symbols),
      diagram: () => 'brain diagram neural network glow',
      split: () => 'two contrasting scenes side by side'
    };
    let prevVisual = null, prevMotion = null, t = 0;

    for (const sec of sections) {
      let used = 0;
      let first = true;
      while (used < sec.duration - 0.4) {
        let len = fmt.shotRange[0] + rng() * (fmt.shotRange[1] - fmt.shotRange[0]);
        if (first && sec.id === 'hook') len = Math.min(len, 3);
        len = Math.min(len, sec.duration - used);
        if (len < 0.8 && shots.length) { shots[shots.length - 1].duration = Number((shots[shots.length - 1].duration + len).toFixed(2)); used += len; break; }

        let visual;
        if (sec.visual && sec.visual.length) {
          const options = sec.visual.filter(v => v !== prevVisual);
          visual = pick(rng, options.length ? options : sec.visual);
        } else {
          visual = weighted(rng, fmt.visualMix, prevVisual);
        }
        let motion = pick(rng, motions.filter(m => m !== prevMotion));
        if (visual === 'textcard' || visual === 'diagram') motion = 'hold';

        shots.push({
          index: shots.length + 1,
          start: Number((sec.start + used).toFixed(2)),
          duration: Number(len.toFixed(2)),
          section: sec.id,
          visual,
          motion,
          transition: first ? 'cut' : (rng() < 0.12 ? 'dip-to-black' : 'cut'),
          brollQuery: queries[visual](),
          note: visual === 'textcard' ? 'Show the key phrase of this sentence (max 6 words).' : ''
        });
        prevVisual = visual; prevMotion = motion;
        used += len; first = false;
      }
      t = sec.start + sec.duration;
    }
    return shots;
  }

  buildMusicBrief(fmt, totalSec, sections) {
    const m = fmt.music;
    const cues = [{ at: 0, action: 'start music under the hook', gainDb: m.gainDb + 3 }];
    if (m.swell) {
      const mid = sections[Math.floor(sections.length / 2)];
      cues.push({ at: mid.start, action: 'slow swell on the key reveal, +3 dB for 6s then back', gainDb: m.gainDb + 3 });
    }
    const last = sections[sections.length - 1];
    cues.push({ at: Math.max(0, last.start), action: 'drop 3 dB for the closing line', gainDb: m.gainDb - 3 });
    return {
      mood: m.mood,
      searchTags: m.tags,
      source: 'YouTube Audio Library (free) or other royalty-free library. Always keep the licence note.',
      musicGainDb: m.gainDb,
      duckingDb: m.duckDb,
      fadeInSec: 2, fadeOutSec: 4,
      loudnessTarget: '-14 LUFS integrated, true peak -1.5 dB',
      rules: ['Music must always sit below the voice (it is ducked automatically in mixAudio).', 'Allow 1-2 seconds of near-silence before the main reveal.', 'Do not use the same track in two consecutive videos.'],
      cues
    };
  }

  buildChapters(sections) {
    const keep = sections.filter(s => !/^(hook|promise|outro|loop)$/.test(s.id));
    const lines = ['0:00 Intro'];
    for (const s of keep) {
      if (s.start >= 10) lines.push(fmtClock(s.start) + ' ' + s.label);
    }
    return lines.join('\n');
  }

  /* ---------- captions ---------- */
  textToWords(text, durationSec, startSec = 0) {
    const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const weights = tokens.map(w => w.length + 2 + (/[.?!]$/.test(w) ? 4 : (/[,;:]$/.test(w) ? 2 : 0)));
    const total = weights.reduce((a, b) => a + b, 0);
    let t = startSec;
    return tokens.map((w, i) => {
      const d = durationSec * weights[i] / total;
      const item = { word: w, start: t, end: t + d };
      t += d;
      return item;
    });
  }

  buildCaptionChunks(words, styleName = 'bold-bottom', extraKeywords = []) {
    const style = CAPTION_STYLES[styleName] || CAPTION_STYLES['bold-bottom'];
    const kw = new Set(extraKeywords.map(k => String(k).toLowerCase()));
    const chunks = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
      cur = [];
    };
    for (const w of words) {
      const nextLen = (cur.map(x => x.word).join(' ') + ' ' + w.word).trim().length;
      if (cur.length && (cur.length >= style.maxWords || nextLen > style.maxChars)) flush();
      cur.push(w);
      if (/[.?!,;:]$/.test(w.word) && cur.length >= 2) flush();
    }
    flush();

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const next = chunks[i + 1];
      const limit = next ? next.start : c.end + 0.4;
      c.end = Math.max(c.start + 0.35, Math.min(c.end + 0.25, limit - 0.02));
      if (next && c.end > next.start) c.end = next.start - 0.01;
      const idx = c.words.findIndex(w => {
        const clean = w.word.toLowerCase().replace(/[^a-z0-9']/g, '');
        return kw.has(clean) || /\d/.test(clean) || (/^[A-Z]{3,}[^a-z]*$/.test(w.word)) || (clean.length >= 9 && !STOP.has(clean));
      });
      c.highlight = idx;
    }
    return chunks;
  }

  toSrt(chunks) {
    return chunks.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.words.map(w => w.word).join(' ')}\n`).join('\n');
  }

  toAss(chunks, styleName = 'bold-bottom', video = { width: 1920, height: 1080 }) {
    const s = CAPTION_STYLES[styleName] || CAPTION_STYLES['bold-bottom'];
    const border = s.box ? 3 : 1;
    const outline = s.box ? 14 : s.outline;
    const backColor = s.box ? hexToAss('#000000', 0x70) : hexToAss('#000000', 0x60);
    const header = [
      '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${video.width}`, `PlayResY: ${video.height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Default,${s.font},${Math.round(s.size * video.height / 1080)},${hexToAss(s.text)},${hexToAss(s.hi)},${hexToAss(s.outlineColor)},${backColor},-1,0,0,0,100,100,0,0,${border},${outline},${s.shadow},${s.align},80,80,${Math.round(s.marginV * video.height / 1080)},1`,
      '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ];
    const hiTag = `{\\c${hexToAss(s.hi)}}`;
    const baseTag = `{\\c${hexToAss(s.text)}}`;
    const lines = chunks.map(c => {
      const text = c.words.map((w, i) => {
        const safe = w.word.replace(/[{}\\]/g, '');
        return i === c.highlight ? `${hiTag}${safe}${baseTag}` : safe;
      }).join(' ');
      const pop = s.pop ? '{\\fscx88\\fscy88\\t(0,110,\\fscx100\\fscy100)}' : '';
      return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${pop}${text}`;
    });
    return header.concat(lines).join('\n') + '\n';
  }

  /**
   * words: [{word,start,end}] (e.g. from your TTS/whisper timings) OR pass { text, durationSec }.
   */
  generateCaptions(input, plan, outDir, baseName = 'captions') {
    const words = Array.isArray(input) ? input : this.textToWords(input.text, input.durationSec, input.startSec || 0);
    const styleName = (plan && plan.captions && plan.captions.style) || 'bold-bottom';
    const keywords = plan ? [plan.topic, ...(plan.title || '').toLowerCase().split(/\W+/).filter(w => w.length > 4 && !STOP.has(w))] : [];
    const chunks = this.buildCaptionChunks(words, styleName, keywords);
    const srt = this.toSrt(chunks);
    const ass = this.toAss(chunks, styleName);
    const result = { chunks: chunks.length, style: styleName };
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      result.srtPath = path.join(outDir, baseName + '.srt');
      result.assPath = path.join(outDir, baseName + '.ass');
      fs.writeFileSync(result.srtPath, srt, 'utf8');
      fs.writeFileSync(result.assPath, ass, 'utf8');
    }
    result.srt = srt; result.ass = ass;
    return result;
  }

  /* ---------- ffmpeg helpers ---------- */
  runFfmpeg(args) {
    const r = spawnSync(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true, timeout: 20 * 60 * 1000 });
    if (r.error) throw new Error('ffmpeg could not be started: ' + r.error.message);
    if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr || '').slice(-600));
  }

  static escapeFilterPath(p) {
    return path.resolve(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/,/g, '\\,');
  }

  burnCaptions(videoPath, assPath, outPath, crf = 20) {
    this.runFfmpeg(['-i', videoPath, '-vf', `ass='${VideoFormatPlanner.escapeFilterPath(assPath)}'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-c:a', 'copy', outPath]);
    return outPath;
  }

  buildAudioFilter(music = {}) {
    const gain = music.musicGainDb ?? -19;
    const fadeIn = music.fadeInSec ?? 2;
    const fadeOut = music.fadeOutSec ?? 4;
    const dur = music.durationSec;
    const fadeOutStart = dur ? Math.max(0, dur - fadeOut) : 0;
    const fo = dur ? `,afade=t=out:st=${fadeOutStart}:d=${fadeOut}` : '';
    return `[1:a]volume=${gain}dB,afade=t=in:st=0:d=${fadeIn}${fo}[m];` +
      `[0:a]asplit=2[v][vsc];` +
      `[m][vsc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=450[md];` +
      `[v][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  }

  /** Mix narration + music with automatic ducking and loudness normalisation. */
  mixAudio(voicePath, musicPath, outPath, music = {}) {
    const filter = this.buildAudioFilter(music);
    this.runFfmpeg(['-i', voicePath, '-stream_loop', '-1', '-i', musicPath, '-filter_complex', filter, '-map', '[a]', '-c:a', music.codec || 'aac', '-b:a', '192k', outPath]);
    return outPath;
  }

  /* ---------- one call: write all planning assets ---------- */
  generateAssets(script, outDir, options = {}) {
    const plan = this.planVideo(script, options);
    fs.mkdirSync(outDir, { recursive: true });
    const files = {};
    files.plan = path.join(outDir, 'video-plan.json');
    fs.writeFileSync(files.plan, JSON.stringify(plan, null, 2));
    files.chapters = path.join(outDir, 'chapters.txt');
    fs.writeFileSync(files.chapters, plan.chapters + '\n\n' + plan.descriptionDisclaimer + '\n');
    files.shots = path.join(outDir, 'shot-list.csv');
    fs.writeFileSync(files.shots, 'index,start,duration,section,visual,motion,transition,brollQuery\n' +
      plan.shotPlan.map(s => [s.index, s.start, s.duration, s.section, s.visual, s.motion, s.transition, '"' + s.brollQuery + '"'].join(',')).join('\n') + '\n');
    if (options.words || options.text) {
      const caps = this.generateCaptions(options.words || { text: options.text, durationSec: options.durationSec || plan.durationSec }, plan, outDir);
      files.srt = caps.srtPath; files.ass = caps.assPath;
    }
    return { plan, files };
  }
}

module.exports = { VideoFormatPlanner, FORMATS, CAPTION_STYLES };
