const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Logger } = require('../utils/logger');

/* =====================================================================
 * Helpers (module scope, pure functions)
 * ===================================================================== */

const W = 1280;
const H = 720;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(value) {
  return parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

function hexToRgbArr(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relLuminanceHex(hex) {
  const [r, g, b] = hexToRgbArr(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function poly(points, fill, extra = '') {
  return '<polygon points="' + points.map(p => p[0] + ',' + p[1]).join(' ') + '" fill="' + fill + '" ' + extra + '/>';
}

function starburst(cx, cy, r1, r2, spikes, rng) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (Math.PI * i) / spikes;
    const r = i % 2 === 0 ? r2 * (0.85 + rng() * 0.15) : r1;
    pts.push([Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r)]);
  }
  return pts;
}

function dotsPattern(id, step, r, fill, opacity) {
  return '<pattern id="' + id + '" width="' + step + '" height="' + step + '" patternUnits="userSpaceOnUse">' +
    '<circle cx="' + step / 2 + '" cy="' + step / 2 + '" r="' + r + '" fill="' + fill + '" fill-opacity="' + opacity + '"/></pattern>';
}

function arrowSvg(x1, y1, x2, y2, color, width = 14, outline = '#000000') {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = width * 2.6;
  const bx = x2 - Math.cos(ang) * head * 0.8;
  const by = y2 - Math.sin(ang) * head * 0.8;
  const left = [x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head];
  const right = [x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head];
  const shaft = 'M' + x1 + ' ' + y1 + ' L' + Math.round(bx) + ' ' + Math.round(by);
  const tip = 'M' + x2 + ' ' + y2 + ' L' + Math.round(left[0]) + ' ' + Math.round(left[1]) + ' L' + Math.round(right[0]) + ' ' + Math.round(right[1]) + ' Z';
  return '<g stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="' + shaft + '" stroke="' + outline + '" stroke-width="' + (width + 8) + '" fill="none"/>' +
    '<path d="' + tip + '" fill="' + outline + '" stroke="' + outline + '" stroke-width="8"/>' +
    '<path d="' + shaft + '" stroke="' + color + '" stroke-width="' + width + '" fill="none"/>' +
    '<path d="' + tip + '" fill="' + color + '"/></g>';
}

function jaggedPath(rng, x1, y1, x2, y2, segments = 9, jitter = 34) {
  let d = 'M' + x1 + ' ' + y1;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = x1 + (x2 - x1) * t + (rng() - 0.5) * jitter;
    const y = y1 + (y2 - y1) * t + (rng() - 0.5) * jitter;
    d += ' L' + Math.round(x) + ' ' + Math.round(y);
  }
  return d;
}

const BRAIN_OUTLINE = 'M60 170 C20 120 50 50 120 45 C150 15 220 15 250 40 C310 35 345 90 320 140 C345 180 310 235 260 232 C240 262 190 270 165 245 C140 262 90 252 85 222 C55 225 40 195 60 170 Z';
const BRAIN_GYRI = [
  'M120 95 C150 80 175 110 205 90 S250 85 275 100',
  'M95 140 C130 120 150 160 185 140 S245 130 290 150',
  'M105 185 C140 170 165 200 200 182 S255 178 285 195',
  'M150 225 C175 210 200 235 230 215'
];

function brainDiagram(color, accent, rng, transform) {
  const nodes = [];
  for (let i = 0; i < 15; i++) nodes.push([70 + rng() * 250, 55 + rng() * 170]);
  let edges = '';
  nodes.forEach((n, i) => {
    const sorted = nodes.map((m, j) => ({ j, d: (m[0] - n[0]) ** 2 + (m[1] - n[1]) ** 2 }))
      .filter(o => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
    sorted.forEach(o => {
      edges += '<line x1="' + n[0].toFixed(0) + '" y1="' + n[1].toFixed(0) + '" x2="' + nodes[o.j][0].toFixed(0) + '" y2="' + nodes[o.j][1].toFixed(0) + '"/>';
    });
  });
  return '<g transform="' + transform + '">' +
    '<path d="' + BRAIN_OUTLINE + '" fill="' + color + '" fill-opacity=".14" stroke="' + color + '" stroke-width="5" filter="url(#glow)"/>' +
    '<g fill="none" stroke="' + color + '" stroke-width="3" stroke-opacity=".55" stroke-linecap="round">' +
    BRAIN_GYRI.map(d => '<path d="' + d + '"/>').join('') + '</g>' +
    '<g stroke="' + accent + '" stroke-width="1.6" stroke-opacity=".75">' + edges + '</g>' +
    '<g fill="' + accent + '" filter="url(#glow)">' +
    nodes.map(n => '<circle cx="' + n[0].toFixed(0) + '" cy="' + n[1].toFixed(0) + '" r="' + (3 + rng() * 4).toFixed(1) + '"/>').join('') + '</g>' +
    '</g>';
}

function commonDefs() {
  return '<filter id="sh" x="-20%" y="-30%" width="140%" height="170%">' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feOffset dy="6"/>' +
    '<feComponentTransfer><feFuncA type="linear" slope=".85"/></feComponentTransfer>' +
    '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<filter id="blur8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>' +
    '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
}

function svgWrap(inner, defs = '', w = W, h = H) {
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' + commonDefs() + defs + '</defs>' + inner + '</svg>';
}

function wrapHeadline(text, maxLines = 3) {
  const words = String(text || '').toUpperCase().replace(/[^\w\s?'!.:%$-]/g, '').split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words.length ? [words[0]] : ['LOOK CLOSER'];
  const total = words.join(' ').length;
  let best = null;
  const n = words.length;
  const tryCombo = (breaks) => {
    const lines = [];
    let start = 0;
    for (const b of [...breaks, n]) { lines.push(words.slice(start, b).join(' ')); start = b; }
    const lens = lines.map(l => l.length);
    const max = Math.max(...lens);
    const min = Math.min(...lens);
    const score = max + (max - min) * 0.35 + (lines.length - 1) * 2.5 + (lines.length === 1 && total > 12 ? 40 : 0);
    if (!best || score < best.score) best = { score, lines };
  };
  tryCombo([]);
  if (maxLines >= 2) for (let i = 1; i < n; i++) tryCombo([i]);
  if (maxLines >= 3) for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) tryCombo([i, j]);
  return best.lines;
}

/* =====================================================================
 * Fonts
 * ===================================================================== */

const FONT_SPECS = {
  impact: { cands: ['Anton', 'Impact', 'Haettenschweiler', 'Bebas Neue', 'Arial Black', 'Inter', 'Poppins'], serif: false },
  condensed: { cands: ['Bebas Neue', 'Oswald', 'Anton', 'Impact', 'Arial Narrow', 'Inter'], serif: false },
  oswald: { cands: ['Oswald', 'Bebas Neue', 'Anton', 'Impact', 'Inter'], serif: false },
  montserrat: { cands: ['Montserrat', 'Poppins', 'Inter', 'Segoe UI', 'Arial'], serif: false },
  poppins: { cands: ['Poppins', 'Montserrat', 'Inter', 'Segoe UI', 'Arial'], serif: false },
  inter: { cands: ['Inter', 'Segoe UI', 'Arial', 'Liberation Sans', 'DejaVu Sans'], serif: false },
  serif: { cands: ['Playfair Display', 'Georgia', 'Cambria', 'DejaVu Serif', 'Liberation Serif'], serif: true }
};

const FONT_WEIGHTS = {
  'Anton': 400, 'Impact': 400, 'Haettenschweiler': 400, 'Bebas Neue': 400, 'Arial Black': 400,
  'Oswald': 700, 'Arial Narrow': 700, 'Inter': 900, 'Poppins': 800, 'Montserrat': 800,
  'Segoe UI': 800, 'Arial': 700, 'Liberation Sans': 700, 'DejaVu Sans': 700,
  'Playfair Display': 800, 'Georgia': 700, 'Cambria': 700, 'DejaVu Serif': 700, 'Liberation Serif': 700
};

const WIN_FONT_FILES = [
  [/^impact\.ttf$/, 'Impact'], [/^anton/, 'Anton'], [/^bebasneue/, 'Bebas Neue'], [/^montserrat/, 'Montserrat'],
  [/^oswald/, 'Oswald'], [/^inter/, 'Inter'], [/^poppins/, 'Poppins'], [/^ariblk\.ttf$/, 'Arial Black'],
  [/^georgia/, 'Georgia'], [/^segoeui/, 'Segoe UI'], [/^playfair/, 'Playfair Display'], [/^hts?\d*|^haettenschweiler/, 'Haettenschweiler'],
  [/^arialn/, 'Arial Narrow'], [/^cambria/, 'Cambria'], [/^arial\.ttf$|^arialbd\.ttf$/, 'Arial']
];

function listInstalledFamilies() {
  const installed = new Set();
  try {
    const r = spawnSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.status === 0 && r.stdout) {
      r.stdout.split('\n').forEach(line => line.split(',').forEach(n => {
        const name = n.trim().toLowerCase();
        if (name) installed.add(name);
      }));
    }
  } catch (_) {}

  const dirs = [];
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  } else if (installed.size === 0) {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(process.env.HOME || '', '.fonts'));
  }
  const scan = (dir, depth = 0) => {
    let entries = [];
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.isDirectory() && depth < 3) { scan(path.join(dir, e.name), depth + 1); continue; }
      const lower = e.name.toLowerCase();
      for (const [re, family] of WIN_FONT_FILES) {
        if (re.test(lower)) installed.add(family.toLowerCase());
      }
    }
  };
  dirs.forEach(d => scan(d));
  return installed;
}

function buildFontStacks() {
  const installed = listInstalledFamilies();
  const detection = installed.size > 0;
  const stacks = {};
  for (const [key, spec] of Object.entries(FONT_SPECS)) {
    const available = detection ? spec.cands.filter(c => installed.has(c.toLowerCase())) : spec.cands.slice();
    const primary = available[0] || (spec.serif ? 'Georgia' : 'Arial');
    const tail = spec.serif ? "'DejaVu Serif','Times New Roman',serif" : "Arial,'Liberation Sans','DejaVu Sans',sans-serif";
    stacks[key] = {
      key,
      primary,
      weight: FONT_WEIGHTS[primary] || (spec.serif ? 700 : 800),
      stack: available.slice(0, 4).map(n => "'" + n + "'").concat([tail]).join(','),
      installedMatches: available
    };
  }
  return { stacks, detection, installedCount: installed.size };
}

/* =====================================================================
 * Topic profiles
 * ===================================================================== */

const TOPIC_PROFILES = [
  {
    id: 'gaslighting', test: /gaslight|make you doubt|rewrite|crazy|your memory|reality/i, termRe: /gaslight\w*/i, term: 'GASLIGHTING',
    eyebrow: 'REALITY CHECK', badges: ['MIND GAMES', 'REALITY CHECK', 'WARNING SIGNS'],
    split: ['WHAT HAPPENED', 'WHAT THEY CLAIM'],
    hooks: [['THEY TWIST', 'YOUR REALITY'], ['TRUST', 'YOUR INSTINCTS'], ['CONTROL', 'DISGUISED AS CARE']],
    headlines: ['DOUBT IS THEIR WEAPON', 'THEY REWRITE YOUR MEMORY', "YOU'RE NOT CRAZY", 'WHO CONTROLS YOUR REALITY?', 'THE LIE THAT FEELS TRUE', 'WHEN YOU STOP TRUSTING YOURSELF'],
    emotion: 'self-doubt and unease', conflict: 'your memory versus their version of events', metaphor: 'a cracked mirror and a distorted reflection',
    searches: [/couple|argument|conversation|serious/i, /thinking|alone|silhouette/i, /smartphone|texting|message/i],
    accent: '#C6A36A', grade: { brightness: 0.91, saturation: 0.88 },
    fam: { 'dark-thriller': 3, 'split-screen': 3, 'surreal-conceptual': 2.5, 'face-closeup': 2.5, 'graphic-novel': 1.5, 'manipulation-story': 1.5 },
    scenes: [
      { subject: 'a worried woman in her thirties staring at her own distorted reflection in a cracked mirror', pose: 'wide uncertain eyes, one hand pressed to her temple, shoulders tense', env: 'dim apartment bedroom at night with cold window light', focal: 'her eyes and the cracked glass' },
      { subject: 'two adults at a kitchen table, one calmly smirking while the other looks confused and hunched forward', pose: 'the calm one leans back with arms folded, the other grips her mug nervously', env: 'late-evening kitchen with a single warm hanging lamp', focal: 'the confused face in the foreground' },
      { subject: 'a man whispering behind a woman while she holds a glowing blank phone, her expression shaken', pose: 'she stares past the camera, he stands very close with a faint smile', env: 'dark hallway with a sliver of light from a doorway', focal: 'her shaken face' },
      { subject: 'a person in profile whose head dissolves into floating glass shards', pose: 'calm face, eyes closed, chin lifted', env: 'empty dark void with soft fog', focal: 'the point where the face fragments' }
    ]
  },
  {
    id: 'narcissism', test: /narciss|ego\b|self.centred|self.centered|self.absorb|grandios/i, termRe: /narciss\w*/i, term: 'NARCISSISM',
    eyebrow: 'HUMAN BEHAVIOR', badges: ['BEHIND THE MASK', 'PATTERN ALERT', 'CHARM VS CONTROL'],
    split: ['THE CHARM', 'THE TRUTH'],
    hooks: [['CHARM', 'IS THE COVER'], ['BEHIND', 'THE MASK'], ['SPOT', 'THE PATTERN']],
    headlines: ['CHARM IS THE COVER', 'BEHIND THE GOLDEN MASK', 'ALL ABOUT THEM', 'WHEN ADMIRATION IS THE GOAL', 'THE MASK SLIPS', 'SPOT THE PATTERN'],
    emotion: 'unease beneath charm', conflict: 'public charm versus private coldness', metaphor: 'a golden mask over a cold face',
    searches: [/person|portrait|couple/i, /thinking|alone|silhouette/i, /argument|serious|conversation/i],
    accent: '#E0B34A', grade: { brightness: 0.88, saturation: 0.86 },
    fam: { 'magazine-editorial': 3, 'cinematic-documentary': 2.5, 'face-closeup': 2.5, 'bold-illustration': 2, 'split-screen': 2, 'surreal-conceptual': 2 },
    scenes: [
      { subject: 'a charming man in a tailored suit smiling confidently while his long shadow behind him shows a cold sneering silhouette', pose: 'chest out, chin raised, one hand adjusting his cuff', env: 'luxurious lounge with warm gold highlights', focal: 'the smile and the darker shadow' },
      { subject: 'a person admiring themselves in an ornate golden mirror while blurred people fade away behind them', pose: 'eyes locked on own reflection, slight proud smirk', env: 'grand ballroom with soft bokeh', focal: 'the mirror reflection' },
      { subject: 'a half-peeled golden theatrical mask on a face revealing cold unblinking eyes', pose: 'perfectly still, expressionless stare straight at camera', env: 'near-black studio background with a single rim light', focal: 'the eyes beneath the mask' },
      { subject: 'a lone man standing on a tall pedestal while small figures look up at him', pose: 'arms crossed, looking down with satisfaction', env: 'stylised dusk sky with dramatic clouds', focal: 'the man on the pedestal' }
    ]
  },
  {
    id: 'manipulation', test: /manipulat|mind game|puppet|exploit|coerc|deceiv|deception|covert/i, termRe: /manipulat\w*/i, term: 'MANIPULATION',
    eyebrow: 'MIND GAMES', badges: ['HIDDEN TACTICS', 'WATCH THE STRINGS', 'PLAYED?'],
    split: ['WHAT THEY SAY', 'WHAT THEY WANT'],
    hooks: [['WHO IS', 'PULLING STRINGS?'], ['ARE YOU', 'BEING PLAYED?'], ['THE QUIET', 'TACTICS']],
    headlines: ['WHO PULLS YOUR STRINGS?', 'ARE YOU BEING PLAYED?', 'THE QUIET TACTICS', 'THEY ALREADY KNOW YOUR BUTTONS', 'KINDNESS WITH A PRICE', 'THE GAME YOU DID NOT JOIN'],
    emotion: 'suspicion and awareness', conflict: 'hidden control behind friendly behavior', metaphor: 'puppet strings and chess pieces',
    searches: [/couple|argument|conversation|serious/i, /thinking|alone|silhouette/i, /business|meeting/i],
    accent: '#E0463A', grade: { brightness: 0.88, saturation: 0.9 },
    fam: { 'manipulation-story': 4, 'dark-thriller': 2, 'graphic-novel': 2.5, 'bold-illustration': 2.5, 'viral-contrast': 2, 'surreal-conceptual': 2 },
    scenes: [
      { subject: 'a gloved-looking hand above holding a wooden puppet control bar with fine strings attached to a worried man in a plain jacket', pose: 'the man stands stiffly, arms lifted by strings, eyes wide', env: 'dark theatre stage with red curtain edges', focal: 'the strings and the man\'s face' },
      { subject: 'a smiling person offering a gift box with one hand while the other hand moves a chess pawn behind their back', pose: 'warm smile, relaxed shoulders, calculating eyes', env: 'cosy living room with a chessboard on a table', focal: 'the hidden hand with the chess pawn' },
      { subject: 'a giant chessboard with human-sized pieces, one small person standing as a pawn while a large figure looms above', pose: 'small figure looks up anxiously, large figure points down', env: 'moody marble floor in a vast dark hall', focal: 'the small pawn figure' },
      { subject: 'a smiling friend leaning in to whisper while their long shadow on the wall holds strings', pose: 'friendly leaning gesture toward a hesitant listener', env: 'warm cafe corner with long afternoon shadows', focal: 'the shadow with strings' }
    ]
  },
  {
    id: 'emotional-control', test: /emotional control|emotional abuse|guilt.?trip|silent treatment|love.?bomb|blame|withhold|emotional blackmail|controlling/i, termRe: /(guilt.?trip\w*|love.?bomb\w*|silent treatment)/i,
    eyebrow: 'EMOTIONAL TACTICS', badges: ['CONTROL CHECK', 'FEELING TRAPPED?', 'KNOW THE SIGNS'],
    split: ['HOW IT FEELS', 'WHAT IT IS'],
    hooks: [['THEY CONTROL', 'HOW YOU FEEL'], ['GUILT', 'AS A LEASH'], ['KINDNESS', 'WITH STRINGS']],
    headlines: ['GUILT AS A LEASH', 'THEY CONTROL HOW YOU FEEL', 'WARMTH THEN COLD', 'WHY YOU APOLOGIZE FIRST', 'KINDNESS WITH STRINGS', 'THE FEAR OF THEIR MOOD'],
    emotion: 'emotional pressure and entrapment', conflict: 'your feelings versus their control', metaphor: 'a leash of red thread and a glass jar',
    searches: [/couple|argument|serious/i, /thinking|alone|person/i, /smartphone|texting/i],
    accent: '#FF5E4D', grade: { brightness: 0.9, saturation: 0.9 },
    fam: { 'face-closeup': 3, 'dark-thriller': 2.5, 'bold-illustration': 2.5, 'split-screen': 2.5, 'surreal-conceptual': 3, 'graphic-novel': 1.5 },
    scenes: [
      { subject: 'a person sitting still with a thin red thread tied around their wrist leading out of frame', pose: 'head bowed, tired eyes, hands loosely open', env: 'plain dim room with one window of cold light', focal: 'the red thread and wrist' },
      { subject: 'a face split into one calm half and one flushed angry half', pose: 'tense jaw, glaring eye on one side, composed on the other', env: 'dark studio with a hard side light', focal: 'the dividing line down the face' },
      { subject: 'a woman curled inside a huge glass jar while amber and blue liquid rises', pose: 'knees drawn up, hand pressed on the glass, eyes searching', env: 'surreal empty room with soft fog', focal: 'her hand on the glass' },
      { subject: 'a hand twisting a large control dial, with a blurred person in the background flinching', pose: 'hand confident, background person shrinking', env: 'dark control-room style space with warm glow', focal: 'the hand on the dial' }
    ]
  },
  {
    id: 'toxic-relationships', test: /relationship|toxic|love|partner|boyfriend|girlfriend|marriage|betray|red flag|ex\b|dating/i, termRe: /(toxic\w*|red flags?|betray\w*)/i,
    eyebrow: 'RELATIONSHIP PSYCHOLOGY', badges: ['RED FLAGS', 'LOVE OR CONTROL', 'TRUST CHECK'],
    split: ['WHAT IT LOOKS LIKE', 'WHAT IT IS'],
    hooks: [['LOVE', 'OR CONTROL?'], ['THE HIDDEN', 'RED FLAGS'], ['WHEN TRUST', 'BREAKS']],
    headlines: ['LOVE OR CONTROL?', 'THE QUIET RED FLAGS', 'WHEN TRUST BREAKS', 'WHY YOU STAY', 'SAME FIGHT AGAIN', 'ALONE TOGETHER'],
    emotion: 'heartache and recognition', conflict: 'love versus control inside a relationship', metaphor: 'a red crack between two people',
    searches: [/couple|argument|serious/i, /thinking|alone|person/i, /smartphone|texting/i],
    accent: '#FF6B6B', grade: { brightness: 0.9, saturation: 0.9 },
    fam: { 'split-screen': 3.5, 'editorial-collage': 3, 'face-closeup': 2.5, 'cinematic-documentary': 2.5, 'graphic-novel': 2, 'viral-contrast': 2 },
    scenes: [
      { subject: 'a couple sitting back to back on a bed with a thin glowing red crack running across the floor between them', pose: 'both looking down, slumped shoulders, not touching', env: 'dim bedroom lit by cold blue night light', focal: 'the red crack between them' },
      { subject: 'a woman alone at night staring at a blank glowing phone while her partner sleeps turned away', pose: 'knees up, tired worried eyes lit by screen glow', env: 'dark bedroom, blue screen light on her face', focal: 'her face in the screen glow' },
      { subject: 'two people holding opposite ends of a badly tangled rope, both pulling', pose: 'strained arms, determined and hurt expressions', env: 'stylised minimal studio with warm and cool split light', focal: 'the knot in the middle' },
      { subject: 'a man and woman in a tense kitchen confrontation, her arms crossed, him gesturing sharply', pose: 'raised hands, tight jaws, direct eye contact', env: 'evening kitchen with harsh overhead light', focal: 'their locked eye lines' }
    ]
  },
  {
    id: 'workplace', test: /workplace|office|boss|career|colleague|coworker|corporate|manager|promotion|toxic job/i, termRe: /(workplace|office politics|boss\w*)/i,
    eyebrow: 'WORKPLACE PSYCHOLOGY', badges: ['OFFICE POLITICS', 'POWER PLAY', 'READ THE ROOM'],
    split: ['WHAT THEY SAY', 'WHAT IT MEANS'],
    hooks: [['OFFICE', 'POWER GAMES'], ['READ', 'THE ROOM'], ['QUIET', 'CONTROL']],
    headlines: ['OFFICE POWER GAMES', 'READ THE ROOM', 'THE BOSS WHO SMILES', 'WHO REALLY HAS POWER?', 'QUIET CONTROL AT WORK', 'THE MEETING AFTER THE MEETING'],
    emotion: 'tension and status anxiety', conflict: 'power imbalance at work', metaphor: 'a looming shadow in a glass office',
    searches: [/business|meeting|office/i, /thinking|alone|person/i, /couple|argument|conversation/i],
    accent: '#4EB5FF', grade: { brightness: 0.96, saturation: 0.82 },
    fam: { 'cinematic-documentary': 3, 'magazine-editorial': 3, 'viral-contrast': 2.5, 'split-screen': 2.5, 'bold-illustration': 2, 'editorial-collage': 2 },
    scenes: [
      { subject: 'a manager in a sharp suit standing over a seated employee in a glass-walled office', pose: 'manager leans on the desk with a thin smile, employee looks down at papers with blank pages', env: 'modern glass office at dusk with city lights', focal: 'the employee\'s tense face' },
      { subject: 'an employee sitting alone at the end of a long meeting table while colleagues whisper in a cluster at the far side', pose: 'sits upright, forced neutral face, eyes on the table', env: 'bright but cold conference room', focal: 'the isolated employee' },
      { subject: 'a boss at a window whose huge shadow stretches across the wall behind a small worried worker', pose: 'boss hands in pockets, worker clutches a folder', env: 'late-evening open-plan office, desks lit by blue screens', focal: 'the oversized shadow' },
      { subject: 'a team meeting where one person smiles broadly at the boss while another watches with narrowed eyes', pose: 'forward-leaning flatterer, suspicious observer with crossed arms', env: 'modern meeting room with daylight', focal: 'the narrowed eyes' }
    ]
  },
  {
    id: 'body-language', test: /body language|facial expression|eye contact|micro.?expression|gesture|posture|tell\b|lie detect|nonverbal|non-verbal/i, termRe: /(body language|micro.?expressions?|eye contact)/i,
    eyebrow: 'HUMAN BEHAVIOR', badges: ['READ THE SIGNALS', 'NONVERBAL CLUES', 'WATCH CLOSELY'],
    split: ['WHAT THEY SAY', 'WHAT THEY SHOW'],
    hooks: [['READ', 'THE SIGNALS'], ['WHAT EYES', 'REVEAL'], ['WATCH', 'THE REACTION']],
    headlines: ['WHAT THEIR EYES REVEAL', 'THE SIGNAL YOU MISSED', 'WATCH THEIR HANDS', 'A SMILE THAT LIES', 'READ THE ROOM FAST', 'THE BODY SAYS MORE'],
    emotion: 'curiosity and attention', conflict: 'spoken words versus body signals', metaphor: 'a magnified glance at an eye and a hand',
    searches: [/person|portrait|face|thinking/i, /conversation|couple/i, /business|meeting/i],
    accent: '#58D6C6', grade: { brightness: 0.96, saturation: 0.85 },
    fam: { 'face-closeup': 4, 'split-screen': 3, 'viral-contrast': 3, 'editorial-collage': 2.5, 'bold-illustration': 2, 'magazine-editorial': 2 },
    scenes: [
      { subject: 'an extreme close-up of narrowed suspicious eyes with a slightly raised eyebrow', pose: 'unblinking direct stare toward the camera', env: 'softly blurred dark background', focal: 'the eyes' },
      { subject: 'two people negotiating across a table, one with crossed arms and leaning back, the other leaning forward with open palms', pose: 'contrasting closed and open postures', env: 'neutral modern meeting room, shallow depth of field', focal: 'the crossed arms and open palms' },
      { subject: 'a clenched fist resting next to an open relaxed palm on a wooden table', pose: 'both hands in sharp focus, faces blurred behind', env: 'warm table top, shallow focus', focal: 'the clenched fist' },
      { subject: 'a person with a wide smile that does not reach the eyes, eyes cold and still', pose: 'teeth showing, cheeks raised, eyes flat', env: 'bright but slightly harsh studio light', focal: 'the contrast between mouth and eyes' }
    ]
  },
  {
    id: 'persuasion', test: /persuasion|persuade|negotiat|sales|convince|pitch|rhetoric|charisma|compliance/i, termRe: /(persuasion|persuade|negotiat\w*)/i, term: 'PERSUASION',
    eyebrow: 'THE ART OF INFLUENCE', badges: ['SAY YES TRAP', 'INFLUENCE TRICKS', 'WHY THEY AGREE'],
    split: ['BEFORE THE PITCH', 'AFTER THE PITCH'],
    hooks: [['WHY YOU', 'SAY YES'], ['THE PERSUASION', 'PLAYBOOK'], ['HOW THEY', 'WIN YOU OVER']],
    headlines: ['WHY YOU SAY YES', 'HOW THEY WIN YOU OVER', 'THE FIRST SMALL YES', 'PERSUASION YOU NEVER NOTICE', 'THE PLAYBOOK BEHIND THE SMILE', 'WHO WINS THE ROOM?'],
    emotion: 'curiosity and mild alarm', conflict: 'your decision versus engineered influence', metaphor: 'a hypnotic spiral and an outstretched pen',
    searches: [/business|meeting|office/i, /smartphone|texting/i, /thinking|alone|person/i],
    accent: '#FFC53D', grade: { brightness: 0.95, saturation: 0.9 },
    fam: { 'viral-contrast': 3.5, 'bold-illustration': 3, 'editorial-collage': 3, 'magazine-editorial': 2.5, 'manipulation-story': 2, 'cinematic-documentary': 2 },
    scenes: [
      { subject: 'a confident salesperson in a blazer offering a handshake and a pen to a hesitant customer', pose: 'salesperson beaming and leaning in, customer leaning back with doubt', env: 'bright modern showroom with soft bokeh', focal: 'the extended pen and hesitant face' },
      { subject: 'a charismatic speaker on stage with a crowd leaning forward in rows', pose: 'open arms, intense eyes, spotlight', env: 'dark auditorium with strong stage light', focal: 'the speaker\'s open arms' },
      { subject: 'a megaphone emitting swirling hypnotic spiral rings toward a small thoughtful person', pose: 'person frozen mid-step, eyes slightly glazed', env: 'bold stylised flat-colour background', focal: 'the spiral' },
      { subject: 'a hand holding a pen over a blank contract while a smiling face looms in the soft background', pose: 'hand hesitating above the page', env: 'clean desk with warm window light', focal: 'the hovering pen' }
    ]
  },
  {
    id: 'social-influence', test: /social influence|conformity|peer pressure|herd|groupthink|crowd|social proof|social media|viral|algorithm|propaganda|follow(er)?s?\b/i, termRe: /(conformity|peer pressure|groupthink|social proof)/i,
    eyebrow: 'THE HUMAN MIND', badges: ['FOLLOW THE CROWD', 'SOCIAL PRESSURE', 'WHO SHAPES YOU'],
    split: ['THE CROWD', 'YOU'],
    hooks: [['WHO', 'SHAPES YOUR MIND?'], ['THE INFLUENCE', 'TRAP'], ['WHY YOU', 'BELIEVE THEM']],
    headlines: ['WHO SHAPES YOUR MIND?', 'WHY THE CROWD WINS', 'THE ONE WHO LOOKED AWAY', 'YOU THINK THIS IS YOUR IDEA', 'FOLLOWING WITHOUT KNOWING', 'THE PRESSURE TO FIT IN'],
    emotion: 'isolation and awareness', conflict: 'individual thinking versus group pressure', metaphor: 'one person facing the opposite way from a crowd',
    searches: [/thinking|alone|person/i, /smartphone|texting/i, /business|meeting/i],
    accent: '#9B8CFF', grade: { brightness: 0.9, saturation: 0.85 },
    fam: { 'editorial-collage': 3.5, 'surreal-conceptual': 3.5, 'neuro-illustration': 2.5, 'split-screen': 3, 'bold-illustration': 2.5, 'cinematic-documentary': 2 },
    scenes: [
      { subject: 'a crowd of identical people all looking left while one person in a brightly coloured jacket looks right', pose: 'the lone person alert and curious, crowd blank and uniform', env: 'wide plaza at golden hour', focal: 'the lone person looking the other way' },
      { subject: 'a person lit by the cold glow of blank phone screens held by many faceless hands around them', pose: 'looks up, overwhelmed and drawn in', env: 'dark void with floating screen glows', focal: 'the lone face lit by the glow' },
      { subject: 'a line of identical puppet-like figures with one figure cutting its own strings', pose: 'the free figure stands taller and turns away', env: 'stylised minimal studio with a bright backdrop', focal: 'the cut strings' },
      { subject: 'a person standing in an elevator full of people who all face the back wall', pose: 'the person faces the doors confused, others unnaturally still', env: 'clean modern elevator with cold light', focal: 'the confused person facing the other way' }
    ]
  },
  {
    id: 'cognitive-bias', test: /cognitive bias|bias\b|fallacy|heuristic|confirmation|dunning|anchoring|sunk cost|illusion|irrational|decision.?making|why we believe|brain tricks?|psychological trick/i, termRe: /(cognitive bias\w*|confirmation bias|sunk cost|anchoring|dunning.kruger|\w+ bias)/i,
    eyebrow: 'THE THINKING TRAP', badges: ['BRAIN TRAP', 'THINKING ERROR', 'BLIND SPOT'],
    split: ['WHAT YOU THINK', 'WHAT IS TRUE'],
    hooks: [['YOUR BRAIN', 'IS LYING'], ['THE BLIND', 'SPOT'], ['WHY SMART PEOPLE', 'GET FOOLED']],
    headlines: ['YOUR BRAIN IS BIASED', 'THE BLIND SPOT', 'WHY SMART PEOPLE GET FOOLED', 'THE THOUGHT YOU TRUST TOO MUCH', 'SEEING WHAT YOU EXPECT', 'THE SHORTCUT THAT MISLEADS'],
    emotion: 'surprise and self-reflection', conflict: 'what you believe versus what is true', metaphor: 'a blindfolded brain and tinted glasses',
    searches: [/thinking|alone|person/i, /abstract|brain/i, /business|meeting/i],
    accent: '#53D6FF', grade: { brightness: 0.88, saturation: 0.9 },
    fam: { 'neuro-illustration': 4.5, 'bold-illustration': 3, 'surreal-conceptual': 3, 'split-screen': 2.5, 'editorial-collage': 2, 'magazine-editorial': 2 },
    scenes: [
      { subject: 'a stylised glowing human brain wearing a blindfold floating above a desk', pose: 'brain tilted slightly as if searching', env: 'dark navy space with faint grid lines', focal: 'the blindfolded brain' },
      { subject: 'a person wearing oversized rose-tinted glasses looking at a grey crowd that appears colourful through the lenses', pose: 'happy smug expression', env: 'clean street scene half colour half grey', focal: 'the glasses lenses' },
      { subject: 'a head in profile with a maze inside it and one glowing path blocked by a wall', pose: 'calm confident expression', env: 'deep teal studio background', focal: 'the blocked glowing path' },
      { subject: 'a pair of balance scales tipped down by a giant thumb pressing one side', pose: 'small stack of colourful blocks on the lighter side', env: 'neutral stylised backdrop with strong rim light', focal: 'the thumb on the scale' }
    ]
  },
  {
    id: 'human-behavior', test: /.^/, termRe: /^$/,
    eyebrow: 'HUMAN BEHAVIOR', badges: ['INSIDE THE MIND', 'LOOK CLOSER', 'WHY WE DO IT'],
    split: ['WHAT YOU SEE', 'WHAT IS REAL'],
    hooks: [['THE HIDDEN', 'TRUTH'], ['INSIDE', 'THE HUMAN MIND'], ['LOOK', 'CLOSER']],
    headlines: ['THE HIDDEN TRUTH', 'WHY WE ACT THIS WAY', 'INSIDE THE HUMAN MIND', 'WHAT PEOPLE NEVER SAY', 'LOOK CLOSER', 'THE PATTERN BEHIND IT'],
    emotion: 'curiosity and reflection', conflict: 'what people show versus what drives them', metaphor: 'a silhouette with a mind of light',
    searches: [/thinking|alone|person/i, /silhouette|dark|city/i, /business|meeting|couple/i],
    accent: '#C6A36A', grade: { brightness: 0.91, saturation: 0.86 },
    fam: { 'cinematic-documentary': 2.5, 'surreal-conceptual': 3, 'neuro-illustration': 3, 'magazine-editorial': 2.5, 'bold-illustration': 2.5, 'face-closeup': 2.5, 'editorial-collage': 2 },
    scenes: [
      { subject: 'a thoughtful person looking at their reflection in a night-time city window', pose: 'quiet pensive expression, hand near chin', env: 'high-rise window with blurred city lights', focal: 'the reflected face' },
      { subject: 'a crowd of silhouettes at a crossing with one figure glowing softly from within', pose: 'the glowing figure stands still while others rush past', env: 'rainy city crossing at dusk', focal: 'the glowing figure' },
      { subject: 'a detailed illustration of a human head with a bright constellation inside', pose: 'eyes closed, serene', env: 'deep violet background', focal: 'the constellation inside the head' },
      { subject: 'two strangers on a train platform exchanging a brief look', pose: 'one curious, one guarded', env: 'cinematic station with long light beams', focal: 'the exchanged look' }
    ]
  }
];

const EMOTION_RULES = [
  [/fear|afraid|danger|threat|trap|terrif|panic|anxious|anxiety/i, 'fear'],
  [/control|power|dominat|authority|obey|submit/i, 'power'],
  [/lonely|alone|hurt|cry|grief|heartbreak|abandon|betray|pain/i, 'pain'],
  [/secret|hidden|truth|reveal|expose|mystery|why/i, 'curiosity'],
  [/angry|rage|furious|resent|blame/i, 'anger']
];

const BANNED_HEADLINE = /SHOCKING|YOU WON'?T BELIEVE|GONE WRONG|EXPOSED!|DESTROYED|INSANE|NOT CLICKBAIT/i;
const STOPWORDS = new Set('the a an and or of to in on for with is are was were be been being this that these those it its you your they them their we our i me my he she his her at by from as but not no so if then than about into over under how what why when who which can will just more most very really also have has had do does did out up down off too very'.split(' '));

/* =====================================================================
 * Design families
 * Each build(c) returns { grade, defs, under, over, text[], decorate(info) }.
 * ===================================================================== */

const FAMILIES = {
  'bold-illustration': {
    name: 'Bold Psychology Illustration', cls: 'poster', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'power', 'fear'],
    palettes: [
      { a: '#FFD84A', b: '#FF4B6E', dark: '#17122B', light: '#FFFFFF' },
      { a: '#5CF2D6', b: '#FF7A45', dark: '#0F1B33', light: '#FFFFFF' },
      { a: '#FF9F1C', b: '#7B5CFF', dark: '#1B1030', light: '#FFFFFF' }
    ],
    promptStyle: 'Bold flat-colour editorial illustration with thick clean shapes, semi-realistic characters and graphic poster energy',
    camera: 'straight-on medium shot with slight low angle', light: 'bright rim light with soft shadows on simple shapes',
    comp: 'subject large on the right half, strong silhouette, simple colour-blocked background',
    build(c) {
      const { p, rng, lines, badge } = c;
      const burst = starburst(930, 370, 250, 400, 14, rng);
      return {
        grade: { brightness: 1.0, saturation: 1.3, a: 1.12, b: -8 },
        defs: dotsPattern('dotsA', 16, 3.2, p.b, 0.55) +
          '<linearGradient id="panelA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".97"/><stop offset="1" stop-color="' + p.dark + '" stop-opacity=".85"/></linearGradient>',
        under: poly(burst, p.a, 'fill-opacity=".30"') +
          '<rect x="760" y="420" width="520" height="300" fill="url(#dotsA)"/>' +
          '<path d="M0 0 H780 L650 720 H0 Z" fill="url(#panelA)"/>' +
          '<path d="M780 0 H826 L696 720 H650 Z" fill="' + p.a + '"/>' +
          '<path d="M826 0 H850 L720 720 H696 Z" fill="' + p.b + '"/>',
        text: [{ lines, font: 'impact', box: { x: 56, y: 130, w: 600, h: 470 }, ha: 'start', va: 'middle', maxSize: 150, minSize: 70, lh: 1.0, ls: 0.005, fills: [p.light, p.a, p.light], stroke: p.dark, strokeW: 7, shadow: 'hard', shadowColor: p.b, shadowOff: [7, 7] }],
        decorate(info) {
          const b = info.bbox;
          const by = Math.max(34, b.y - 70);
          const bw = c.tw(badge, 28, 2) + 36;
          return '<g transform="rotate(-4 ' + (b.x + 60) + ' ' + by + ')"><rect x="' + b.x + '" y="' + by + '" width="' + bw + '" height="48" rx="6" fill="' + p.a + '" stroke="' + p.dark + '" stroke-width="4"/>' +
            '<text x="' + (b.x + 18) + '" y="' + (by + 34) + '" font-family="' + c.fonts.oswald.stack + '" font-weight="' + c.fonts.oswald.weight + '" font-size="28" letter-spacing="2" fill="' + p.dark + '">' + esc(badge) + '</text></g>' +
            '<path d="M' + b.x + ' ' + (b.y + b.h + 22) + ' q 60 -18 120 0 t 120 0 t 120 0" stroke="' + p.a + '" stroke-width="9" fill="none" stroke-linecap="round"/>';
        }
      };
    }
  },

  'cinematic-documentary': {
    name: 'Cinematic Documentary', cls: 'cinema', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['pain', 'curiosity'],
    palettes: [
      { a: '#F2A23A', b: '#2FB7C4', dark: '#05080D', light: '#F4F1EA' },
      { a: '#E8C26B', b: '#3E8FB0', dark: '#06090F', light: '#FFFFFF' }
    ],
    promptStyle: 'Photorealistic cinematic documentary still, shot on a full-frame camera with anamorphic lens character, natural skin texture',
    camera: 'eye-level medium close-up, shallow depth of field, 35mm lens', light: 'motivated practical lighting, soft key with teal shadows and warm highlights',
    comp: 'subject placed on the upper right two-thirds, lower-left kept dark and simple',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { brightness: 0.93, saturation: 0.88, a: 1.15, b: -10 },
        defs: '<linearGradient id="cineShade" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="' + p.dark + '" stop-opacity="0"/><stop offset="1" stop-color="' + p.dark + '" stop-opacity=".93"/></linearGradient>' +
          '<linearGradient id="teal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + p.b + '" stop-opacity=".22"/><stop offset=".6" stop-color="' + p.b + '" stop-opacity="0"/></linearGradient>' +
          '<linearGradient id="warm" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + p.a + '" stop-opacity=".2"/><stop offset=".6" stop-color="' + p.a + '" stop-opacity="0"/></linearGradient>' +
          '<radialGradient id="vig"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>',
        under: '<rect width="1280" height="720" fill="url(#teal)"/><rect width="1280" height="720" fill="url(#warm)"/>' +
          '<rect width="1280" height="720" fill="url(#cineShade)"/><rect width="1280" height="720" fill="url(#vig)"/>' +
          '<rect x="0" y="0" width="1280" height="62" fill="#000"/><rect x="0" y="658" width="1280" height="62" fill="#000"/>',
        text: [{ lines, font: 'condensed', box: { x: 84, y: 400, w: 820, h: 225 }, ha: 'start', va: 'bottom', maxSize: 170, minSize: 80, lh: 0.98, ls: 0.02, fills: [p.light, p.a], shadow: 'soft' }],
        decorate(info) {
          const b = info.bbox;
          return '<rect x="' + (b.x - 30) + '" y="' + b.y + '" width="8" height="' + b.h + '" fill="' + p.a + '"/>' +
            '<text x="' + b.x + '" y="' + (b.y - 16) + '" font-family="' + c.fonts.inter.stack + '" font-weight="800" font-size="24" letter-spacing="7" fill="' + p.a + '">' + esc(eyebrow) + '</text>';
        }
      };
    }
  },

  'dark-thriller': {
    name: 'Dark Psychological Thriller', cls: 'noir', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['fear', 'anger'],
    palettes: [
      { a: '#FF2A3D', b: '#00D8FF', dark: '#050507', light: '#F5F5F5' },
      { a: '#E5C07B', b: '#B3202F', dark: '#060506', light: '#FFFFFF' }
    ],
    promptStyle: 'Dark psychological thriller still, near-black shadows, unsettling atmosphere, photorealistic with subtle film grain',
    camera: 'tight close-up from slightly below, wide lens perspective', light: 'single hard side light with deep red rim and heavy shadow falloff',
    comp: 'face or figure centred in the upper two-thirds, lower third left dark and quiet',
    build(c) {
      const { p, rng, lines, eyebrow } = c;
      let cracks = '';
      [[0, 0, 380, 300], [1280, 0, 900, 250], [0, 720, 300, 470], [1280, 720, 980, 520]].forEach(([x1, y1, x2, y2]) => {
        cracks += '<path d="' + jaggedPath(rng, x1, y1, x2, y2) + '" stroke="' + p.a + '" stroke-width="2.4" fill="none" stroke-opacity=".55"/>';
      });
      return {
        grade: { brightness: 0.74, saturation: 0.72, a: 1.25, b: -16 },
        defs: '<radialGradient id="noirVig" cx=".5" cy=".42" r=".75"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".92"/></radialGradient>' +
          '<radialGradient id="redGlow" cx=".5" cy="1" r=".7"><stop offset="0" stop-color="' + p.a + '" stop-opacity=".45"/><stop offset="1" stop-color="' + p.a + '" stop-opacity="0"/></radialGradient>' +
          '<linearGradient id="noirBottom" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".9"/></linearGradient>' +
          '<pattern id="scan" width="4" height="6" patternUnits="userSpaceOnUse"><rect width="4" height="1.5" fill="#000" fill-opacity=".25"/></pattern>',
        under: '<rect width="1280" height="720" fill="url(#noirVig)"/><rect width="1280" height="720" fill="url(#redGlow)"/>' +
          '<rect width="1280" height="720" fill="url(#noirBottom)"/>' + cracks + '<rect width="1280" height="720" fill="url(#scan)"/>',
        text: [{ lines, font: 'impact', box: { x: 90, y: 395, w: 1100, h: 240 }, ha: 'middle', va: 'bottom', maxSize: 150, minSize: 76, lh: 0.98, ls: 0.015, fills: [p.light, p.a], shadow: 'glitch', shadowColor: p.a, glitch: [p.b, p.a] }],
        decorate(info) {
          const b = info.bbox;
          const cx = b.x + b.w / 2;
          return '<text x="' + cx + '" y="' + (b.y - 22) + '" text-anchor="middle" font-family="' + c.fonts.inter.stack + '" font-weight="800" font-size="24" letter-spacing="9" fill="' + p.light + '" fill-opacity=".85">' + esc(eyebrow) + '</text>' +
            '<rect x="' + (cx - 330) + '" y="' + (b.y - 33) + '" width="150" height="2" fill="' + p.a + '"/><rect x="' + (cx + 180) + '" y="' + (b.y - 33) + '" width="150" height="2" fill="' + p.a + '"/>';
        }
      };
    }
  },

  'editorial-collage': {
    name: 'Colorful Editorial Collage', cls: 'collage', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'power'],
    palettes: [
      { a: '#FFD52A', b: '#FF4B7B', dark: '#14111F', light: '#FFFFFF' },
      { a: '#FF8A3D', b: '#2ED6C5', dark: '#16121F', light: '#FFFFFF' },
      { a: '#B8F23A', b: '#7B5CFF', dark: '#101018', light: '#FFFFFF' }
    ],
    promptStyle: 'Layered mixed-media collage portrait, cut-out photographic faces with paper texture, bright pop colours, editorial magazine energy',
    camera: 'frontal cut-out portrait composition with slight tilt', light: 'even bright studio lighting with crisp edges',
    comp: 'main face large on the right half, smaller secondary faces behind it, left third calm',
    build(c) {
      const { p, rng, lines, badge } = c;
      let torn = '';
      const pts = [[0, 0], [660, 0]];
      for (let y = 60; y < 720; y += 60) pts.push([Math.round(660 - y * 0.2 + (rng() - 0.5) * 26), y]);
      pts.push([530, 720], [0, 720]);
      torn = poly(pts, p.a);
      return {
        grade: { brightness: 1.02, saturation: 1.22, a: 1.08, b: -4 },
        defs: dotsPattern('dotsC', 14, 2.6, p.b, 0.5),
        under: '<g transform="translate(10 10)">' + poly(pts, p.dark, 'fill-opacity=".45"') + '</g>' + torn +
          '<rect x="0" y="470" width="620" height="250" fill="url(#dotsC)"/>' +
          '<g transform="rotate(2 940 360)"><rect x="660" y="46" width="570" height="630" fill="none" stroke="#fff" stroke-width="16" filter="url(#sh)"/></g>' +
          '<rect x="640" y="30" width="110" height="32" fill="#F6EFD0" fill-opacity=".85" transform="rotate(-28 695 46)"/>' +
          '<rect x="1150" y="650" width="110" height="32" fill="#F6EFD0" fill-opacity=".85" transform="rotate(-28 1205 666)"/>' +
          '<circle cx="1170" cy="120" r="34" fill="' + p.b + '" stroke="#fff" stroke-width="6"/>',
        text: [{ lines, font: 'montserrat', box: { x: 54, y: 120, w: 540, h: 440 }, ha: 'start', va: 'middle', maxSize: 118, minSize: 60, lh: 1.02, ls: -0.01, fills: [p.dark, p.dark, p.dark], rot: -3 }],
        decorate(info) {
          const b = info.bbox;
          const last = info.blocks[0].lineBoxes[info.blocks[0].lineBoxes.length - 1];
          const bw = c.tw(badge, 26, 2) + 28;
          return '<rect x="' + (b.x - 10) + '" y="' + (last.y - 4) + '" width="' + (b.w * 0.92 + 24) + '" height="' + (last.h + 8) + '" fill="#fff" transform="rotate(-3 ' + (b.x + b.w / 2) + ' ' + (b.y + b.h / 2) + ')" fill-opacity=".92"/>' +
            '<g transform="rotate(3 ' + b.x + ' ' + (b.y - 60) + ')"><rect x="' + b.x + '" y="' + Math.max(30, b.y - 78) + '" width="' + bw + '" height="44" fill="' + p.dark + '"/><text x="' + (b.x + 14) + '" y="' + (Math.max(30, b.y - 78) + 31) + '" font-family="' + c.fonts.oswald.stack + '" font-weight="' + c.fonts.oswald.weight + '" font-size="26" letter-spacing="2" fill="' + p.light + '">' + esc(badge) + '</text></g>';
        }
      };
    }
  },

  'split-screen': {
    name: 'Split-Screen Comparison', cls: 'split', side: 'split', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['curiosity', 'pain', 'anger'],
    palettes: [
      { a: '#FFB627', b: '#3A86FF', dark: '#08101C', light: '#FFFFFF' },
      { a: '#FF5D73', b: '#2EC4B6', dark: '#0B1018', light: '#FFFFFF' }
    ],
    promptStyle: 'Split composition photograph showing two contrasting emotional states of the same situation, one calm and one distressed, cinematic realism',
    camera: 'symmetrical medium shot with a clear vertical division in the middle', light: 'cool blue light on the left side and warm amber light on the right side',
    comp: 'two clearly different halves, a subject on each side, centre seam kept clean',
    build(c) {
      const { p, lines, profile, question } = c;
      const labels = profile.split || ['WHAT YOU SEE', 'WHAT IS REAL'];
      const l1 = lines.length > 1 ? [lines[0]] : [lines[0].split(' ').slice(0, Math.ceil(lines[0].split(' ').length / 2)).join(' ')];
      const l2 = lines.length > 1 ? [lines.slice(1).join(' ')] : [lines[0].split(' ').slice(Math.ceil(lines[0].split(' ').length / 2)).join(' ') || lines[0]];
      return {
        grade: { brightness: 0.98, saturation: 1.0, a: 1.1, b: -6 },
        defs: '<linearGradient id="splitBottom" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".9"/></linearGradient>',
        under: poly([[0, 0], [700, 0], [580, 720], [0, 720]], p.b, 'fill-opacity=".34"') +
          poly([[700, 0], [1280, 0], [1280, 720], [580, 720]], p.a, 'fill-opacity=".26"') +
          '<rect width="1280" height="720" fill="url(#splitBottom)"/>' +
          '<path d="M700 0 L580 720" stroke="#000" stroke-width="22" stroke-opacity=".6"/><path d="M700 0 L580 720" stroke="#fff" stroke-width="9" filter="url(#glow)"/>' +
          '<circle cx="640" cy="330" r="58" fill="' + p.dark + '" stroke="#fff" stroke-width="7"/>' +
          '<text x="640" y="' + (question ? 352 : 350) + '" text-anchor="middle" font-family="' + c.fonts.impact.stack + '" font-weight="' + c.fonts.impact.weight + '" font-size="' + (question ? 70 : 52) + '" fill="#fff">' + (question ? '?' : 'VS') + '</text>',
        text: [
          { lines: l1, font: 'condensed', box: { x: 50, y: 470, w: 500, h: 190 }, ha: 'start', va: 'bottom', maxSize: 130, minSize: 56, lh: 1, ls: 0.02, fills: [p.light], shadow: 'soft' },
          { lines: l2, font: 'condensed', box: { x: 730, y: 470, w: 500, h: 190 }, ha: 'end', va: 'bottom', maxSize: 130, minSize: 56, lh: 1, ls: 0.02, fills: [p.a], shadow: 'soft' }
        ],
        decorate(info) {
          const pill = (x, text, color, anchor) => {
            const w = c.tw(text, 20, 3) + 30;
            const rx = anchor === 'end' ? x - w : x;
            return '<rect x="' + rx + '" y="40" width="' + w + '" height="42" rx="21" fill="' + p.dark + '" fill-opacity=".85" stroke="' + color + '" stroke-width="3"/>' +
              '<text x="' + (rx + w / 2) + '" y="69" text-anchor="middle" font-family="' + c.fonts.inter.stack + '" font-weight="800" font-size="20" letter-spacing="3" fill="' + color + '">' + esc(text) + '</text>';
          };
          return pill(50, labels[0], '#fff', 'start') + pill(1230, labels[1], p.a, 'end');
        }
      };
    }
  },

  'graphic-novel': {
    name: 'Graphic Novel', cls: 'comic', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['fear', 'anger', 'power'],
    palettes: [
      { a: '#FFE14A', b: '#E63946', dark: '#0B0B10', light: '#FFFFFF' },
      { a: '#7DF9FF', b: '#FF3D81', dark: '#0A0A14', light: '#FFFFFF' }
    ],
    promptStyle: 'Graphic novel illustration with heavy ink outlines, cel shading, dramatic hatching and saturated comic-book colours',
    camera: 'dynamic dutch-angle medium shot', light: 'hard directional light with deep ink-black shadows',
    comp: 'character occupying right two-thirds with dramatic pose, left side simple dark shapes',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { brightness: 0.98, saturation: 1.3, a: 1.35, b: -25, median: 3 },
        defs: dotsPattern('dotsG', 10, 2.2, '#000', 0.22),
        under: '<rect width="1280" height="720" fill="url(#dotsG)"/>' +
          '<path d="M14 430 L640 380 L560 706 L14 706 Z" fill="' + p.dark + '" fill-opacity=".72" stroke="#000" stroke-width="8"/>' +
          '<rect x="14" y="14" width="1252" height="692" fill="none" stroke="#000" stroke-width="18"/>',
        text: [{ lines, font: 'impact', box: { x: 56, y: 370, w: 560, h: 290 }, ha: 'start', va: 'bottom', maxSize: 130, minSize: 64, lh: 1.0, ls: 0.01, fills: [p.light, p.a, p.light], stroke: '#000', strokeW: 9, shadow: 'hard', shadowColor: p.b, shadowOff: [8, 8], rot: -2 }],
        decorate(info) {
          const w = c.tw(eyebrow, 26, 1.5) + 36;
          return '<g transform="rotate(-1.5 40 40)"><rect x="38" y="38" width="' + w + '" height="52" fill="' + p.a + '" stroke="#000" stroke-width="6"/>' +
            '<text x="56" y="74" font-family="' + c.fonts.inter.stack + '" font-weight="900" font-style="italic" font-size="26" letter-spacing="1.5" fill="#000">' + esc(eyebrow) + '</text></g>';
        }
      };
    }
  },

  'surreal-conceptual': {
    name: 'Surreal Conceptual Art', cls: 'surreal', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['curiosity', 'pain'],
    palettes: [
      { a: '#F5D58A', b: '#8E6BFF', dark: '#0E0A24', light: '#FFF8EA' },
      { a: '#9FE8E0', b: '#FF7EB6', dark: '#0A1426', light: '#FFFFFF' }
    ],
    promptStyle: 'Surreal conceptual fine-art composition, dreamlike impossible scale, soft volumetric fog, painterly photorealism',
    camera: 'wide symmetrical frame with a lone figure small against a huge symbolic object', light: 'soft glowing backlight with luminous haze',
    comp: 'symbolic object centred in the upper half, quiet foggy lower third',
    build(c) {
      const { p, rng, lines, eyebrow } = c;
      let orbs = '';
      for (let i = 0; i < 16; i++) orbs += '<circle cx="' + Math.round(rng() * 1280) + '" cy="' + Math.round(40 + rng() * 380) + '" r="' + (2 + rng() * 5).toFixed(1) + '" fill="' + p.a + '" fill-opacity="' + (0.35 + rng() * 0.5).toFixed(2) + '"/>';
      return {
        grade: { brightness: 0.95, saturation: 0.92, a: 1.05, b: 0 },
        defs: '<linearGradient id="surTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.b + '" stop-opacity=".38"/><stop offset=".55" stop-color="' + p.b + '" stop-opacity="0"/></linearGradient>' +
          '<linearGradient id="surBot" x1="0" y1="0" x2="0" y2="1"><stop offset=".48" stop-color="' + p.dark + '" stop-opacity="0"/><stop offset="1" stop-color="' + p.dark + '" stop-opacity=".94"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#surTop)"/><rect width="1280" height="720" fill="url(#surBot)"/>' +
          '<circle cx="640" cy="235" r="190" fill="none" stroke="' + p.a + '" stroke-width="3" stroke-opacity=".85" filter="url(#glow)"/>' +
          '<circle cx="640" cy="235" r="150" fill="none" stroke="' + p.a + '" stroke-width="1.5" stroke-opacity=".5"/>' + orbs,
        text: [{ lines, font: 'serif', box: { x: 100, y: 440, w: 1080, h: 200 }, ha: 'middle', va: 'bottom', maxSize: 104, minSize: 52, lh: 1.04, ls: 0.1, fills: [p.light, p.a], shadow: 'soft' }],
        decorate(info) {
          const b = info.bbox;
          const cx = b.x + b.w / 2;
          return '<text x="' + cx + '" y="' + (b.y - 26) + '" text-anchor="middle" font-family="' + c.fonts.serif.stack + '" font-style="italic" font-size="28" letter-spacing="6" fill="' + p.a + '">' + esc(eyebrow.toLowerCase()) + '</text>' +
            '<rect x="' + (cx - 300) + '" y="' + (b.y - 36) + '" width="110" height="1.5" fill="' + p.a + '"/><rect x="' + (cx + 190) + '" y="' + (b.y - 36) + '" width="110" height="1.5" fill="' + p.a + '"/>';
        }
      };
    }
  },

  'neuro-illustration': {
    name: 'Brain and Neuroscience Illustration', cls: 'neuro', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'fear'],
    palettes: [
      { a: '#5CE1FF', b: '#B78CFF', dark: '#050E24', light: '#EAF6FF' },
      { a: '#7CFFB2', b: '#FF8AD8', dark: '#04141A', light: '#EFFFF8' }
    ],
    promptStyle: 'Scientific neuroscience illustration, translucent glowing human head profile with luminous neural pathways, dark navy ground, refined 3D render',
    camera: 'side profile of a head, slightly elevated, clean centred framing', light: 'cyan and violet internal glow with soft rim light',
    comp: 'head or brain on the right half, left half dark and almost empty',
    build(c) {
      const { p, rng, lines, badge } = c;
      return {
        grade: { brightness: 0.72, saturation: 0.85, a: 1.12, b: -6 },
        defs: '<linearGradient id="neuroShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".96"/><stop offset=".55" stop-color="' + p.dark + '" stop-opacity=".78"/><stop offset="1" stop-color="' + p.dark + '" stop-opacity=".42"/></linearGradient>' +
          '<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="' + p.a + '" stroke-opacity=".08" stroke-width="1"/></pattern>',
        under: '<rect width="1280" height="720" fill="url(#neuroShade)"/><rect width="1280" height="720" fill="url(#grid)"/>' +
          '<circle cx="1025" cy="285" r="250" fill="none" stroke="' + p.b + '" stroke-opacity=".35" stroke-width="2"/>' +
          '<circle cx="1025" cy="285" r="300" fill="none" stroke="' + p.a + '" stroke-opacity=".18" stroke-width="1.5" stroke-dasharray="8 12"/>' +
          brainDiagram(p.a, p.b, rng, 'translate(820 125) scale(1.25)'),
        text: [{ lines, font: 'oswald', box: { x: 60, y: 160, w: 640, h: 400 }, ha: 'start', va: 'middle', maxSize: 130, minSize: 64, lh: 1.0, ls: 0.015, fills: [p.light, p.a, p.light], shadow: 'soft' }],
        decorate(info) {
          const b = info.bbox;
          const w = c.tw(badge, 20, 3) + 70;
          const by = Math.max(34, b.y - 66);
          return '<rect x="' + b.x + '" y="' + by + '" width="' + w + '" height="40" rx="20" fill="none" stroke="' + p.a + '" stroke-width="3"/>' +
            '<circle cx="' + (b.x + 22) + '" cy="' + (by + 20) + '" r="6" fill="' + p.a + '" filter="url(#glow)"/>' +
            '<text x="' + (b.x + 40) + '" y="' + (by + 28) + '" font-family="' + c.fonts.inter.stack + '" font-weight="800" font-size="20" letter-spacing="3" fill="' + p.a + '">' + esc(badge) + '</text>' +
            '<rect x="' + b.x + '" y="' + (b.y + b.h + 24) + '" width="' + Math.round(b.w * 0.6) + '" height="6" rx="3" fill="' + p.a + '"/>' +
            '<rect x="' + (b.x + Math.round(b.w * 0.6) + 12) + '" y="' + (b.y + b.h + 24) + '" width="40" height="6" rx="3" fill="' + p.b + '"/>';
        }
      };
    }
  },

  'face-closeup': {
    name: 'Emotional Face Close-up', cls: 'face', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['pain', 'fear', 'curiosity'],
    palettes: [
      { a: '#FFD23F', b: '#FF4D4D', dark: '#0A0A0F', light: '#FFFFFF' },
      { a: '#7DE2D1', b: '#FF7A8A', dark: '#0B0F14', light: '#FFFFFF' }
    ],
    promptStyle: 'Intense emotional portrait photograph, extreme close-up of a human face with visible pores and glistening eyes, cinematic shallow depth of field',
    camera: '85mm portrait lens, eye-level, tightly framed on the face', light: 'soft key light from the side with a cool rim and deep shadow on the far cheek',
    comp: 'face filling the right half with the eyes in the upper right third, left side dark and softly blurred',
    build(c) {
      const { p, lines } = c;
      return {
        grade: { brightness: 0.98, saturation: 0.95, a: 1.12, b: -6 },
        defs: '<linearGradient id="faceShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".92"/><stop offset=".5" stop-color="' + p.dark + '" stop-opacity=".72"/><stop offset=".72" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#faceShade)"/>' +
          '<circle cx="880" cy="290" r="125" fill="none" stroke="#000" stroke-width="14" stroke-opacity=".55"/>' +
          '<circle cx="880" cy="290" r="125" fill="none" stroke="' + p.a + '" stroke-width="8" filter="url(#glow)"/>' +
          arrowSvg(690, 470, 785, 375, p.a, 12, '#000'),
        text: [{ lines, font: 'poppins', box: { x: 60, y: 330, w: 600, h: 310 }, ha: 'start', va: 'bottom', maxSize: 118, minSize: 58, lh: 1.04, ls: -0.01, fills: lines.map((_, i) => i === lines.length - 1 && lines.length > 1 ? p.dark : p.light), stroke: '#000', strokeW: 4, shadow: 'soft' }],
        decorate(info) {
          const lb = info.blocks[0].lineBoxes;
          const last = lb[lb.length - 1];
          if (lines.length < 2) return '';
          return '<rect x="' + (last.x - 14) + '" y="' + (last.y - 6) + '" width="' + (last.w + 28) + '" height="' + (last.h + 12) + '" rx="6" fill="' + p.a + '" transform="rotate(-1 ' + (last.x + last.w / 2) + ' ' + (last.y + last.h / 2) + ')"/>';
        },
        decorateBeforeText: true
      };
    }
  },

  'manipulation-story': {
    name: 'Manipulation Storytelling', cls: 'strings', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['power', 'fear'],
    palettes: [
      { a: '#E8B64A', b: '#D62839', dark: '#0A0608', light: '#FFF6E8' },
      { a: '#FF6B6B', b: '#FFD166', dark: '#0A0A0F', light: '#FFFFFF' }
    ],
    promptStyle: 'Theatrical storytelling photograph of control and puppetry, symbolic objects and a vulnerable subject, rich crimson and gold tones',
    camera: 'high-angle medium shot looking slightly down on the subject', light: 'theatrical spotlight from above with deep red ambience',
    comp: 'subject right of centre, strings or hands entering from the top edge, left side dark and quiet',
    build(c) {
      const { p, rng, lines, badge } = c;
      let strings = '';
      const xs = [800, 880, 960, 1040, 1120];
      xs.forEach((x, i) => {
        const y2 = 190 + Math.round(rng() * 130);
        strings += '<line x1="' + (790 + i * 85) + '" y1="34" x2="' + x + '" y2="' + y2 + '" stroke="' + p.light + '" stroke-width="2.6" stroke-opacity=".8"/>' +
          '<circle cx="' + x + '" cy="' + y2 + '" r="7" fill="' + p.a + '" filter="url(#glow)"/>';
      });
      return {
        grade: { brightness: 0.86, saturation: 0.92, a: 1.15, b: -10 },
        defs: '<linearGradient id="curtain" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".96"/><stop offset=".55" stop-color="' + p.dark + '" stop-opacity=".7"/><stop offset=".8" stop-color="' + p.b + '" stop-opacity=".1"/><stop offset="1" stop-color="' + p.b + '" stop-opacity=".2"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#curtain)"/>' + strings +
          '<rect x="770" y="20" width="370" height="16" rx="8" fill="' + p.a + '" stroke="#000" stroke-width="3" transform="rotate(-2 955 28)"/>',
        text: [{ lines, font: 'impact', box: { x: 60, y: 190, w: 640, h: 400 }, ha: 'start', va: 'middle', maxSize: 140, minSize: 70, lh: 1.0, ls: 0.01, fills: lines.map((_, i) => i === lines.length - 1 && lines.length > 1 ? p.dark : p.light), shadow: 'soft' }],
        decorate(info) {
          const b = info.bbox;
          const lb = info.blocks[0].lineBoxes;
          const last = lb[lb.length - 1];
          const strip = lines.length > 1
            ? '<rect x="' + (last.x - 20) + '" y="' + (last.y - 6) + '" width="' + (last.w + 40) + '" height="' + (last.h + 12) + '" fill="' + p.a + '"/>'
            : '';
          const by = Math.max(34, b.y - 62);
          return strip + '<rect x="' + (b.x - 26) + '" y="' + b.y + '" width="7" height="' + b.h + '" fill="' + p.b + '"/>' +
            '<text x="' + b.x + '" y="' + (by + 30) + '" font-family="' + c.fonts.inter.stack + '" font-weight="800" font-size="24" letter-spacing="7" fill="' + p.a + '">' + esc(badge) + '</text>';
        },
        decorateBeforeText: true
      };
    }
  },

  'magazine-editorial': {
    name: 'Premium Magazine Editorial', cls: 'magazine', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'power'],
    palettes: [
      { a: '#B3261E', b: '#1A1A1A', dark: '#16140F', light: '#F4EFE4' },
      { a: '#1F5F8B', b: '#C79A3B', dark: '#12161B', light: '#F3F0E8' }
    ],
    promptStyle: 'Premium magazine cover portrait photograph, refined styling, sophisticated muted palette, crisp studio quality',
    camera: 'medium portrait on a 70mm lens, subject framed right of centre', light: 'soft large-window key light, subtle gradient background',
    comp: 'subject on the right 60% of the frame, left 40% plain muted background',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { brightness: 0.98, saturation: 0.8, a: 1.06, b: 0 },
        defs: '',
        under: '<rect x="0" y="0" width="540" height="720" fill="' + p.light + '"/>' +
          '<rect x="540" y="0" width="10" height="720" fill="' + p.a + '"/>' +
          '<rect x="26" y="26" width="488" height="668" fill="none" stroke="' + p.dark + '" stroke-width="2"/>' +
          '<rect x="560" y="26" width="694" height="668" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3"/>',
        text: [{ lines, font: 'serif', box: { x: 58, y: 150, w: 430, h: 440 }, ha: 'start', va: 'middle', maxSize: 108, minSize: 54, lh: 1.02, ls: -0.005, fills: lines.map((_, i) => i === 0 ? p.dark : (i % 2 ? p.a : p.dark)) }],
        decorate(info) {
          const b = info.bbox;
          return '<text x="58" y="82" font-family="' + c.fonts.serif.stack + '" font-weight="700" font-size="26" letter-spacing="9" fill="' + p.dark + '">' + esc(eyebrow) + '</text>' +
            '<rect x="58" y="98" width="430" height="3" fill="' + p.dark + '"/><rect x="58" y="106" width="430" height="1" fill="' + p.dark + '"/>' +
            '<rect x="58" y="' + (b.y + b.h + 30) + '" width="90" height="6" fill="' + p.a + '"/>';
        }
      };
    }
  },

  'viral-contrast': {
    name: 'High-Contrast Viral YouTube Style', cls: 'viral', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'anger', 'fear'],
    palettes: [
      { a: '#FFE600', b: '#FF1F3D', dark: '#0A0A0A', light: '#FFFFFF' },
      { a: '#39FF88', b: '#FF3DCB', dark: '#080808', light: '#FFFFFF' }
    ],
    promptStyle: 'Hyper-saturated high-energy YouTube thumbnail photograph, subject with an exaggerated shocked or suspicious expression, punchy contrast',
    camera: 'close medium shot, slightly wide lens, subject large and sharp', light: 'bright frontal key with strong rim light and clean separation from the background',
    comp: 'subject large on the right half, left half simple dark gradient, focal point upper right',
    build(c) {
      const { p, lines, badge } = c;
      return {
        grade: { brightness: 1.06, saturation: 1.45, a: 1.22, b: -12 },
        defs: '<linearGradient id="vShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".88"/><stop offset=".5" stop-color="#000" stop-opacity=".55"/><stop offset=".72" stop-color="#000" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#vShade)"/>' +
          '<circle cx="900" cy="285" r="135" fill="none" stroke="#000" stroke-width="22"/><circle cx="900" cy="285" r="135" fill="none" stroke="' + p.b + '" stroke-width="13"/>' +
          arrowSvg(700, 560, 800, 420, p.b, 22, '#000') +
          '<rect x="0" y="690" width="1280" height="30" fill="' + p.a + '"/>',
        text: [{ lines, font: 'impact', box: { x: 44, y: 330, w: 640, h: 330 }, ha: 'start', va: 'bottom', maxSize: 170, minSize: 70, lh: 0.98, ls: 0.005, fills: lines.map((_, i) => i % 2 === 0 ? p.a : p.light), stroke: '#000', strokeW: 11, shadow: 'hard', shadowColor: '#000', shadowOff: [6, 6] }],
        decorate(info) {
          const b = info.bbox;
          const by = Math.max(30, b.y - 70);
          const w = c.tw(badge, 30, 2) + 36;
          return '<g transform="rotate(-3 ' + b.x + ' ' + by + ')"><rect x="' + b.x + '" y="' + by + '" width="' + w + '" height="52" rx="8" fill="' + p.b + '" stroke="#000" stroke-width="5"/>' +
            '<text x="' + (b.x + 18) + '" y="' + (by + 37) + '" font-family="' + c.fonts.oswald.stack + '" font-weight="' + c.fonts.oswald.weight + '" font-size="30" letter-spacing="2" fill="#fff">' + esc(badge) + '</text></g>';
        }
      };
    }
  }
};

// v10: 12 extra design families live in their own file (same contract as the families above).
try {
  const extra = require('./thumbnail-families-extra');
  Object.assign(FAMILIES, extra.create({ poly, starburst, dotsPattern, arrowSvg, jaggedPath, esc, mulberry32 }));
  for (const tp of TOPIC_PROFILES) tp.fam = Object.assign({}, extra.TOPIC_FIT[tp.id] || {}, tp.fam || {});
} catch (error) {
  console.warn('[thumbnail-designer] extra families not loaded: ' + error.message);
}

const FAMILY_IDS = Object.keys(FAMILIES);

const LEGACY_FAMILY_ALIASES = {
  'cinematic portrait': 'cinematic-documentary',
  'illustrated psychology': 'bold-illustration',
  'bold editorial collage': 'editorial-collage',
  'split reality': 'split-screen',
  'surreal conceptual art': 'surreal-conceptual',
  'documentary scene': 'cinematic-documentary',
  'educational visual art': 'neuro-illustration',
  'premium editorial': 'magazine-editorial',
  'graphic novel': 'graphic-novel'
};

/* =====================================================================
 * Agent
 * ===================================================================== */

class ThumbnailDesignerAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials || {};
    this.logger = new Logger('ThumbnailDesigner');

    this.templatesPath = path.join(__dirname, '..', 'data', 'thumbnail-templates');
    this.outputPath = path.join(__dirname, '..', 'uploads', 'thumbnails');

    this.defaultWorkspace = path.resolve(
      __dirname,
      '../../OpenMontage-main/projects/youtube-handoff-prod_1794570422249_19sn4gk1vzj_zyfleek436i'
    );

    this.projectRoot = this.defaultWorkspace;
    this.visualsPath = path.join(this.projectRoot, 'assets', 'visuals');
    this.brollPath = path.join(this.projectRoot, 'assets', 'free-stock-broll');
    this.historyPath = path.join(this.outputPath, '.thumbnail-asset-history.json');
    this.familyHistoryPath = path.join(this.outputPath, '.thumbnail-family-history.json');

    this.width = 1280;
    this.height = 720;
    this.maxBytes = 2 * 1024 * 1024;

    this._fonts = null;
    this._fontInfo = null;

    this.logger.info('Professional V5 thumbnail design engine constructed (' + FAMILY_IDS.length + ' design families)');
  }

  async initialize() {
    await fs.mkdir(this.templatesPath, { recursive: true });
    await fs.mkdir(this.outputPath, { recursive: true });
    return true;
  }

  /* ------------------------- fonts ------------------------- */

  getFonts() {
    if (!this._fonts) {
      try {
        const built = buildFontStacks();
        this._fonts = built.stacks;
        this._fontInfo = { detection: built.detection, installedCount: built.installedCount };
      } catch (error) {
        this.logger.warn('Font detection failed, using safe fallbacks: ' + error.message);
        const safe = {};
        for (const key of Object.keys(FONT_SPECS)) {
          safe[key] = { key, primary: 'Arial', weight: 800, stack: "Arial,'Liberation Sans','DejaVu Sans',sans-serif", installedMatches: [] };
        }
        this._fonts = safe;
        this._fontInfo = { detection: false, installedCount: 0 };
      }
    }
    return this._fonts;
  }

  getFontReport() {
    const fonts = this.getFonts();
    const report = {};
    for (const [key, f] of Object.entries(fonts)) report[key] = f.primary + ' (weight ' + f.weight + ')';
    return { detection: this._fontInfo, resolved: report };
  }

  /* ------------------------- workspace / basics ------------------------- */

  async resolveWorkspace(script = {}) {
    const candidate =
      script.workspacePath ||
      script.workspace_path ||
      script.metadata?.workspacePath ||
      script.metadata?.workspace_path ||
      script.metadata?.strategy?.workspacePath ||
      process.env.OPENMONTAGE_WORKSPACE ||
      this.defaultWorkspace;

    const resolved = path.resolve(candidate);

    try {
      await fs.access(path.join(resolved, 'assets'));
      this.projectRoot = resolved;
    } catch (_) {
      this.projectRoot = this.defaultWorkspace;
    }

    this.visualsPath = path.join(this.projectRoot, 'assets', 'visuals');
    this.brollPath = path.join(this.projectRoot, 'assets', 'free-stock-broll');
    this.historyPath = path.join(this.outputPath, '.thumbnail-asset-history.json');
    this.familyHistoryPath = path.join(this.outputPath, '.thumbnail-family-history.json');

    return this.projectRoot;
  }

  escapeSvg(value) {
    return esc(value);
  }

  hash(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  makeId() {
    return `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  async getFootageSources() {
    const files = [];
    const seen = new Set();

    for (const dir of [this.visualsPath, this.brollPath]) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || !/\.(mp4|mov|webm|mkv)$/i.test(entry.name)) continue;

          const full = path.join(dir, entry.name);

          try {
            const stat = await fs.stat(full);
            const identity = `${entry.name.toLowerCase()}_${stat.size}`;

            if (seen.has(identity)) continue;
            seen.add(identity);

            files.push({ path: full, name: entry.name, size: stat.size });
          } catch (_) {}
        }
      } catch (_) {}
    }

    return files;
  }

  async readHistory() {
    try {
      const data = JSON.parse(await fs.readFile(this.historyPath, 'utf8'));
      return Array.isArray(data.used) ? data.used : [];
    } catch (_) {
      return [];
    }
  }

  async writeHistory(history) {
    await fs.mkdir(this.outputPath, { recursive: true });

    await fs.writeFile(
      this.historyPath,
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        workspace: this.projectRoot,
        used: history.slice(-150)
      }, null, 2),
      'utf8'
    );
  }

  async readFamilyHistory() {
    try {
      const data = JSON.parse(await fs.readFile(this.familyHistoryPath, 'utf8'));
      return Array.isArray(data.videos) ? data.videos : [];
    } catch (_) {
      return [];
    }
  }

  async writeFamilyHistory(videos) {
    try {
      await fs.mkdir(this.outputPath, { recursive: true });
      await fs.writeFile(this.familyHistoryPath, JSON.stringify({
        updatedAt: new Date().toISOString(),
        videos: videos.slice(-40)
      }, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn('Could not write family history: ' + error.message);
    }
  }

  /* ------------------------- script analysis ------------------------- */

  getScriptText(script = {}) {
    const parts = [];
    const push = (v) => {
      if (!v) return;
      if (typeof v === 'string') parts.push(v);
      else if (Array.isArray(v)) v.forEach(push);
      else if (typeof v === 'object') {
        ['text', 'narration', 'content', 'voiceover', 'script', 'hook', 'body', 'intro', 'conclusion', 'summary'].forEach(k => push(v[k]));
      }
    };
    ['hook', 'intro', 'script', 'content', 'text', 'narration', 'voiceover', 'sections', 'segments', 'scenes', 'conclusion', 'summary', 'description'].forEach(k => push(script[k]));
    return parts.join(' ').replace(/\s+/g, ' ').slice(0, 8000);
  }

  extractKeywords(text, limit = 14) {
    const counts = new Map();
    String(text || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).forEach(w => {
      if (w.length < 4 || STOPWORDS.has(w)) return;
      counts.set(w, (counts.get(w) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(e => e[0]);
  }

  detectProfile(script = {}) {
    const title = String(script.title || script.topic || '');
    const strategy = script.metadata?.strategy || {};
    const meta = [script.topic, strategy.topic, strategy.angle, strategy.contentType, script.description,
      ...(Array.isArray(script.keywords) ? script.keywords : []),
      ...(Array.isArray(strategy.keywords) ? strategy.keywords : [])].filter(Boolean).join(' ');
    const body = this.getScriptText(script);

    let best = null;
    for (const profile of TOPIC_PROFILES) {
      if (profile.id === 'human-behavior') continue;
      const re = new RegExp(profile.test.source, 'gi');
      const count = (s) => (String(s).match(re) || []).length;
      const score = count(title) * 4 + count(meta) * 2 + Math.min(count(body), 12) * 0.6;
      if (score > 0 && (!best || score > best.score)) best = { profile, score };
    }
    return best ? best.profile : TOPIC_PROFILES.find(p => p.id === 'human-behavior');
  }

  analyzeScript(script = {}) {
    const title = String(script.title || script.topic || '').trim();
    const body = this.getScriptText(script);
    const profile = this.detectProfile(script);
    const all = title + ' ' + body;

    let emotion = null;
    let bestHits = 0;
    for (const [re, name] of EMOTION_RULES) {
      const hits = (all.match(new RegExp(re.source, 'gi')) || []).length;
      if (hits > bestHits) { bestHits = hits; emotion = name; }
    }

    const keywords = this.extractKeywords(all);
    const termMatch = (profile.termRe && profile.termRe.source !== '^$') ? all.match(profile.termRe) : null;

    return {
      topicId: profile.id,
      title,
      keywords,
      mainConcept: termMatch ? termMatch[0].toLowerCase() : (keywords[0] || profile.id),
      emotionalAngle: emotion || 'curiosity',
      emotionDescription: profile.emotion,
      audienceCuriosity: /\?/.test(title) ? 'direct question the viewer wants answered' : 'recognising a pattern they have experienced',
      mainConflict: profile.conflict,
      visualMetaphor: profile.metaphor,
      hasScriptText: body.length > 0,
      scriptWords: body ? body.split(/\s+/).length : 0
    };
  }

  /* ------------------------- headline generation ------------------------- */

  generateHeadlineOptions(script = {}, profile = null, analysis = null) {
    profile = profile || this.detectProfile(script);
    analysis = analysis || this.analyzeScript(script);
    const title = String(script.title || script.topic || '');
    const titleUpper = title.toUpperCase().replace(/[^\w\s?']/g, '').trim();
    const body = this.getScriptText(script);
    const pool = new Set();

    const termMatch = profile.term && profile.termRe && profile.termRe.test(title + ' ' + body);
    const term = termMatch ? profile.term : '';

    if (term) {
      pool.add('IS IT ' + term + '?');
      pool.add('SPOT ' + term + ' EARLY');
      if (/sign|symptom|red flag|warning/i.test(title + ' ' + body)) pool.add('THE QUIET SIGNS OF ' + term);
      pool.add('WHAT ' + term + ' REALLY LOOKS LIKE');
    }

    const num = title.match(/(\d+)\s+(signs?|red flags?|tactics?|ways|traps|tricks|phrases|lies|habits|rules|reasons|mistakes)/i);
    if (num) {
      const noun = num[2].toUpperCase();
      pool.add(num[1] + ' ' + noun + ' TO WATCH');
      pool.add(num[1] + ' ' + noun);
      if (term && /^(SIGNS?|TACTICS|TRICKS|TRAPS|HABITS)$/.test(noun)) pool.add(num[1] + ' ' + noun + ' OF ' + term);
      pool.add('THE ' + num[1] + ' ' + noun + ' YOU MISS');
    }

    profile.headlines.forEach(h => pool.add(h));
    profile.hooks.forEach(h => pool.add(h.join(' ')));

    const kw = new Set(analysis.keywords.concat(String(title).toLowerCase().split(/\W+/)).filter(w => w.length > 3));
    const titleWords = new Set(titleUpper.split(/\s+/));

    const scored = [...pool].map(text => {
      const words = text.replace(/[^\w\s?'%$]/g, '').split(/\s+/).filter(Boolean);
      const wc = words.length;
      let score = 0;
      if (wc >= 2 && wc <= 4) score += 3; else if (wc <= 6 && wc >= 2) score += 1.5; else score -= 6;
      if (/\?$/.test(text)) score += 2;
      if (/\d/.test(text)) score += 1.5;
      score += Math.min(3, (text.match(/\b(HIDDEN|REAL|REALLY|WHY|SECRET|NEVER|TRAP|SIGNS?|TRUTH|WHO|WHAT|QUIET|MASK|MISS|STRINGS?)\b/g) || []).length);
      const overlap = words.filter(w => kw.has(w.toLowerCase())).length;
      score += Math.min(6, overlap * 2);
      if (BANNED_HEADLINE.test(text)) score -= 10;
      if (text.replace(/[^\w\s]/g, '') === titleUpper.replace(/[^\w\s]/g, '')) score -= 25;
      const titleOverlap = words.filter(w => titleWords.has(w)).length / Math.max(1, wc);
      if (titleOverlap > 0.8 && wc >= 3) score -= 5;
      if (text.length > 34) score -= 2;
      else if (text.length > 28) score -= 1;
      if (term && text.includes(term)) score += 1.5;
      return { text, score, wc, type: /\?$/.test(text) ? 'question' : (/\d/.test(text) ? 'number' : (/\b(OR|VS|NOT|BEHIND|BEFORE)\b/.test(text) ? 'contrast' : 'statement')) };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /* ------------------------- design planning ------------------------- */

  planVariants(script = {}, options = {}) {
    const profile = options.profile || this.detectProfile(script);
    const analysis = options.analysis || this.analyzeScript(script);
    const recent = options.recentFamilies || [];
    const title = analysis.title || String(script.title || script.topic || '');
    const seed = seedFrom(title + '|' + analysis.topicId);
    const rng = mulberry32(seed);

    const familyScores = FAMILY_IDS.map(id => {
      const fam = FAMILIES[id];
      let score = (profile.fam?.[id] || 0.8) * 3;
      if (fam.emotionFit.includes(analysis.emotionalAngle)) score += 1.5;
      score += rng() * 1.6;
      const preferred = (script.formatPlan && script.formatPlan.thumbnailFamilies) || (script.metadata && script.metadata.formatPlan && script.metadata.formatPlan.thumbnailFamilies) || [];
      if (preferred.includes(id)) score += 1.2;
      if (fam.needsNumber) score += /\b\d{1,2}\b/.test(title) ? 2 : -3;
      const recentIdx = recent.findIndex(r => r.includes(id));
      if (recentIdx >= 0) score -= Math.max(0.8, 3.2 - recentIdx * 0.7);
      return { id, score };
    });

    const chosen = [];
    const usedCls = new Set();
    const usedSides = [];
    for (let slot = 0; slot < 3; slot++) {
      const remainingFamilies = familyScores.filter(f => !chosen.some(c => c.id === f.id));
      const distinctClassFamilies = remainingFamilies.filter(f => !usedCls.has(FAMILIES[f.id].cls));
      const ranked = (distinctClassFamilies.length ? distinctClassFamilies : remainingFamilies)
        .map(f => {
          const fam = FAMILIES[f.id];
          let s = f.score;
          if (usedCls.has(fam.cls)) s -= 6;
          s -= usedSides.filter(x => x === fam.side).length * 1.6;
          if (slot === 0 && (fam.side === 'center' || fam.cls === 'split')) s -= 0.5;
          return { id: f.id, score: s };
        })
        .sort((a, b) => b.score - a.score);
      const pick = ranked[0];
      chosen.push(pick);
      usedCls.add(FAMILIES[pick.id].cls);
      usedSides.push(FAMILIES[pick.id].side);
    }

    const options2 = this.generateHeadlineOptions(script, profile, analysis);
    const wordSet = (t) => new Set(String(t).toUpperCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const similar = (x, y) => {
      const A = wordSet(x), B = wordSet(y);
      const inter = [...A].filter(w => B.has(w)).length;
      return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.6;
    };
    const headlines = [];
    const seenTypes = new Set();
    const distinctPool = options2.filter(h => h.score > -5 && h.wc <= 5);
    for (const h of distinctPool) {
      if (headlines.length >= 3) break;
      if (headlines.some(x => similar(x.text, h.text))) continue;
      if (seenTypes.has(h.type) && headlines.length < 2 && distinctPool.some(o => !seenTypes.has(o.type) && !headlines.some(x => similar(x.text, o.text)))) continue;
      headlines.push(h);
      seenTypes.add(h.type);
    }
    for (const h of distinctPool) {
      if (headlines.length >= 3) break;
      if (!headlines.includes(h) && !headlines.some(x => similar(x.text, h.text))) headlines.push(h);
    }
    while (headlines.length < 3) headlines.push({ text: profile.hooks[headlines.length % 3].join(' '), score: 0, type: 'statement' });

    // Short headlines suit the split-screen family (two small labels); give it the shortest one.
    const splitSlot = chosen.findIndex(c => FAMILIES[c.id].cls === 'split');
    if (splitSlot >= 0) {
      let shortest = 0;
      headlines.forEach((h, idx) => { if (h.text.length < headlines[shortest].text.length) shortest = idx; });
      if (shortest !== splitSlot) [headlines[splitSlot], headlines[shortest]] = [headlines[shortest], headlines[splitSlot]];
    }

    const sceneOffset = seed % profile.scenes.length;
    const plans = chosen.map((c, i) => {
      const fam = FAMILIES[c.id];
      const scene = profile.scenes[(sceneOffset + i) % profile.scenes.length];
      const palIdx = (seed >>> (i * 3)) % fam.palettes.length;
      const headline = headlines[i];
      return {
        index: i,
        familyId: c.id,
        familyName: fam.name,
        label: String.fromCharCode(65 + i) + ' - ' + fam.name,
        headline: headline.text,
        headlineType: headline.type,
        headlineScore: Number(headline.score.toFixed(2)),
        badge: profile.badges[(seed + i) % profile.badges.length],
        eyebrow: profile.badges[(seed + i + 1) % profile.badges.length],
        scene,
        paletteIdx: palIdx,
        composition: fam.legacy,
        visualStrategy: [
          { id: 'cinematic-closeup', direction: 'extreme close-up portrait, face or key object fills 55-65 percent of frame, off-centre rule-of-thirds placement, intimate perspective', camera: 'tight 85mm portrait close-up, shallow depth of field, slight three-quarter angle', lighting: 'dramatic split key light, controlled rim light, deep but detailed shadows', placement: 'main subject anchored to the right third; preserve clean negative space for headline on the left' },
          { id: 'dramatic-split', direction: 'dramatic two-world split-screen, clear left-versus-right visual contrast, distinct subjects or emotional states on each side, strong diagonal divider', camera: 'wide 35mm cinematic two-shot, slightly low camera angle', lighting: 'contrasting warm practical light on one half and cool hard light on the other', placement: 'two visual halves must be unmistakably different; keep headline area clean and avoid tiny details' },
          { id: 'conceptual-story', direction: 'surreal conceptual visual metaphor with one instantly understandable symbolic object, bold scale contrast and cinematic depth', camera: 'wide 50mm environmental composition with foreground-to-background depth', lighting: 'sculpted volumetric backlight with a focused highlight on the metaphor object', placement: 'single metaphor object dominates one side, human subject if relevant on the opposite third' }
        ][i],
        subjectPlacement: ['right-third close-up', 'balanced opposing halves', 'metaphor-led asymmetrical composition'][i],
        selectionScore: Number(c.score.toFixed(2))
      };
    });

    return { plans, headlineOptions: options2.slice(0, 8).map(h => h.text), analysis, profile };
  }

  resolveFamilyId(designFamily, composition) {
    const raw = String(designFamily || '').trim();
    if (FAMILIES[raw]) return raw;
    const lower = raw.toLowerCase();
    if (LEGACY_FAMILY_ALIASES[lower]) return LEGACY_FAMILY_ALIASES[lower];
    const byName = FAMILY_IDS.find(id => FAMILIES[id].name.toLowerCase() === lower);
    if (byName) return byName;
    if (composition === 'editorial-right') return 'viral-contrast';
    if (composition === 'cinematic-bottom') return 'cinematic-documentary';
    return 'bold-illustration';
  }

  /* ------------------------- legacy-compatible concept API ------------------------- */

  getTopicProfile(script = {}) {
    const title = String(script.title || script.topic || '');
    const profile = this.detectProfile(script);
    return { ...profile, title, titleHash: this.hash(title) };
  }

  formatThumbnailTitle(title) {
    return String(title || 'Human Behavior').trim().slice(0, 100);
  }

  extractPrimaryText(title) {
    const script = typeof title === 'object' ? title : { title };
    const options = this.generateHeadlineOptions(script);
    return options[0] ? options[0].text : 'LOOK CLOSER';
  }

  generateSecondaryText(script) {
    return this.getTopicProfile(script).eyebrow;
  }

  selectComposition(index = 0) {
    return ['editorial-left', 'cinematic-bottom', 'editorial-right'][index % 3];
  }

  async generateConcept(script) {
    const profile = this.getTopicProfile(script);
    const analysis = this.analyzeScript(script);
    const recentVideos = await this.readFamilyHistory();
    const recentFamilies = recentVideos.slice(-4).reverse().map(v => (v.families || []).join('|'));
    const plan = this.planVariants(script, { profile, analysis, recentFamilies });

    return {
      title: this.formatThumbnailTitle(script.title || script.topic),
      style: 'dynamic multi-family design engine',
      primaryText: plan.plans[0].headline,
      secondaryText: plan.plans[0].badge,
      colors: {
        primary: FAMILIES[plan.plans[0].familyId].palettes[plan.plans[0].paletteIdx].dark,
        secondary: FAMILIES[plan.plans[0].familyId].palettes[plan.plans[0].paletteIdx].b,
        accent: FAMILIES[plan.plans[0].familyId].palettes[plan.plans[0].paletteIdx].a
      },
      emotion: analysis.emotionDescription,
      composition: plan.plans[0].composition,
      analysis,
      headlineOptions: plan.headlineOptions,
      variantPlans: plan.plans,
      profile
    };
  }

  /* ------------------------- image prompts ------------------------- */

  buildImagePrompt(concept, plan, attempt = 1) {
    const fam = FAMILIES[plan.familyId];
    const pal = fam.palettes[plan.paletteIdx % fam.palettes.length];
    const scene = plan.scene;
    const analysis = concept.analysis || {};
    const negative = fam.textSide === 'left'
      ? 'The left 40 percent of the frame is calm, dark and nearly empty'
      : fam.textSide === 'right'
        ? 'The right 45 percent of the frame is calm, dark and nearly empty'
        : fam.textSide === 'top'
          ? 'The upper 35 percent of the frame is calm, plain and nearly empty'
          : 'The lower 30 percent of the frame is calm, dark and nearly empty';

    const colorWords = 'dominant colours ' + pal.dark + ' deep tones with accents of ' + pal.a + ' and ' + pal.b;

    const strategy = plan.visualStrategy || {};
    const full = [
      fam.promptStyle + '.',
      strategy.direction || '',
      'Camera variation: ' + (strategy.camera || fam.camera) + '.',
      'Lighting variation: ' + (strategy.lighting || fam.light) + '.',
      'Subject placement: ' + (strategy.placement || fam.comp) + '.',
      'Subject: ' + scene.subject + '.',
      'Expression and body language: ' + scene.pose + '.',
      'Setting: ' + scene.env + '.',
      'Story idea: ' + (analysis.visualMetaphor || 'a visual metaphor for human psychology') + ', mood of ' + (concept.emotion || 'tension and curiosity') + '.',
      'Camera: ' + (strategy.camera || fam.camera) + '.',
      'Lighting: ' + (strategy.lighting || fam.light) + '.',
      'Colour palette: ' + colorWords + '.',
      'Composition: ' + fam.comp + '; focal point is ' + scene.focal + '.',
      'Negative space: ' + negative + ' so a headline can sit there.',
      'Every wall, screen, paper, sign and garment is blank and unmarked, a purely visual wordless image, 16:9 landscape, sharp focus on the subject, professional finish.'
    ].join(' ');

    if (attempt === 1) return full.slice(0, 1900);

    return [
      fam.promptStyle + '.',
      scene.subject + ', ' + scene.pose + ', ' + scene.env + '.',
      fam.camera + ', ' + fam.light + '.',
      negative + '. Blank unmarked surfaces, wordless image, 16:9.'
    ].join(' ').slice(0, 1200);
  }

  async createPrompt(concept) {
    const plan = (concept.variantPlans && concept.variantPlans[0]) ||
      { familyId: 'cinematic-documentary', paletteIdx: 0, scene: (concept.profile?.scenes || TOPIC_PROFILES[TOPIC_PROFILES.length - 1].scenes)[0] };
    return this.buildImagePrompt(concept, plan, 1);
  }

  /* ------------------------- footage frame helpers (local fallback) ------------------------- */

  async getDuration(source) {
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

    const result = spawnSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      source
    ], { windowsHide: true, timeout: 20000, encoding: 'utf8' });

    const duration = Number(String(result.stdout || '').trim());

    return Number.isFinite(duration) && duration > 0 ? duration : 10;
  }

  async extractFrame(source, suffix, seconds) {
    const output = path.join(this.outputPath, `frame_${suffix}_${this.makeId()}.jpg`);
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(Math.max(0, seconds)),
      '-i', source,
      '-frames:v', '1',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720',
      '-q:v', '2',
      output
    ], { windowsHide: true, timeout: 30000, encoding: 'utf8' });

    if (result.status !== 0) {
      throw new Error(`FFmpeg frame extraction failed: ${result.stderr || source}`);
    }

    await fs.access(output);
    return output;
  }

  async scoreFrame(framePath) {
    const stats = await sharp(framePath).stats();

    const channels = stats.channels || [];
    const means = channels.slice(0, 3).map(channel => channel.mean || 0);
    const deviations = channels.slice(0, 3).map(channel => channel.stdev || 0);

    const luminance = means.length
      ? (means[0] * 0.299 + means[1] * 0.587 + means[2] * 0.114)
      : 128;

    const contrast = deviations.length
      ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length
      : 0;

    const entropy = Number(stats.entropy || 0);
    const exposureScore = Math.max(0, 1 - Math.abs(luminance - 112) / 150);

    return (contrast * 0.55) + (entropy * 18) + (exposureScore * 28);
  }

  async extractBestFrame(source, suffix, titleSeed = '') {
    const duration = await this.getDuration(source);
    const fractions = [0.18, 0.34, 0.52, 0.70, 0.84];
    const offset = (parseInt(this.hash(titleSeed).slice(0, 4), 16) % 7) / 100;

    const candidates = [];

    try {
      for (let i = 0; i < fractions.length; i++) {
        const fraction = Math.min(0.92, fractions[i] + offset);
        const seconds = Math.max(0.2, Math.min(duration - 0.2, duration * fraction));

        try {
          const frame = await this.extractFrame(source, `${suffix}_${i}`, seconds);
          const score = await this.scoreFrame(frame);
          candidates.push({ path: frame, score, seconds });
        } catch (_) {}
      }

      if (!candidates.length) {
        throw new Error(`No usable frames extracted from ${path.basename(source)}`);
      }

      candidates.sort((a, b) => b.score - a.score);

      const best = candidates[0];

      for (const candidate of candidates.slice(1)) {
        try { await fs.unlink(candidate.path); } catch (_) {}
      }

      return best;
    } catch (error) {
      for (const candidate of candidates) {
        try { await fs.unlink(candidate.path); } catch (_) {}
      }
      throw error;
    }
  }

  async createThumbnail(concept, suffix = '') {
    const output = path.join(this.outputPath, `thumbnail_base_${suffix}_${this.makeId()}.jpg`);

    if (concept.sourcePath) {
      const best = await this.extractBestFrame(
        concept.sourcePath,
        suffix,
        concept.profile?.titleHash || concept.title
      );

      concept.selectedFrameScore = best.score;
      concept.selectedFrameTime = best.seconds;

      try {
        // Light base grade only: the design family applies its own colour grade afterwards.
        await sharp(best.path)
          .resize(this.width, this.height, { fit: 'cover', position: 'centre' })
          .sharpen({ sigma: 0.8 })
          .jpeg({ quality: 93 })
          .toFile(output);
      } finally {
        try { await fs.unlink(best.path); } catch (_) {}
      }
    } else {
      throw new Error('No source footage selected; refusing to create a fake gradient thumbnail');
    }

    return output;
  }

  /* ------------------------- text layout + measurement ------------------------- */

  splitHook(text, maxChars = 15) {
    const words = String(text || 'THE HIDDEN TRUTH')
      .toUpperCase()
      .replace(/[^\w\s?'!.-]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    const lines = [];
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;

      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) lines.push(line);

    return lines.slice(0, 3);
  }

  fitFontSize(lines, maxWidth, preferred = 100) {
    const longest = Math.max(1, ...lines.map(line => line.length));
    const estimatedWidth = longest * preferred * 0.64;

    return Math.max(56, Math.min(preferred, Math.floor(preferred * maxWidth / estimatedWidth)));
  }

  textSvg(lines, x, y, maxWidth, color, anchor = 'start', preferredSize = 100) {
    const fonts = this.getFonts();
    const safeLines = lines.map(line => this.escapeSvg(line));
    const size = this.fitFontSize(lines, maxWidth, preferredSize);
    const lineGap = Math.round(size * 1.04);

    return `
      <g font-family="${fonts.impact.stack}"
         font-size="${size}"
         font-weight="${fonts.impact.weight}"
         letter-spacing="-1"
         fill="${color}">
        ${safeLines.map((line, index) =>
          `<text x="${x}" y="${y + index * lineGap}" text-anchor="${anchor}">${line}</text>`
        ).join('')}
      </g>`;
  }

  async alphaBounds(svg, w, h, threshold = 28) {
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
    for (let y = 0; y < info.height; y++) {
      const row = y * info.width * ch;
      for (let x = 0; x < info.width; x++) {
        if (data[row + x * ch + 3] > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, touchesEdge: minX <= 0 || minY <= 0 || maxX >= info.width - 1 || maxY >= info.height - 1 };
  }

  textNodes(spec, font, size, x, y0, opts = {}) {
    const fill = opts.fillOverride;
    const strokeColor = opts.noStroke ? null : (opts.strokeOverride || spec.stroke);
    const strokeW = spec.strokeW || 0;
    return spec.lines.map((line, i) => {
      const f = fill || spec.fills[Math.min(i, spec.fills.length - 1)];
      const sx = x + (opts.dx || 0);
      const sy = y0 + i * size * (spec.lh || 1) + (opts.dy || 0);
      return '<text x="' + sx.toFixed(1) + '" y="' + sy.toFixed(1) + '" text-anchor="' + spec.ha + '"' +
        ' font-family="' + font.stack + '" font-size="' + size + '" font-weight="' + font.weight + '"' +
        (spec.italic ? ' font-style="italic"' : '') +
        ' letter-spacing="' + ((spec.ls || 0) * size).toFixed(2) + '" fill="' + f + '"' +
        (strokeColor && strokeW ? ' stroke="' + strokeColor + '" stroke-width="' + strokeW + '" stroke-linejoin="round" paint-order="stroke"' : '') +
        (opts.opacity ? ' fill-opacity="' + opts.opacity + '"' : '') +
        '>' + esc(line) + '</text>';
    }).join('');
  }

  async layoutBlock(spec) {
    const fonts = this.getFonts();
    const font = fonts[spec.font] || fonts.impact;
    const PW = 2600, PH = 900;
    const ox = spec.ha === 'start' ? 100 : (spec.ha === 'end' ? 2500 : 1300);

    let size = spec.maxSize;
    let bbox = null;
    let y0 = 0;
    let fitted = false;

    for (let i = 0; i < 22; i++) {
      y0 = size * 0.95 + 30;
      const svg = svgWrap(this.textNodes(spec, font, size, ox, y0, { noStroke: false }), '', PW, PH);
      bbox = await this.alphaBounds(svg, PW, PH);
      if (!bbox) throw new Error('Headline produced no visible pixels (font/render problem)');
      if (bbox.w <= spec.box.w && bbox.h <= spec.box.h) { fitted = true; break; }
      if (size <= spec.minSize) break;
      size = Math.max(spec.minSize, Math.floor(size * 0.94));
    }

    const b = spec.box;
    let dx;
    if (spec.ha === 'start') dx = b.x - bbox.x;
    else if (spec.ha === 'end') dx = b.x + b.w - (bbox.x + bbox.w);
    else dx = b.x + b.w / 2 - (bbox.x + bbox.w / 2);

    let dy;
    if (spec.va === 'top') dy = b.y - bbox.y;
    else if (spec.va === 'bottom') dy = b.y + b.h - (bbox.y + bbox.h);
    else dy = b.y + b.h / 2 - (bbox.y + bbox.h / 2);

    const finalBox = { x: Math.round(bbox.x + dx), y: Math.round(bbox.y + dy), w: bbox.w, h: bbox.h };
    const x = ox + dx;
    const baseY = y0 + dy;
    const rot = spec.rot || 0;
    const cx = finalBox.x + finalBox.w / 2;
    const cy = finalBox.y + finalBox.h / 2;
    const rotAttr = rot ? ' transform="rotate(' + rot + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')"' : '';

    // Measure the real final rendering on the real canvas (incl. rotation) to detect clipping.
    const measureSvg = svgWrap('<g' + rotAttr + '>' + this.textNodes(spec, font, size, x, baseY) + '</g>');
    const real = await this.alphaBounds(measureSvg, W, H);
    const realBox = real ? { x: real.x, y: real.y, w: real.w, h: real.h } : finalBox;

    // Per-line boxes measured from real renders (rotation ignored; used for strips and contrast sampling).
    const lineBoxes = [];
    for (let i = 0; i < spec.lines.length; i++) {
      const one = { ...spec, lines: [spec.lines[i]] };
      const svg = svgWrap(this.textNodes(one, font, size, x, baseY + i * size * (spec.lh || 1)));
      const lb = await this.alphaBounds(svg, W, H);
      lineBoxes.push(lb ? { x: lb.x, y: lb.y, w: lb.w, h: lb.h } : { x: realBox.x, y: realBox.y, w: realBox.w, h: Math.round(size) });
    }

    return {
      spec, font, size, x, baseY, rotAttr,
      bbox: realBox,
      lineBoxes,
      fitted,
      clipped: real ? real.touchesEdge : false,
      box: spec.box
    };
  }

  renderBlockMarkup(layout) {
    const { spec, font, size, x, baseY, rotAttr } = layout;
    const nodes = (opts) => this.textNodes(spec, font, size, x, baseY, opts || {});
    let out = '<g' + rotAttr + '>';
    if (spec.shadow === 'hard') {
      const [hx, hy] = spec.shadowOff || [6, 6];
      out += nodes({ dx: hx, dy: hy, fillOverride: spec.shadowColor || '#000', strokeOverride: spec.shadowColor || '#000' });
    } else if (spec.shadow === 'glow' || spec.shadow === 'glitch') {
      out += '<g filter="url(#blur8)">' + nodes({ fillOverride: spec.shadowColor || '#fff', strokeOverride: spec.shadowColor || '#fff', opacity: 0.7 }) + '</g>';
      if (spec.shadow === 'glitch' && spec.glitch) {
        out += nodes({ dx: -6, fillOverride: spec.glitch[0], strokeOverride: spec.glitch[0], opacity: 0.7 });
        out += nodes({ dx: 6, fillOverride: spec.glitch[1], strokeOverride: spec.glitch[1], opacity: 0.7 });
      }
    }
    if (spec.shadow === 'soft') out += '<g filter="url(#sh)">' + nodes() + '</g>';
    else out += nodes();
    out += '</g>';
    return out;
  }

  /* ------------------------- design renderer ------------------------- */

  async gradeBackground(bgPath, grade = {}) {
    let img = sharp(bgPath)
      .rotate()
      .resize(W, H, { fit: 'cover', position: 'attention' })
      .modulate({ brightness: grade.brightness ?? 1, saturation: grade.saturation ?? 1 });
    if (grade.a !== undefined) img = img.linear(grade.a, grade.b ?? 0);
    if (grade.gray) img = img.greyscale();
    if (grade.tint) img = img.tint(grade.tint);
    if (grade.median) img = img.median(grade.median);
    if (grade.flip) img = img.flop();
    return img.png().toBuffer();
  }

  async measureContrast(baseBuffer, layout) {
    let worst = Infinity;
    for (let i = 0; i < layout.lineBoxes.length; i++) {
      const b = layout.lineBoxes[i];
      const left = Math.max(0, Math.min(W - 2, b.x));
      const top = Math.max(0, Math.min(H - 2, b.y));
      const width = Math.max(1, Math.min(W - left, b.w));
      const height = Math.max(1, Math.min(H - top, b.h));
      const region = await sharp(baseBuffer).extract({ left, top, width, height }).png().toBuffer();
      const stats = await sharp(region).stats();
      const ch = stats.channels.slice(0, 3);
      const yMean = ch[0].mean * 0.299 + ch[1].mean * 0.587 + ch[2].mean * 0.114;
      const yStd = ch[0].stdev * 0.299 + ch[1].stdev * 0.587 + ch[2].stdev * 0.114;
      const fill = layout.spec.fills[Math.min(i, layout.spec.fills.length - 1)];
      const tl = relLuminanceHex(fill);
      const lightText = tl > 0.4;
      const eff = lightText ? Math.min(255, yMean + yStd) : Math.max(0, yMean - yStd);
      const bl = srgbToLinear(eff);
      const ratio = (Math.max(tl, bl) + 0.05) / (Math.min(tl, bl) + 0.05);
      if (ratio < worst) worst = ratio;
    }
    return Number(worst.toFixed(2));
  }

  async renderDesign(bgPath, familyId, plan = {}, options = {}) {
    const fam = FAMILIES[familyId];
    if (!fam) throw new Error('Unknown design family: ' + familyId);

    const fonts = this.getFonts();
    const profile = options.profile || this.detectProfile({ title: plan.headline || '' });
    const pal = fam.palettes[(plan.paletteIdx || 0) % fam.palettes.length];
    const headline = String(plan.headline || 'LOOK CLOSER').toUpperCase();
    const lines = options.lines || wrapHeadline(headline, fam.maxLines);
    const seed = seedFrom((options.title || headline) + '|' + familyId + '|' + (plan.index || 0));

    const c = {
      p: pal, rng: mulberry32(seed), lines, fonts, profile,
      eyebrow: plan.eyebrow || profile.eyebrow || 'HUMAN BEHAVIOR',
      badge: plan.badge || (profile.badges && profile.badges[0]) || 'LOOK CLOSER',
      question: /\?$/.test(headline),
      title: String(options.title || plan.title || ''),
      tw: (str, size, ls = 0) => Math.ceil(String(str).length * (size * 0.72 + ls))
    };

    const built = fam.build(c);
    const layouts = [];
    for (const block of built.text) {
      let laid = await this.layoutBlock(block);
      if (!laid.fitted && block.minSize > 50) {
        // Long headline in a narrow box: allow a somewhat smaller (still large) size instead of overflowing.
        const relaxed = await this.layoutBlock({ ...block, minSize: Math.max(50, Math.floor(block.minSize * 0.8)) });
        if (relaxed.fitted) laid = relaxed;
      }
      layouts.push(laid);
    }

    const minX = Math.min(...layouts.map(l => l.bbox.x));
    const minY = Math.min(...layouts.map(l => l.bbox.y));
    const maxX = Math.max(...layouts.map(l => l.bbox.x + l.bbox.w));
    const maxY = Math.max(...layouts.map(l => l.bbox.y + l.bbox.h));
    const info = {
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      blocks: layouts.map(l => ({ bbox: l.bbox, size: l.size, lineBoxes: l.lineBoxes }))
    };

    const base = await this.gradeBackground(bgPath, built.grade || {});
    let decoration = '';
    try { decoration = built.decorate ? built.decorate(info) : ''; } catch (error) {
      this.logger.warn('Decoration failed for ' + familyId + ': ' + error.message);
    }

    const buildUnder = (panel) => svgWrap(
      built.under + (built.decorateBeforeText ? decoration : '') + (panel || ''),
      built.defs || ''
    );

    let underSvg = buildUnder('');
    let withUnder = await sharp(base).composite([{ input: Buffer.from(underSvg) }]).png().toBuffer();

    let contrasts = [];
    for (const l of layouts) contrasts.push(await this.measureContrast(withUnder, l));
    let contrast = Math.min(...contrasts);
    let panelAdded = false;

    if (contrast < 3.0 && !options.noAutoPanel) {
      const pad = 22;
      const panel = layouts.filter(l => relLuminanceHex(l.spec.fills[0]) > 0.4).map(l => '<rect x="' + (l.bbox.x - pad) + '" y="' + (l.bbox.y - pad) + '" width="' + (l.bbox.w + pad * 2) + '" height="' + (l.bbox.h + pad * 2) + '" rx="14" fill="#000" fill-opacity=".58"/>').join('');
      underSvg = buildUnder(panel);
      withUnder = await sharp(base).composite([{ input: Buffer.from(underSvg) }]).png().toBuffer();
      contrasts = [];
      for (const l of layouts) contrasts.push(await this.measureContrast(withUnder, l));
      contrast = Math.min(...contrasts);
      panelAdded = true;
    }

    const textSvg = svgWrap(
      (built.decorateBeforeText ? '' : decoration) + layouts.map(l => this.renderBlockMarkup(l)).join('') + (built.over || ''),
      built.defs || ''
    );

    const buffer = await sharp(withUnder).composite([{ input: Buffer.from(textSvg) }]).png().toBuffer();

    return {
      buffer,
      layout: {
        familyId,
        lines,
        fontsUsed: [...new Set(layouts.map(l => l.font.primary))],
        fontSizes: layouts.map(l => l.size),
        textBounds: info.bbox,
        blockBounds: layouts.map(l => l.bbox),
        fitted: layouts.every(l => l.fitted),
        clipped: layouts.some(l => l.clipped),
        contrastRatio: contrast,
        autoPanelAdded: panelAdded
      }
    };
  }

  /* ------------------------- local overlay (kept signature) ------------------------- */

  async addTextOverlay(imagePath, concept, suffix = '') {
    const plan = concept.plan || (concept.variantPlans && concept.variantPlans[0]);
    const output = path.join(this.outputPath, `thumbnail_design_${suffix}_${this.makeId()}.png`);

    if (plan) {
      const rendered = await this.renderDesign(imagePath, plan.familyId, { ...plan, headline: concept.primaryText || plan.headline }, {
        profile: concept.profile, title: concept.title
      });
      concept.layout = rendered.layout;
      await fs.writeFile(output, rendered.buffer);
      return output;
    }

    const familyId = this.resolveFamilyId(null, concept.composition);
    const rendered = await this.renderDesign(imagePath, familyId, { headline: concept.primaryText, paletteIdx: 0 }, { profile: concept.profile, title: concept.title });
    concept.layout = rendered.layout;
    await fs.writeFile(output, rendered.buffer);
    return output;
  }

  /* ------------------------- optimisation + validation ------------------------- */

  async optimizeForYouTube(imagePath, suffix = '') {
    const output = path.join(this.outputPath, `thumbnail_optimized_${suffix}_${this.makeId()}.jpg`);

    for (const quality of [92, 86, 80, 74, 68, 60, 50]) {
      try { await fs.unlink(output); } catch (_) {}

      await sharp(imagePath)
        .resize(1280, 720, { fit: 'cover' })
        .jpeg({ quality, progressive: true, mozjpeg: true })
        .toFile(output);

      const stat = await fs.stat(output);

      if (stat.size <= this.maxBytes) {
        return output;
      }
    }

    throw new Error('Thumbnail could not be compressed below 2 MB');
  }

  async getFileSize(filePath) {
    return (await fs.stat(filePath)).size;
  }

  /**
   * Real, measurable checks only. This does NOT perform OCR and does NOT judge aesthetic quality.
   */
  async validateThumbnailFile(file, layout = null) {
    const checks = {
      fileExists: false, decodes: false, correctDimensions: false, underTwoMB: false,
      notBlank: false, textFit: true, textClipped: false, contrastOk: true, contrastRatio: null,
      minFontSize: null, readableAtSmallSize: true, headlineWordCount: null,
      ocrVerified: false, visualReviewed: false
    };
    const problems = [];

    let stat;
    try { stat = await fs.stat(file); checks.fileExists = stat.size > 0; } catch (_) {}
    if (!checks.fileExists) throw new Error('Thumbnail output missing or empty: ' + file);

    checks.underTwoMB = stat.size <= this.maxBytes;

    let decoded;
    try {
      decoded = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      checks.decodes = decoded.data.length > 0;
    } catch (error) {
      throw new Error('Thumbnail failed to decode: ' + error.message);
    }
    checks.correctDimensions = decoded.info.width === 1280 && decoded.info.height === 720;

    const stats = await sharp(file).stats();
    const stdev = stats.channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) / 3;
    const mean = stats.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
    checks.notBlank = stdev > 12 && mean > 4 && mean < 251;
    checks.pixelStdev = Number(stdev.toFixed(1));

    if (layout) {
      const margin = 28;
      const bounds = layout.blockBounds || [layout.textBounds];
      checks.textClipped = !!layout.clipped;
      const insideSafe = bounds.every(b => b.x >= margin && b.y >= margin && b.x + b.w <= W - margin && b.y + b.h <= H - margin);
      checks.textFit = !!layout.fitted && insideSafe && !layout.clipped;
      checks.contrastRatio = layout.contrastRatio;
      checks.contrastOk = layout.contrastRatio >= 3.0;
      checks.minFontSize = Math.min(...layout.fontSizes);
      checks.readableAtSmallSize = checks.minFontSize >= 56;
      checks.headlineWordCount = layout.lines.join(' ').split(/\s+/).filter(Boolean).length;
      checks.fontsUsed = layout.fontsUsed;
      checks.autoPanelAdded = layout.autoPanelAdded;
    }

    if (!checks.correctDimensions) problems.push('dimensions');
    if (!checks.underTwoMB) problems.push('file size');
    if (!checks.notBlank) problems.push('blank/near-blank image');
    if (!checks.textFit) problems.push('text fit/clipping');
    if (!checks.contrastOk) problems.push('headline contrast below 3:1');
    checks.problems = problems;
    checks.hardFailure = !checks.correctDimensions || !checks.underTwoMB || !checks.notBlank || !checks.decodes;
    checks.valid = problems.length === 0;
    checks.note = 'Checks are programmatic (dimensions, size, decode, pixel variance, measured text bounds and contrast). No OCR was run and no aesthetic judgement is implied; review the images by eye.';
    return checks;
  }

  async imageSignature(file) {
    const { data } = await sharp(file).resize(32, 18, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    return data;
  }

  async measureVariantDiversity(variants) {
    const sigs = [];
    for (const v of variants) {
      try { sigs.push(await this.imageSignature(v.path)); } catch (_) { sigs.push(null); }
    }
    let minDiff = null;
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        if (!sigs[i] || !sigs[j]) continue;
        let total = 0;
        for (let k = 0; k < sigs[i].length; k++) total += Math.abs(sigs[i][k] - sigs[j][k]);
        const diff = total / sigs[i].length / 255;
        if (minDiff === null || diff < minDiff) minDiff = diff;
      }
    }
    return {
      distinctFamilies: new Set(variants.map(v => v.designFamilyId || v.designFamily || v.label)).size,
      distinctHeadlines: new Set(variants.map(v => v.hook)).size,
      distinctCompositions: new Set(variants.map(v => v.layoutClass || v.composition)).size,
      minPairwiseImageDifference: minDiff === null ? null : Number(minDiff.toFixed(3)),
      method: 'mean absolute difference of 32x18 greyscale thumbnails (0 = identical, 1 = opposite)'
    };
  }

  async finalizeRender(rendered, suffix) {
    const tmp = path.join(this.outputPath, `.render_${suffix}_${this.makeId()}.png`);
    await fs.writeFile(tmp, rendered.buffer);
    try {
      const optimized = await this.optimizeForYouTube(tmp, suffix);
      const meta = await sharp(optimized).metadata();
      const bytes = await this.getFileSize(optimized);
      const checks = await this.validateThumbnailFile(optimized, rendered.layout);
      if (checks.hardFailure) {
        try { await fs.unlink(optimized); } catch (_) {}
        throw new Error('Thumbnail failed validation: ' + checks.problems.join(', '));
      }
      return { path: optimized, dimensions: { width: meta.width, height: meta.height }, fileSize: bytes, format: meta.format, qualityChecks: checks, layout: rendered.layout };
    } finally {
      try { await fs.unlink(tmp); } catch (_) {}
    }
  }

  /* ------------------------- local footage fallback ------------------------- */

  scoreSourceName(source, profile) {
    const name = source.name.toLowerCase();
    let score = 0;

    for (const pattern of profile.searches) {
      if (pattern.test(name)) score += 10;
    }

    if (/portrait|face|person|people|couple|meeting|thinking/i.test(name)) score += 3;
    if (/abstract|logo|intro|outro|animation/i.test(name)) score -= 8;

    return score;
  }

  async selectSources(script, profile, count = 3) {
    const sources = await this.getFootageSources();

    if (!sources.length) {
      throw new Error(`No footage found in workspace: ${this.projectRoot}`);
    }

    const history = await this.readHistory();
    const recent = new Set(
      history.slice(-Math.max(3, Math.floor(sources.length * 0.65)))
        .map(item => item.path)
    );

    const ranked = sources
      .map(source => ({
        ...source,
        relevance: this.scoreSourceName(source, profile),
        recentlyUsed: recent.has(source.path)
      }))
      .sort((a, b) => {
        const aScore = a.relevance - (a.recentlyUsed ? 12 : 0);
        const bScore = b.relevance - (b.recentlyUsed ? 12 : 0);
        return bScore - aScore;
      });

    const chosen = [];
    const remaining = [...ranked];

    while (chosen.length < count && remaining.length) {
      const bestScore = remaining[0].relevance - (remaining[0].recentlyUsed ? 12 : 0);
      const tied = remaining.filter(item =>
        item.relevance - (item.recentlyUsed ? 12 : 0) === bestScore
      );

      const seed = parseInt(
        this.hash(`${profile.titleHash}_${chosen.length}`).slice(0, 8),
        16
      );

      const selected = tied[seed % tied.length];
      chosen.push(selected);
      remaining.splice(remaining.findIndex(item => item.path === selected.path), 1);
    }

    await this.writeHistory(
      history.concat(chosen.map(source => ({
        path: source.path,
        name: source.name,
        title: profile.title,
        usedAt: new Date().toISOString()
      })))
    );

    return chosen;
  }

  async buildLocalVariant(concept, plan, source, index) {
    const profile = concept.profile;
    const variantConcept = {
      ...concept,
      primaryText: plan.headline,
      secondaryText: plan.badge,
      composition: plan.composition,
      sourcePath: source.path,
      sourceFootage: source.name,
      plan: { ...plan },
      profile
    };

    let base;
    let overlay;
    try {
      base = await this.createThumbnail(variantConcept, `v${index + 1}`);
      overlay = await this.addTextOverlay(base, variantConcept, `v${index + 1}`);
      const optimized = await this.optimizeForYouTube(overlay, `v${index + 1}`);
      const meta = await sharp(optimized).metadata();
      const bytes = await this.getFileSize(optimized);
      const checks = await this.validateThumbnailFile(optimized, variantConcept.layout);
      if (checks.hardFailure) throw new Error(`Local variant ${index + 1} failed validation: ${checks.problems.join(', ')}`);

      return {
        label: plan.label,
        designFamily: plan.familyName,
        designFamilyId: plan.familyId,
        layoutClass: FAMILIES[plan.familyId].cls,
        visualStrategyId: plan.visualStrategy?.id || null,
        path: optimized,
        sourceFootage: source.name,
        hook: plan.headline,
        headlineType: plan.headlineType,
        composition: plan.composition,
        selectedFrameScore: variantConcept.selectedFrameScore,
        selectedFrameTime: variantConcept.selectedFrameTime,
        concept: variantConcept,
        dimensions: { width: meta.width, height: meta.height },
        fileSize: bytes,
        format: meta.format,
        layout: variantConcept.layout,
        qualityChecks: { ...checks, frameScored: true }
      };
    } finally {
      for (const temp of [base, overlay]) {
        if (temp) { try { await fs.unlink(temp); } catch (_) {} }
      }
    }
  }

  async ensurePlans(concept, script) {
    if (!concept.variantPlans || concept.variantPlans.length !== 3) {
      const profile = concept.profile || this.getTopicProfile(script);
      const analysis = concept.analysis || this.analyzeScript(script);
      const planned = this.planVariants(script, { profile, analysis });
      concept.variantPlans = planned.plans;
      concept.analysis = analysis;
      concept.headlineOptions = planned.headlineOptions;
      concept.profile = profile;
    }
    return concept.variantPlans;
  }

  async generateABVariantsLocal(concept, script = {}) {
    const profile = concept.profile || this.getTopicProfile(script);
    concept.profile = profile;
    const plans = await this.ensurePlans(concept, script);
    const sources = await this.selectSources(script, profile, 3);

    const results = [];
    for (let i = 0; i < plans.length; i++) {
      const source = sources[i];
      if (!source) throw new Error(`Missing source footage for variant ${i + 1}`);
      results.push(await this.buildLocalVariant(concept, plans[i], source, i));
    }
    return results;
  }

  /* ------------------------- Cloudflare Workers AI (FLUX.1 Schnell) ------------------------- */

  async generateCloudflareImage(prompt, suffix) {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!token || !accountId) {
      throw new Error('Cloudflare credentials are not loaded in this process.');
    }

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    const steps = Math.max(1, Math.min(8, Number(process.env.CF_FLUX_STEPS) || 4));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: String(prompt).slice(0, 2000), steps }),
      signal: AbortSignal.timeout(120000)
    });

    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error(`Cloudflare image API returned a non-JSON response (HTTP ${response.status})`);
    }

    if (!response.ok || !payload.success || !payload.result?.image) {
      const detail = (payload.errors || [])
        .map(e => e.message || e.code)
        .filter(Boolean)
        .join('; ');
      const error = new Error(`Cloudflare image API failed (HTTP ${response.status}): ${detail || 'No image returned'}`);
      error.status = response.status;
      throw error;
    }

    const imageBuffer = Buffer.from(payload.result.image, 'base64');
    if (imageBuffer.length < 10000) {
      throw new Error('Cloudflare returned an unexpectedly small image.');
    }

    try {
      await sharp(imageBuffer).metadata();
    } catch (error) {
      throw new Error('Cloudflare returned an undecodable image: ' + error.message);
    }

    const filePath = path.join(this.outputPath, `.cf-background-${suffix}-${this.makeId()}.png`);
    await fs.writeFile(filePath, imageBuffer);

    return {
      path: filePath,
      neurons: payload.result.usage?.neurons ?? null,
      bytes: imageBuffer.length
    };
  }

  async generateCloudflareImageWithRetry(concept, plan, suffix) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const prompt = this.buildImagePrompt(concept, plan, attempt);
        const result = await this.generateCloudflareImage(prompt, suffix);
        result.prompt = prompt;
        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`Cloudflare attempt ${attempt} failed for ${suffix}: ${error.message}`);
        if (error.status === 401 || error.status === 403) break;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastError;
  }

  async composeCloudflareThumbnail(backgroundPath, hook, composition, suffix, profile, designFamily, extra = {}) {
    const familyId = this.resolveFamilyId(designFamily, composition);
    const plan = {
      ...(extra.plan || {}),
      headline: Array.isArray(hook) ? hook.join(' ') : String(hook || 'LOOK CLOSER'),
      paletteIdx: extra.plan?.paletteIdx ?? 0,
      index: extra.plan?.index ?? 0,
      badge: extra.plan?.badge
    };

    const rendered = await this.renderDesign(backgroundPath, familyId, plan, { profile, title: extra.title });
    const finalized = await this.finalizeRender(rendered, 'cf-' + suffix);

    return {
      path: finalized.path,
      dimensions: finalized.dimensions,
      fileSize: finalized.fileSize,
      format: finalized.format,
      designFamily: FAMILIES[familyId].name,
      designFamilyId: familyId,
      layout: finalized.layout,
      qualityChecks: finalized.qualityChecks
    };
  }

  async generateCloudflareVariants(concept, script = {}) {
    concept.profile = concept.profile || this.getTopicProfile(script);
    const profile = concept.profile;
    const plans = await this.ensurePlans(concept, script);

    const results = [];
    let localSources = null;

    for (let i = 0; i < plans.length; i++) {
      const plan = { ...plans[i] };
      const suffix = 'v5-' + (i + 1);
      let background;

      try {
        background = await this.generateCloudflareImageWithRetry(concept, plan, suffix);
        const composed = await this.composeCloudflareThumbnail(
          background.path, plan.headline, plan.composition, suffix, profile, plan.familyId,
          { plan, title: concept.title }
        );

        results.push({
          label: plan.label,
          designFamily: composed.designFamily,
          designFamilyId: composed.designFamilyId,
          layoutClass: FAMILIES[composed.designFamilyId].cls,
          visualStrategyId: plan.visualStrategy?.id || null,
          path: composed.path,
          sourceFootage: 'Cloudflare Workers AI - FLUX.1 Schnell',
          provider: 'cloudflare-workers-ai',
          model: '@cf/black-forest-labs/flux-1-schnell',
          hook: plan.headline,
          headlineType: plan.headlineType,
          composition: plan.composition,
          scene: plan.scene.subject,
          prompt: background.prompt,
          dimensions: composed.dimensions,
          fileSize: composed.fileSize,
          format: composed.format,
          neuronsUsed: background.neurons,
          layout: composed.layout,
          qualityChecks: { ...composed.qualityChecks, aiBackgroundGenerated: true }
        });
      } catch (error) {
        this.logger.warn(`Variant ${i + 1} AI path failed (${error.message}); trying local footage for this variant`);
        try {
          if (!localSources) localSources = await this.selectSources(script, profile, 3);
          const local = await this.buildLocalVariant(concept, plans[i], localSources[i], i);
          results.push({ ...local, provider: 'local-footage-fallback' });
        } catch (fallbackError) {
          throw new Error(`Variant ${i + 1} failed on Cloudflare (${error.message}) and on local fallback (${fallbackError.message})`);
        }
      } finally {
        if (background?.path) {
          try { await fs.unlink(background.path); } catch (_) {}
        }
      }
    }
    return results;
  }

  async generateABVariants(concept, script = {}) {
    if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
      try {
        this.logger.info('Generating 3 AI thumbnail backgrounds with Cloudflare FLUX.1 Schnell');
        return await this.generateCloudflareVariants(concept, script);
      } catch (error) {
        this.logger.warn(`Cloudflare generation failed; switching to local footage fallback: ${error.message}`);
      }
    } else {
      this.logger.warn('Cloudflare credentials unavailable; using local footage renderer.');
    }

    const localVariants = await this.generateABVariantsLocal(concept, script);
    return localVariants.map(item => ({ ...item, provider: 'local-footage-fallback' }));
  }

  /* ------------------------- AI visual review + quality ranking ------------------------- */

  async inspectThumbnailVisual(file, variant) {
    const result = {
      available: false, passed: false, score: 0, concerns: [],
      subjectQuality: null, clutter: null, focalPoint: null,
      textReadability: null, composition: null, curiosity: null,
      provider: null
    };
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !accountId) return result;

    try {
      const imageBuffer = await sharp(file).resize(768, 432, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
      const dataUrl = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Act as a strict professional YouTube thumbnail art director. Inspect this actual 16:9 thumbnail at small-screen size. Return ONLY valid JSON with keys score (0-100), passed (boolean), subjectQuality (0-10), clutter (0-10 where 10 means very cluttered), focalPoint (0-10), textReadability (0-10), composition (0-10), curiosity (0-10), concerns (array of short strings). Penalize generic stock-looking visuals, weak facial expression, repeated/template-like layout, unclear focal point, too many words, text-image repetition, poor contrast, cramped edges, outdated meme/poster aesthetics, and clutter. Reward modern cinematic art direction, strong emotion/tension, one clear focal hook, visual storytelling and a curiosity gap. Text visible in image: ' + String(variant.hook || '') + '. Design family: ' + String(variant.designFamily || '') + '. Do not guess CTR; assess creative potential only.' },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }]
        }),
        signal: AbortSignal.timeout(90000)
      });
      if (!response.ok) throw new Error('Vision API HTTP ' + response.status);
      const payload = await response.json();
      const raw = payload.result?.response || payload.result?.output || payload.result?.choices?.[0]?.message?.content || '';
      const match = String(raw).match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Vision model did not return JSON');
      const parsed = JSON.parse(match[0]);
      result.available = true;
      result.provider = 'cloudflare-workers-ai-llama-3.2-vision';
      result.score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
      result.passed = parsed.passed === true && result.score >= 68;
      for (const key of ['subjectQuality', 'clutter', 'focalPoint', 'textReadability', 'composition', 'curiosity']) {
        result[key] = Number.isFinite(Number(parsed[key])) ? Math.max(0, Math.min(10, Number(parsed[key]))) : null;
      }
      result.concerns = Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 8).map(String) : [];
    } catch (error) {
      this.logger.warn('AI thumbnail visual review unavailable: ' + error.message);
      result.error = error.message;
    }
    return result;
  }

  async scoreThumbnailCandidate(variant) {
    const visual = await this.inspectThumbnailVisual(variant.path, variant);
    const layout = variant.layout || {};
    const wordCount = String(variant.hook || '').trim().split(/\s+/).filter(Boolean).length;
    const checks = variant.qualityChecks || {};
    const safe = (layout.blockBounds || [layout.textBounds].filter(Boolean)).every(b => {
      const hitsBottomRightTimestamp = b.x + b.w > 1040 && b.y + b.h > 600;
      const hitsTopRightOverlay = b.x + b.w > 1110 && b.y < 120;
      return !hitsBottomRightTimestamp && !hitsTopRightOverlay;
    });
    const wordsScore = wordCount >= 2 && wordCount <= 5 ? 100 : Math.max(0, 100 - Math.abs(wordCount - 4) * 24);
    const titleWords = new Set(String(variant.sourceTitle || variant.concept?.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2));
    const hookWords = String(variant.hook || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
    const titleOverlap = hookWords.length ? hookWords.filter(w => titleWords.has(w)).length / hookWords.length : 0;
    const curiosityGapScore = titleOverlap > 0.8 ? 20 : titleOverlap > 0.6 ? 55 : 100;
    const technical = (checks.correctDimensions ? 20 : 0) + (checks.underTwoMB ? 15 : 0) +
      (checks.notBlank ? 15 : 0) + (checks.textFit ? 15 : 0) + (checks.contrastOk ? 15 : 0) +
      (checks.readableAtSmallSize ? 10 : 0) + (safe ? 10 : 0);
    const heuristic = Math.round((technical * 0.60) + (wordsScore * 0.25) + (curiosityGapScore * 0.15));
    const score = visual.available ? Math.round(visual.score * 0.72 + heuristic * 0.28) : heuristic;
    const hardReject = checks.hardFailure || !checks.decodes || !checks.correctDimensions ||
      !checks.underTwoMB || !checks.textFit || !checks.contrastOk || !checks.readableAtSmallSize || !safe || wordCount > 5 || titleOverlap > 0.8;
    return {
      score, passed: !hardReject && (!visual.available || visual.passed),
      rejectionReasons: [
        ...(hardReject ? ['technical, text, or mobile-safe-zone validation failed'] : []),
        ...(visual.available && !visual.passed ? visual.concerns : []),
        ...(wordCount > 5 ? ['headline exceeds five words'] : []),
        ...(titleOverlap > 0.8 ? ['headline repeats the video title instead of creating a curiosity gap'] : [])
      ],
      visualReview: visual,
      technicalScore: heuristic,
      mobileSafeZone: safe,
      headlineWordCount: wordCount,
      titleOverlap: Number(titleOverlap.toFixed(2)),
      curiosityGapScore
    };
  }

  async reviewAndRankVariants(variants) {
    const reviewed = [];
    for (const variant of variants) {
      const review = await this.scoreThumbnailCandidate(variant);
      reviewed.push({ ...variant, reviewScore: review.score, reviewPassed: review.passed, review });
    }
    const diversity = await this.measureVariantDiversity(reviewed);
    const families = new Set(reviewed.map(v => v.designFamilyId));
    const layouts = new Set(reviewed.map(v => v.layoutClass));
    const strategies = new Set(reviewed.map(v => v.visualStrategyId || v.concept?.plan?.visualStrategy?.id || v.concept?.variantPlans?.[v.planIndex]?.visualStrategy?.id || v.composition));
    const duplicateComposition = families.size < 3 || layouts.size < 3 || strategies.size < 3 ||
      (diversity.minPairwiseImageDifference !== null && diversity.minPairwiseImageDifference < 0.075);
    if (duplicateComposition) {
      for (const v of reviewed) {
        v.reviewPassed = false;
        v.review.rejectionReasons.push('candidate set repeats a visual family/layout or looks too similar');
      }
    }
    reviewed.sort((a, b) => Number(b.reviewPassed) - Number(a.reviewPassed) || b.reviewScore - a.reviewScore);
    return { variants: reviewed, diversity, duplicateComposition, allPassed: reviewed.length === 3 && reviewed.every(v => v.reviewPassed) };
  }

  async generateThumbnail(script) {
    if (!script || !(script.title || script.topic)) {
      throw new Error('A script with a title or topic is required');
    }

    await this.initialize();
    await this.resolveWorkspace(script);
    this.logger.info(`V6 visual-quality thumbnail engine: ${script.title || script.topic}`);

    const concept = await this.generateConcept(script);
    let prompt = await this.createPrompt(concept);
    let bestReview = null;
    let variants = [];
    let regenerationRounds = 0;
    const approvedPool = new Map();

    // Keep passing candidates across rounds; only rejected design families need replacement.
    for (let round = 0; round < 3; round++) {
      if (round > 0) {
        regenerationRounds++;
        const plans = await this.ensurePlans(concept, script);
        const scenes = concept.profile?.scenes || [];
        concept.variantPlans = plans.map((p, i) => {
          const currentIndex = scenes.indexOf(p.scene);
          const nextScene = scenes[(Math.max(0, currentIndex) + round + i + 1) % Math.max(1, scenes.length)] || p.scene;
          return {
            ...p, scene: nextScene,
            paletteIdx: (p.paletteIdx + round + i + 1) % FAMILIES[p.familyId].palettes.length,
            visualStrategy: {
              ...(p.visualStrategy || {}),
              direction: (p.visualStrategy?.direction || '') + '; fresh alternate take, change camera distance, silhouette, gesture and foreground depth; avoid previous framing',
              camera: round % 2 ? 'dynamic 24mm low-angle wide cinematic frame' : 'intimate 85mm portrait with strong foreground separation',
              lighting: round % 2 ? 'hard directional chiaroscuro with atmospheric haze' : 'soft motivated key light with bold coloured rim and deep negative fill'
            }
          };
        });
        prompt = await this.createPrompt(concept);
      }

      const generated = await this.generateABVariants(concept, script);
      if (generated.length !== 3) throw new Error(`Expected 3 thumbnail variants; generated ${generated.length}`);
      generated.forEach((v, i) => {
        v.planIndex = i;
        v.sourceTitle = concept.title;
        v.visualStrategyId = v.visualStrategyId || concept.variantPlans[i]?.visualStrategy?.id || null;
      });
      const reviewed = await this.reviewAndRankVariants(generated);
      bestReview = reviewed;

      for (const candidate of reviewed.variants) {
        const familyId = candidate.designFamilyId;
        const previous = approvedPool.get(familyId);
        if (candidate.reviewPassed && (!previous || candidate.reviewScore > previous.reviewScore)) {
          if (previous?.path) { try { await fs.unlink(previous.path); } catch (_) {} }
          approvedPool.set(familyId, candidate);
        } else if (candidate.path) {
          try { await fs.unlink(candidate.path); } catch (_) {}
        }
      }

      variants = [...approvedPool.values()].sort((a, b) => b.reviewScore - a.reviewScore);
      if (variants.length === 3) break;
      this.logger.warn(`Thumbnail review round ${round + 1}: ${variants.length}/3 distinct candidates approved; regenerating rejected candidates.`);
    }

    if (variants.length !== 3) {
      const reasons = [...approvedPool.values()].flatMap(v => v.review?.rejectionReasons || []);
      for (const candidate of approvedPool.values()) {
        if (candidate.path) { try { await fs.unlink(candidate.path); } catch (_) {} }
      }
      throw new Error('Thumbnail quality gate could not approve three genuinely distinct candidates after 3 rounds. No weak thumbnail was selected. ' + [...new Set(reasons)].join('; '));
    }

    const finalDiversity = await this.measureVariantDiversity(variants);
    const finalFamilies = new Set(variants.map(v => v.designFamilyId));
    const finalLayouts = new Set(variants.map(v => v.layoutClass));
    const finalStrategies = new Set(variants.map(v => v.visualStrategyId));
    if (finalFamilies.size !== 3 || finalLayouts.size !== 3 || finalStrategies.size !== 3 ||
        (finalDiversity.minPairwiseImageDifference !== null && finalDiversity.minPairwiseImageDifference < 0.075)) {
      for (const candidate of variants) { try { await fs.unlink(candidate.path); } catch (_) {} }
      throw new Error('Final thumbnail set failed the cross-round composition diversity gate; no candidate was approved.');
    }

    const usedCloudflare = variants.some(v => v.provider === 'cloudflare-workers-ai');
    const familyHistory = (await this.readFamilyHistory()).concat([{
      title: concept.title,
      families: variants.map(v => v.designFamilyId),
      at: new Date().toISOString(),
      visualScores: variants.map(v => v.reviewScore)
    }]);
    await this.writeFamilyHistory(familyHistory);

    const thumbnailData = {
      path: primary.path,
      concept,
      prompt,
      variants,
      variantCount: variants.length,
      recommendedCandidate: primary.label,
      comparison: variants.map((v, i) => ({
        rank: i + 1, label: v.label, designFamily: v.designFamily,
        headline: v.hook, score: v.reviewScore, passed: v.reviewPassed,
        concerns: v.review?.rejectionReasons || []
      })),
      regenerationRounds,
      dimensions: primary.dimensions,
      fileSize: primary.fileSize,
      createdAt: new Date().toISOString(),
      generationMode: variants.every(v => v.provider === 'cloudflare-workers-ai')
        ? 'cloudflare-flux-design-engine-v6'
        : (usedCloudflare ? 'mixed-cloudflare-and-local-v6' : 'local-design-engine-v6-fallback'),
      paidApiUsed: false,
      imageProvider: primary.provider || 'local-footage-fallback',
      imageModel: primary.model || null,
      designFamilies: variants.map(v => v.designFamily),
      headlines: variants.map(v => v.hook),
      headlineOptions: concept.headlineOptions,
      analysis: concept.analysis,
      workspace: this.projectRoot,
      qualityChecks: {
        allVariantsValid: variants.every(item => item.qualityChecks && item.qualityChecks.valid),
        allCandidatesPassedVisualGate: variants.every(v => v.reviewPassed),
        visionInspectionAvailable: variants.some(v => v.review?.visualReview?.available),
        visualScores: variants.map(v => v.reviewScore),
        diversity: finalDiversity,
        duplicateCompositionRejected: false,
        distinctVisualStrategies: finalStrategies.size,
        regenerationRounds,
        mobileSafeZonesChecked: true,
        ocrVerified: false,
        visualReviewed: variants.some(v => v.review?.visualReview?.available),
        note: 'Actual image vision review is attempted with Cloudflare Llama 3.2 Vision when credentials/model access are available; technical and layout checks always run. Vision unavailability is reported, never falsely marked as verified. Scores estimate creative quality, not guaranteed CTR.'
      }
    };

    if (this.db && typeof this.db.saveThumbnail === 'function') {
      await this.db.saveThumbnail(thumbnailData);
    }
    this.logger.info('V6 ranked thumbnail candidates: ' + thumbnailData.comparison.map(v => v.rank + ':' + v.score).join(' | '));
    return thumbnailData;
  }

  generateAlternativeText(originalText) {
    const alternatives = {
      'THE HIDDEN MANIPULATION': 'ARE YOU BEING PLAYED?',
      'THE HIDDEN TRUTH': 'WHAT THEY HIDE',
      'SPOT THE WARNING SIGNS': 'SEE THE RED FLAGS'
    };

    return alternatives[originalText] || 'LOOK CLOSER';
  }

  hexToRgb(color) {
    return color || '#10131F';
  }
}

module.exports = {
  ThumbnailDesignerAgent,
  DESIGN_FAMILIES: FAMILY_IDS.map(id => ({ id, name: FAMILIES[id].name, layoutClass: FAMILIES[id].cls })),
  TOPIC_IDS: TOPIC_PROFILES.map(p => p.id)
};
