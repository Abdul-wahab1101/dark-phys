'use strict';
/**
 * 12 extra thumbnail design families (v10).
 * Loaded by thumbnail-designer-agent.js:  Object.assign(FAMILIES, require('./thumbnail-families-extra').create(helpers))
 *
 * Same contract as the first 12 families: name, cls, side, textSide, palettes, prompt fields, build(c).
 * Everything is SVG over a (graded) background photo. No text is ever requested from the image model.
 */

const TOPIC_FIT = {
  'gaslighting': { 'chat-screen': 3, 'redacted-file': 2, 'evidence-board': 2, 'spotlight-stage': 1.5 },
  'narcissism': { 'spotlight-stage': 3, 'duotone-poster': 2.5, 'redacted-file': 1.5, 'minimal-modern': 1.5 },
  'manipulation': { 'chat-screen': 2.5, 'evidence-board': 3, 'hazard-warning': 2, 'vhs-glitch': 1.5 },
  'emotional-control': { 'duotone-poster': 2.5, 'neon-cyber': 2, 'spotlight-stage': 2, 'minimal-modern': 2 },
  'toxic-relationships': { 'chat-screen': 3, 'hazard-warning': 2.5, 'torn-paper': 2, 'duotone-poster': 2 },
  'workplace': { 'big-number': 2.5, 'minimal-modern': 3, 'torn-paper': 2, 'redacted-file': 2 },
  'body-language': { 'viewfinder': 3.5, 'big-number': 2, 'minimal-modern': 2, 'evidence-board': 2 },
  'persuasion': { 'big-number': 3, 'neon-cyber': 2, 'minimal-modern': 2.5, 'hazard-warning': 1.5 },
  'social-influence': { 'vhs-glitch': 3, 'neon-cyber': 2.5, 'viewfinder': 2, 'big-number': 2 },
  'cognitive-bias': { 'big-number': 3, 'redacted-file': 2, 'neon-cyber': 2.5, 'torn-paper': 2 },
  'human-behavior': { 'viewfinder': 2.5, 'evidence-board': 2, 'minimal-modern': 2.5, 'torn-paper': 2, 'big-number': 2 }
};

function create(h) {
  const { poly, jaggedPath, dotsPattern, esc } = h;
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const pad2 = n => String(n).padStart(2, '0');
  const fontAttr = (f, extra = '') => 'font-family="' + f.stack + '" font-weight="' + f.weight + '"' + extra;

  const F = {};

  /* 1 ---------------------------------------------------------------- */
  F['evidence-board'] = {
    name: 'Case File Evidence Board', cls: 'evidence', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'fear'],
    palettes: [
      { a: '#E63946', b: '#F4E3B2', dark: '#14110F', light: '#FFFFFF' },
      { a: '#FF5A36', b: '#EAD9A8', dark: '#0F1012', light: '#FFFFFF' }
    ],
    promptStyle: 'Moody investigative photograph in a dim room, documentary realism, muted colours, subject looking directly at the camera',
    camera: 'eye-level medium shot, 50mm lens, slightly desaturated', light: 'single warm desk-lamp key with cool fill, soft shadows',
    comp: 'subject on the right third, left half dark and simple, focal point at the eyes',
    build(c) {
      const { p, rng, lines, eyebrow } = c;
      const caseNo = 100 + Math.floor(rng() * 899);
      return {
        grade: { brightness: 0.88, saturation: 0.72, a: 1.12, b: -8 },
        defs: '<linearGradient id="evL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".96"/><stop offset=".55" stop-color="' + p.dark + '" stop-opacity=".8"/><stop offset=".78" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#evL)"/>' +
          '<ellipse cx="930" cy="300" rx="210" ry="245" transform="rotate(-6 930 300)" fill="none" stroke="#000" stroke-width="16" stroke-opacity=".6"/>' +
          '<ellipse cx="930" cy="300" rx="210" ry="245" transform="rotate(-6 930 300)" fill="none" stroke="' + p.a + '" stroke-width="9" stroke-dasharray="520 30 260 22"/>' +
          '<path d="M690 70 Q 800 150 925 62" stroke="' + p.a + '" stroke-width="3" fill="none" stroke-opacity=".9"/>' +
          '<circle cx="690" cy="70" r="9" fill="' + p.a + '" stroke="#000" stroke-width="3"/><circle cx="925" cy="62" r="9" fill="' + p.a + '" stroke="#000" stroke-width="3"/>' +
          '<g transform="rotate(-8 1140 640)"><rect x="1030" y="610" width="200" height="52" fill="none" stroke="' + p.a + '" stroke-width="5" rx="4"/>' +
          '<text x="1130" y="647" text-anchor="middle" ' + fontAttr(c.fonts.impact, ' font-size="34" letter-spacing="5"') + ' fill="' + p.a + '">EVIDENCE</text></g>',
        text: [{ lines, font: 'impact', box: { x: 60, y: 175, w: 640, h: 420 }, ha: 'start', va: 'middle', maxSize: 150, minSize: 70, lh: 1.0, ls: 0.01, fills: [p.light, p.a, p.light], stroke: p.dark, strokeW: 6, shadow: 'hard', shadowColor: '#000', shadowOff: [6, 6] }],
        decorate(info) {
          const b = info.bbox;
          const label = 'CASE FILE No. ' + caseNo + '  /  ' + eyebrow;
          const w = Math.min(640, c.tw(label, 22, 2) + 44);
          const y = Math.max(34, b.y - 78);
          return '<g transform="rotate(-2.5 ' + b.x + ' ' + y + ')"><rect x="' + b.x + '" y="' + y + '" width="' + w + '" height="50" fill="' + p.b + '" stroke="#000" stroke-width="3"/>' +
            '<rect x="' + (b.x + w / 2 - 38) + '" y="' + (y - 14) + '" width="76" height="26" fill="#fff" fill-opacity=".55" transform="rotate(3 ' + (b.x + w / 2) + ' ' + y + ')"/>' +
            '<text x="' + (b.x + 20) + '" y="' + (y + 34) + '" ' + fontAttr(c.fonts.inter, ' font-size="22" letter-spacing="2"') + ' fill="' + p.dark + '">' + esc(label) + '</text></g>';
        }
      };
    }
  };

  /* 2 ---------------------------------------------------------------- */
  F['neon-cyber'] = {
    name: 'Neon Cyber Mind', cls: 'neon', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['curiosity', 'power'],
    palettes: [
      { a: '#00F0FF', b: '#FF2BD6', dark: '#07041A', light: '#F4F0FF' },
      { a: '#7DFF6B', b: '#B14BFF', dark: '#050A12', light: '#F2FFF4' }
    ],
    promptStyle: 'Futuristic night-city portrait with neon rim lighting, cyberpunk atmosphere, wet reflections, photorealistic',
    camera: 'medium close-up, 35mm lens, shallow depth of field', light: 'magenta and cyan neon rim lights from both sides, deep blue shadows',
    comp: 'subject centred in the upper two-thirds, lower third dark and quiet',
    build(c) {
      const { p, lines, eyebrow } = c;
      let grid = '';
      for (let i = 0; i < 9; i++) { const y = 470 + Math.pow(i / 8, 1.7) * 250; grid += '<line x1="0" y1="' + y.toFixed(0) + '" x2="1280" y2="' + y.toFixed(0) + '"/>'; }
      for (let i = -9; i <= 9; i++) grid += '<line x1="640" y1="450" x2="' + (640 + i * 190) + '" y2="720"/>';
      return {
        grade: { brightness: 0.82, saturation: 1.3, a: 1.2, b: -14 },
        defs: '<linearGradient id="nBot" x1="0" y1="0" x2="0" y2="1"><stop offset=".4" stop-color="' + p.dark + '" stop-opacity="0"/><stop offset="1" stop-color="' + p.dark + '" stop-opacity=".95"/></linearGradient>' +
          '<linearGradient id="nSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.b + '" stop-opacity=".35"/><stop offset=".25" stop-color="' + p.b + '" stop-opacity="0"/><stop offset=".75" stop-color="' + p.a + '" stop-opacity="0"/><stop offset="1" stop-color="' + p.a + '" stop-opacity=".35"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#nSide)"/><rect width="1280" height="720" fill="url(#nBot)"/>' +
          '<g stroke="' + p.a + '" stroke-width="1.6" stroke-opacity=".38">' + grid + '</g>' +
          '<rect x="22" y="22" width="1236" height="676" rx="18" fill="none" stroke="' + p.a + '" stroke-width="5" filter="url(#glow)"/>' +
          '<path d="M22 120 V40 Q22 22 40 22 H190" fill="none" stroke="' + p.b + '" stroke-width="7" filter="url(#glow)"/>' +
          '<path d="M1258 600 V680 Q1258 698 1240 698 H1090" fill="none" stroke="' + p.b + '" stroke-width="7" filter="url(#glow)"/>',
        text: [{ lines, font: 'impact', box: { x: 90, y: 410, w: 1100, h: 225 }, ha: 'middle', va: 'bottom', maxSize: 150, minSize: 74, lh: 0.98, ls: 0.02, fills: [p.light, p.a], shadow: 'glow', shadowColor: p.b }],
        decorate(info) {
          const w = c.tw(eyebrow, 22, 5) + 40;
          const x = 640 - w / 2;
          return '<rect x="' + x + '" y="52" width="' + w + '" height="44" rx="22" fill="' + p.dark + '" fill-opacity=".8" stroke="' + p.a + '" stroke-width="3"/>' +
            '<text x="640" y="82" text-anchor="middle" ' + fontAttr(c.fonts.inter, ' font-size="22" letter-spacing="5"') + ' fill="' + p.a + '">' + esc(eyebrow) + '</text>';
        }
      };
    }
  };

  /* 3 ---------------------------------------------------------------- */
  F['redacted-file'] = {
    name: 'Classified Redacted File', cls: 'redacted', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['fear', 'curiosity'],
    palettes: [
      { a: '#FF3B30', b: '#D9D2BE', dark: '#0A0A0A', light: '#FFFFFF' },
      { a: '#FFD400', b: '#CFCFCF', dark: '#080808', light: '#FFFFFF' }
    ],
    promptStyle: 'Desaturated cold documentary photograph, surveillance-file mood, grainy, subject glancing sideways',
    camera: 'medium shot, slightly high angle, 50mm lens', light: 'flat overcast light with cold tones and deep shadows',
    comp: 'subject on the right third, left half simple and dark',
    build(c) {
      const { p, rng, lines, eyebrow } = c;
      let fake = '';
      for (let i = 0; i < 6; i++) fake += '<rect x="60" y="' + (70 + i * 17) + '" width="' + Math.round(180 + rng() * 380) + '" height="9" fill="' + p.b + '" fill-opacity=".38"/>';
      for (let i = 0; i < 3; i++) fake += '<rect x="60" y="' + (640 + i * 17) + '" width="' + Math.round(220 + rng() * 360) + '" height="9" fill="' + p.b + '" fill-opacity=".3"/>';
      return {
        grade: { brightness: 0.86, saturation: 0.3, a: 1.2, b: -14 },
        defs: '<linearGradient id="rdL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".88"/><stop offset=".55" stop-color="#000" stop-opacity=".6"/><stop offset=".8" stop-color="#000" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#rdL)"/>' + fake +
          '<g transform="rotate(-5 1080 100)"><rect x="900" y="62" width="320" height="64" fill="none" stroke="' + p.a + '" stroke-width="6"/><rect x="908" y="70" width="304" height="48" fill="none" stroke="' + p.a + '" stroke-width="2"/>' +
          '<text x="1060" y="108" text-anchor="middle" ' + fontAttr(c.fonts.impact, ' font-size="44" letter-spacing="8"') + ' fill="' + p.a + '">CLASSIFIED</text></g>',
        text: [{ lines, font: 'impact', box: { x: 70, y: 190, w: 640, h: 360 }, ha: 'start', va: 'middle', maxSize: 138, minSize: 66, lh: 1.14, ls: 0.01, fills: [p.light, p.light, p.a] }],
        decorateBeforeText: true,
        decorate(info) {
          const bars = info.blocks[0].lineBoxes.map((lb, i) => '<rect x="' + (lb.x - 16) + '" y="' + (lb.y - 8) + '" width="' + (lb.w + 32) + '" height="' + (lb.h + 16) + '" fill="#000"' + (i === info.blocks[0].lineBoxes.length - 1 ? ' stroke="' + p.a + '" stroke-width="3"' : '') + '/>').join('');
          const b = info.bbox;
          return bars + '<text x="' + b.x + '" y="' + Math.max(40, b.y - 30) + '" ' + fontAttr(c.fonts.inter, ' font-size="22" letter-spacing="6"') + ' fill="' + p.b + '">' + esc('FILE // ' + eyebrow) + '</text>';
        }
      };
    }
  };

  /* 4 ---------------------------------------------------------------- */
  F['hazard-warning'] = {
    name: 'Hazard Warning Sign', cls: 'hazard', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['fear', 'anger'],
    palettes: [
      { a: '#FFD400', b: '#111111', dark: '#0B0B0B', light: '#FFFFFF' },
      { a: '#FF6A00', b: '#111111', dark: '#0A0A0A', light: '#FFFFFF' }
    ],
    promptStyle: 'High-contrast dramatic portrait photograph with a tense, alarmed expression, sharp detail, slightly gritty',
    camera: 'close medium shot, 35mm lens, slight low angle', light: 'hard frontal flash-style key light with strong shadows behind',
    comp: 'subject centred in the upper two-thirds, lower third dark and quiet',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { brightness: 0.95, saturation: 1.15, a: 1.25, b: -16 },
        defs: '<pattern id="hz" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="28" height="56" fill="' + p.a + '"/><rect x="28" width="28" height="56" fill="' + p.b + '"/></pattern>' +
          '<linearGradient id="hzBot" x1="0" y1="0" x2="0" y2="1"><stop offset=".42" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".93"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#hzBot)"/>' +
          '<rect x="0" y="0" width="1280" height="46" fill="url(#hz)"/><rect x="0" y="674" width="1280" height="46" fill="url(#hz)"/>' +
          '<rect x="0" y="46" width="1280" height="5" fill="#000"/><rect x="0" y="669" width="1280" height="5" fill="#000"/>' +
          '<g transform="translate(1130 150)"><path d="M0 -78 L84 66 H-84 Z" fill="' + p.a + '" stroke="#000" stroke-width="10" stroke-linejoin="round"/>' +
          '<rect x="-7" y="-30" width="14" height="52" rx="5" fill="#000"/><circle cx="0" cy="40" r="8" fill="#000"/></g>',
        text: [{ lines, font: 'impact', box: { x: 90, y: 370, w: 1100, h: 220 }, ha: 'middle', va: 'bottom', maxSize: 150, minSize: 74, lh: 0.98, ls: 0.015, fills: [p.a, p.light], stroke: '#000', strokeW: 9, shadow: 'hard', shadowColor: '#000', shadowOff: [6, 6] }],
        decorate(info) {
          const label = 'WARNING  ' + eyebrow;
          const w = c.tw(label, 24, 3) + 40;
          return '<rect x="50" y="76" width="' + w + '" height="48" fill="' + p.a + '" stroke="#000" stroke-width="5"/>' +
            '<text x="70" y="110" ' + fontAttr(c.fonts.oswald, ' font-size="26" letter-spacing="3"') + ' fill="#000">' + esc(label) + '</text>';
        }
      };
    }
  };

  /* 5 ---------------------------------------------------------------- */
  F['duotone-poster'] = {
    name: 'Duotone Poster', cls: 'duotone', side: 'center', textSide: 'top', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['power', 'pain'],
    palettes: [
      { a: '#FFE14A', b: '#E5233D', dark: '#1A0508', light: '#FFFFFF' },
      { a: '#7DF9FF', b: '#3A2BFF', dark: '#050824', light: '#FFFFFF' },
      { a: '#FF9ECF', b: '#6A1BFF', dark: '#14052E', light: '#FFFFFF' }
    ],
    promptStyle: 'Strong graphic portrait photograph with a clean silhouette and high tonal contrast, simple plain background, editorial poster look',
    camera: 'chest-up portrait, 85mm lens, eye-level', light: 'hard side light with a crisp shadow edge',
    comp: 'subject centred in the lower two-thirds, upper third plain and quiet',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { gray: true, tint: p.b, brightness: 1.0, saturation: 1.0, a: 1.35, b: -34 },
        defs: '<linearGradient id="dtTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".93"/><stop offset=".5" stop-color="' + p.dark + '" stop-opacity=".55"/><stop offset=".72" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="' + p.b + '" fill-opacity=".28"/><rect width="1280" height="720" fill="url(#dtTop)"/>' +
          '<rect x="0" y="696" width="1280" height="24" fill="' + p.a + '"/>' +
          '<circle cx="1160" cy="600" r="62" fill="' + p.a + '" stroke="' + p.dark + '" stroke-width="6"/>' +
          '<path d="M1135 600 H1185 M1165 578 L1187 600 L1165 622" stroke="' + p.dark + '" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
        text: [{ lines, font: 'impact', box: { x: 70, y: 70, w: 1140, h: 250 }, ha: 'middle', va: 'top', maxSize: 160, minSize: 76, lh: 0.98, ls: 0.012, fills: [p.light, p.a], stroke: p.dark, strokeW: 6, shadow: 'hard', shadowColor: p.b, shadowOff: [7, 7] }],
        decorate(info) {
          const b = info.bbox; const cx = b.x + b.w / 2;
          return '<rect x="' + (cx - 90) + '" y="' + (b.y + b.h + 20) + '" width="180" height="9" fill="' + p.a + '"/>' +
            '<text x="' + cx + '" y="' + (b.y + b.h + 62) + '" text-anchor="middle" ' + fontAttr(c.fonts.inter, ' font-size="24" letter-spacing="8"') + ' fill="' + p.light + '">' + esc(eyebrow) + '</text>';
        }
      };
    }
  };

  /* 6 ---------------------------------------------------------------- */
  F['chat-screen'] = {
    name: 'Chat Bubble Gaslight', cls: 'chat', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['pain', 'anger'],
    palettes: [
      { a: '#34C759', b: '#0A84FF', dark: '#0C0F1A', light: '#FFFFFF' },
      { a: '#FFD60A', b: '#FF375F', dark: '#120B14', light: '#FFFFFF' }
    ],
    promptStyle: 'Intimate documentary photograph of a person looking sad or uneasy at a phone in a dim room, natural skin texture, cinematic realism',
    camera: 'medium close-up, 35mm lens, shallow depth of field', light: 'cold phone-screen glow on the face, warm dark room behind',
    comp: 'subject on the right half, left half calm and dark',
    build(c) {
      const { p, rng, lines } = c;
      const phrases = ["You're overreacting.", 'That never happened.', 'Why are you so sensitive?', 'I did it for you.', 'Are you sure about that?', 'You always twist things.'];
      const first = pick(rng, phrases);
      let second = pick(rng, phrases); if (second === first) second = phrases[(phrases.indexOf(first) + 1) % phrases.length];
      const bubble = (x, y, txt, fill, fg, tail) => {
        const size = Math.min(30, 520 / (txt.length * 0.6));
        const w = Math.round(txt.length * size * 0.6 + 48);
        return '<g><rect x="' + x + '" y="' + y + '" width="' + w + '" height="62" rx="31" fill="' + fill + '"/>' +
          '<path d="M' + (tail === 'l' ? x + 10 : x + w - 10) + ' ' + (y + 52) + ' l ' + (tail === 'l' ? -12 : 12) + ' 18 l ' + (tail === 'l' ? 28 : -28) + ' -8 z" fill="' + fill + '"/>' +
          '<text x="' + (x + 24) + '" y="' + (y + 41) + '" ' + fontAttr(c.fonts.inter, ' font-size="' + size.toFixed(1) + '"') + ' fill="' + fg + '">' + esc(txt) + '</text></g>';
      };
      return {
        grade: { brightness: 0.86, saturation: 0.9, a: 1.12, b: -8 },
        defs: '<linearGradient id="chL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".95"/><stop offset=".55" stop-color="' + p.dark + '" stop-opacity=".78"/><stop offset=".78" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#chL)"/>' +
          bubble(50, 60, first, '#2C2C34', '#FFFFFF', 'l') +
          bubble(120, 150, second, p.b, '#FFFFFF', 'r') +
          '<g><rect x="50" y="240" width="118" height="56" rx="28" fill="#2C2C34"/>' +
          '<circle cx="89" cy="268" r="8" fill="#9A9AA5"/><circle cx="109" cy="268" r="8" fill="#B8B8C2"/><circle cx="129" cy="268" r="8" fill="#D8D8E0"/></g>',
        text: [{ lines, font: 'impact', box: { x: 56, y: 345, w: 640, h: 300 }, ha: 'start', va: 'bottom', maxSize: 140, minSize: 68, lh: 1.0, ls: 0.01, fills: [p.light, p.a, p.light], stroke: p.dark, strokeW: 6, shadow: 'hard', shadowColor: '#000', shadowOff: [5, 5] }],
        decorate(info) {
          const b = info.bbox;
          return '<text x="' + (b.x + 4) + '" y="' + (b.y - 16) + '" ' + fontAttr(c.fonts.inter, ' font-size="22"') + ' fill="' + p.a + '">' + esc('Read  ' + (1 + Math.floor(c.rng() * 4)) + ':' + pad2(Math.floor(c.rng() * 60)) + ' AM') + '</text>';
        }
      };
    }
  };

  /* 7 ---------------------------------------------------------------- */
  F['big-number'] = {
    name: 'Giant Number Listicle', cls: 'number', side: 'right', textSide: 'left', legacy: 'editorial-left', maxLines: 2, needsNumber: true,
    emotionFit: ['curiosity', 'power'],
    palettes: [
      { a: '#FFC300', b: '#FF3D5A', dark: '#0D0D12', light: '#FFFFFF' },
      { a: '#3DFFB5', b: '#7B5CFF', dark: '#07120F', light: '#FFFFFF' },
      { a: '#FF8A00', b: '#00B4FF', dark: '#0B0F18', light: '#FFFFFF' }
    ],
    promptStyle: 'Clean expressive portrait photograph, subject with a curious or surprised look, bright and vivid, simple background',
    camera: 'medium shot, 50mm lens, eye-level', light: 'bright soft key light with clean rim separation',
    comp: 'subject on the right half, left half simple and dark for a huge number and headline',
    build(c) {
      const { p, lines } = c;
      const m = String(c.title || '').match(/\b(\d{1,2})\b/);
      const glyph = m ? m[1] : (c.question ? '?' : '!');
      const size = glyph.length > 1 ? 400 : 470;
      return {
        grade: { brightness: 0.98, saturation: 1.2, a: 1.15, b: -10 },
        defs: '<linearGradient id="bnL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".96"/><stop offset=".55" stop-color="' + p.dark + '" stop-opacity=".82"/><stop offset=".78" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#bnL)"/>' +
          '<text x="56" y="420" ' + fontAttr(c.fonts.impact, ' font-size="' + size + '"') + ' fill="' + p.b + '" transform="translate(10 10)">' + esc(glyph) + '</text>' +
          '<text x="56" y="420" ' + fontAttr(c.fonts.impact, ' font-size="' + size + '"') + ' fill="' + p.a + '" stroke="' + p.dark + '" stroke-width="8" stroke-linejoin="round" paint-order="stroke">' + esc(glyph) + '</text>',
        text: [{ lines, font: 'impact', box: { x: 60, y: 455, w: 720, h: 215 }, ha: 'start', va: 'middle', maxSize: 100, minSize: 56, lh: 1.0, ls: 0.01, fills: [p.light, p.a], stroke: p.dark, strokeW: 5, shadow: 'hard', shadowColor: '#000', shadowOff: [4, 4] }],
        decorate() {
          return '<rect x="60" y="436" width="130" height="8" fill="' + p.b + '"/>';
        }
      };
    }
  };

  /* 8 ---------------------------------------------------------------- */
  F['spotlight-stage'] = {
    name: 'Spotlight Stage', cls: 'spotlight', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['power', 'fear'],
    palettes: [
      { a: '#FFE9A8', b: '#C1121F', dark: '#030303', light: '#FFFFFF' },
      { a: '#CDE7FF', b: '#6A5CFF', dark: '#02030A', light: '#FFFFFF' }
    ],
    promptStyle: 'Theatrical portrait of a lone figure in a pool of light on a dark stage, dramatic and isolated, photorealistic',
    camera: 'wide-to-medium shot from slightly below, 40mm lens', light: 'single overhead spotlight with haze, everything else near black',
    comp: 'subject centred under the beam in the upper two-thirds, bottom dark and empty',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { brightness: 0.8, saturation: 0.85, a: 1.2, b: -18 },
        defs: '<radialGradient id="spV" cx=".5" cy=".4" r=".62"><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".94"/></radialGradient>' +
          '<linearGradient id="spBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.a + '" stop-opacity=".42"/><stop offset="1" stop-color="' + p.a + '" stop-opacity=".02"/></linearGradient>' +
          '<linearGradient id="spBot" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".92"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#spV)"/>' +
          '<g filter="url(#blur8)"><polygon points="560,0 720,0 1010,700 270,700" fill="url(#spBeam)"/></g>' +
          '<ellipse cx="640" cy="640" rx="320" ry="38" fill="' + p.a + '" fill-opacity=".2" filter="url(#blur8)"/>' +
          '<rect width="1280" height="720" fill="url(#spBot)"/>',
        text: [{ lines, font: 'montserrat', box: { x: 100, y: 470, w: 1080, h: 170 }, ha: 'middle', va: 'bottom', maxSize: 100, minSize: 60, lh: 1.02, ls: 0.045, fills: [p.light, p.a], shadow: 'soft' }],
        decorate(info) {
          const b = info.bbox; const cx = b.x + b.w / 2;
          return '<text x="' + cx + '" y="' + (b.y - 22) + '" text-anchor="middle" ' + fontAttr(c.fonts.inter, ' font-size="22" letter-spacing="10"') + ' fill="' + p.b + '">' + esc(eyebrow) + '</text>' +
            '<rect x="' + (cx - 45) + '" y="' + (b.y + b.h + 20) + '" width="90" height="4" fill="' + p.b + '"/>';
        }
      };
    }
  };

  /* 9 ---------------------------------------------------------------- */
  F['torn-paper'] = {
    name: 'Torn Paper Headline', cls: 'torn', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['pain', 'curiosity'],
    palettes: [
      { a: '#C1121F', b: '#F2E8CF', dark: '#171717', light: '#FFFFFF' },
      { a: '#1252B8', b: '#F5EEDC', dark: '#14161C', light: '#FFFFFF' }
    ],
    promptStyle: 'Natural documentary portrait photograph, honest emotion, soft natural light, slightly muted colours',
    camera: 'eye-level portrait, 50mm lens', light: 'soft window light with gentle shadows',
    comp: 'subject centred in the upper 60 percent of the frame, bottom 35 percent calm and plain',
    build(c) {
      const { p, rng, lines, eyebrow } = c;
      let d = 'M0 ' + 470; let y0 = 470;
      for (let x = 24; x <= 1280; x += 24) { y0 = 470 + (rng() - 0.5) * 30; d += ' L' + x + ' ' + Math.round(y0); }
      d += ' L1280 720 L0 720 Z';
      return {
        grade: { brightness: 0.95, saturation: 0.9, a: 1.08, b: -4 },
        defs: dotsPattern('tpDots', 14, 1.4, '#000', 0.08),
        under: '<g transform="translate(0 -8)" opacity=".5" filter="url(#blur8)"><path d="' + d + '" fill="#000"/></g>' +
          '<path d="' + d + '" fill="' + p.b + '"/><path d="' + d + '" fill="url(#tpDots)"/>' +
          '<rect x="140" y="428" width="120" height="40" fill="#fff" fill-opacity=".55" transform="rotate(-9 200 448)"/>' +
          '<rect x="1020" y="432" width="120" height="40" fill="#fff" fill-opacity=".55" transform="rotate(8 1080 452)"/>',
        text: [{ lines, font: 'impact', box: { x: 80, y: 492, w: 1120, h: 170 }, ha: 'middle', va: 'middle', maxSize: 120, minSize: 62, lh: 1.0, ls: 0.01, fills: [p.dark, p.a] }],
        decorate(info) {
          const b = info.bbox;
          return '<text x="' + (b.x + b.w / 2) + '" y="704" text-anchor="middle" ' + fontAttr(c.fonts.inter, ' font-size="20" letter-spacing="7"') + ' fill="' + p.dark + '" fill-opacity=".6">' + esc(eyebrow) + '</text>';
        }
      };
    }
  };

  /* 10 --------------------------------------------------------------- */
  F['viewfinder'] = {
    name: 'Surveillance Viewfinder', cls: 'viewfinder', side: 'left', textSide: 'right', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'fear'],
    palettes: [
      { a: '#FF2D2D', b: '#FFFFFF', dark: '#05070A', light: '#FFFFFF' },
      { a: '#2DFF88', b: '#FFFFFF', dark: '#04080A', light: '#FFFFFF' }
    ],
    promptStyle: 'Candid observational photograph of a person caught mid-moment, body language clearly readable, naturalistic and slightly cold in colour',
    camera: 'medium shot from a distance, 85mm telephoto compression', light: 'flat natural light, slightly desaturated',
    comp: 'subject on the left third of the frame, right half calm and dark for a headline',
    build(c) {
      const { p, rng, lines, eyebrow } = c;
      const tc = pad2(Math.floor(rng() * 24)) + ':' + pad2(Math.floor(rng() * 60)) + ':' + pad2(Math.floor(rng() * 60)) + ':' + pad2(Math.floor(rng() * 25));
      const br = (x, y, sx, sy) => '<path d="M' + x + ' ' + (y + sy * 80) + ' V' + y + ' H' + (x + sx * 80) + '" fill="none" stroke="#fff" stroke-width="6" stroke-opacity=".9"/>';
      return {
        grade: { brightness: 0.9, saturation: 0.75, a: 1.12, b: -8 },
        defs: '<linearGradient id="vfR" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".95"/><stop offset=".55" stop-color="' + p.dark + '" stop-opacity=".78"/><stop offset=".8" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#vfR)"/>' +
          br(40, 40, 1, 1) + br(1240, 40, -1, 1) + br(40, 680, 1, -1) + br(1240, 680, -1, -1) +
          '<g stroke="' + p.b + '" stroke-opacity=".85" fill="none"><circle cx="380" cy="320" r="130" stroke-width="3"/><circle cx="380" cy="320" r="8" fill="' + p.a + '" stroke="none"/>' +
          '<path d="M380 160 V210 M380 430 V480 M220 320 H270 M490 320 H540" stroke-width="3"/></g>' +
          '<circle cx="82" cy="86" r="13" fill="' + p.a + '" filter="url(#glow)"/>' +
          '<text x="108" y="96" ' + fontAttr(c.fonts.inter, ' font-size="30" letter-spacing="4"') + ' fill="#fff">REC</text>' +
          '<text x="1200" y="96" text-anchor="end" ' + fontAttr(c.fonts.inter, ' font-size="26" letter-spacing="3"') + ' fill="#fff">' + tc + '</text>',
        text: [{ lines, font: 'impact', box: { x: 600, y: 170, w: 630, h: 400 }, ha: 'end', va: 'middle', maxSize: 140, minSize: 66, lh: 1.0, ls: 0.01, fills: [p.light, p.a, p.light], stroke: p.dark, strokeW: 5, shadow: 'hard', shadowColor: '#000', shadowOff: [5, 5] }],
        decorate(info) {
          const b = info.bbox;
          return '<text x="' + (b.x + b.w) + '" y="' + Math.max(150, b.y - 24) + '" text-anchor="end" ' + fontAttr(c.fonts.inter, ' font-size="22" letter-spacing="6"') + ' fill="' + p.a + '">' + esc('OBSERVING  /  ' + eyebrow) + '</text>';
        }
      };
    }
  };

  /* 11 --------------------------------------------------------------- */
  F['minimal-modern'] = {
    name: 'Minimal Modern Type', cls: 'minimal', side: 'left', textSide: 'right', legacy: 'editorial-left', maxLines: 3,
    emotionFit: ['curiosity', 'power'],
    palettes: [
      { a: '#7C5CFF', b: '#FF7AB8', dark: '#0B0B14', light: '#FFFFFF' },
      { a: '#2DD4BF', b: '#F5C542', dark: '#08100F', light: '#FFFFFF' },
      { a: '#FF8A5C', b: '#5CA8FF', dark: '#0F0C0B', light: '#FFFFFF' }
    ],
    promptStyle: 'Clean modern editorial portrait photograph, calm confident subject, soft studio look, minimal background, high-end magazine feel',
    camera: 'medium close-up, 85mm lens, eye-level', light: 'soft large key light with gentle gradient background',
    comp: 'subject on the left 45 percent of the frame, right side plain and quiet',
    build(c) {
      const { p, lines, eyebrow } = c;
      return {
        grade: { brightness: 0.96, saturation: 1.0, a: 1.08, b: -6 },
        defs: '<linearGradient id="mmR" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="' + p.dark + '" stop-opacity=".98"/><stop offset=".6" stop-color="' + p.dark + '" stop-opacity=".92"/><stop offset=".78" stop-color="' + p.dark + '" stop-opacity="0"/></linearGradient>' +
          '<linearGradient id="mmAcc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + p.a + '"/><stop offset="1" stop-color="' + p.b + '"/></linearGradient>',
        under: '<rect width="1280" height="720" fill="url(#mmR)"/>' +
          '<rect x="668" y="120" width="8" height="480" rx="4" fill="url(#mmAcc)"/>',
        text: [{ lines, font: 'montserrat', box: { x: 704, y: 190, w: 560, h: 340 }, ha: 'start', va: 'middle', maxSize: 100, minSize: 54, lh: 1.06, ls: 0.0, fills: [p.light, p.light, p.a] }],
        decorate(info) {
          const b = info.bbox; const w = c.tw(eyebrow, 20, 4) + 36;
          return '<rect x="' + b.x + '" y="' + Math.max(40, b.y - 66) + '" width="' + w + '" height="40" rx="20" fill="none" stroke="' + p.a + '" stroke-width="3"/>' +
            '<text x="' + (b.x + 18) + '" y="' + (Math.max(40, b.y - 66) + 27) + '" ' + fontAttr(c.fonts.inter, ' font-size="20" letter-spacing="4"') + ' fill="' + p.a + '">' + esc(eyebrow) + '</text>' +
            '<rect x="' + b.x + '" y="' + (b.y + b.h + 24) + '" width="120" height="8" rx="4" fill="url(#mmAcc)"/>';
        }
      };
    }
  };

  /* 12 --------------------------------------------------------------- */
  F['vhs-glitch'] = {
    name: 'Retro VHS Glitch', cls: 'vhs', side: 'center', textSide: 'bottom', legacy: 'cinematic-bottom', maxLines: 2,
    emotionFit: ['fear', 'curiosity'],
    palettes: [
      { a: '#FF3BD4', b: '#2DE2FF', dark: '#08060F', light: '#FFFFFF' },
      { a: '#FFE14A', b: '#FF3B3B', dark: '#0A0808', light: '#FFFFFF' }
    ],
    promptStyle: 'Nostalgic analogue-video look portrait, slightly soft focus, film grain, uneasy atmosphere, photorealistic',
    camera: 'medium close-up, 35mm lens, handheld feel', light: 'practical room light with a cool cast and soft glow',
    comp: 'subject centred in the upper two-thirds, bottom third dark and calm',
    build(c) {
      const { p, rng, lines } = c;
      let bars = '';
      for (let i = 0; i < 7; i++) bars += '<rect x="' + Math.round(rng() * 200 - 60) + '" y="' + Math.round(40 + rng() * 520) + '" width="' + Math.round(500 + rng() * 800) + '" height="' + Math.round(5 + rng() * 11) + '" fill="#fff" fill-opacity="' + (0.1 + rng() * 0.14).toFixed(2) + '"/>';
      const sp = pad2(Math.floor(rng() * 3)) + ':' + pad2(Math.floor(rng() * 60)) + ':' + pad2(Math.floor(rng() * 60));
      return {
        grade: { brightness: 0.9, saturation: 1.15, a: 1.12, b: -10 },
        defs: '<pattern id="vhsLn" width="4" height="5" patternUnits="userSpaceOnUse"><rect width="4" height="1.6" fill="#000" fill-opacity=".28"/></pattern>' +
          '<linearGradient id="vhsBot" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".9"/></linearGradient>',
        under: '<rect x="0" y="0" width="1280" height="720" fill="' + p.a + '" fill-opacity=".07"/>' +
          '<rect x="0" y="0" width="22" height="720" fill="' + p.a + '" fill-opacity=".35"/><rect x="1258" y="0" width="22" height="720" fill="' + p.b + '" fill-opacity=".35"/>' +
          bars + '<rect width="1280" height="720" fill="url(#vhsBot)"/><rect width="1280" height="720" fill="url(#vhsLn)"/>' +
          '<polygon points="64,66 64,106 98,86" fill="#fff"/>' +
          '<text x="116" y="98" ' + fontAttr(c.fonts.inter, ' font-size="34" letter-spacing="4"') + ' fill="#fff">PLAY</text>' +
          '<text x="640" y="98" text-anchor="middle" ' + fontAttr(c.fonts.inter, ' font-size="30" letter-spacing="3"') + ' fill="#fff">SP ' + sp + '</text>',
        text: [{ lines, font: 'impact', box: { x: 70, y: 360, w: 1100, h: 220 }, ha: 'start', va: 'bottom', maxSize: 150, minSize: 74, lh: 0.98, ls: 0.015, fills: [p.light, p.b], shadow: 'glitch', shadowColor: p.a, glitch: [p.a, p.b] }],
        decorate() { return ''; }
      };
    }
  };

  return F;
}

module.exports = { create, TOPIC_FIT };
