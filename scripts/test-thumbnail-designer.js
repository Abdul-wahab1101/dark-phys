/**
 * Thumbnail designer test.
 *   node scripts/test-thumbnail-designer.js
 * - Always: loads module, prints font resolution, runs design planning for several topics,
 *   renders all design families on SYNTHETIC placeholder backgrounds (NOT AI images) to test layout.
 * - If CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set: runs a REAL end-to-end generation (3 FLUX images).
 * - Otherwise: runs the local-footage fallback if footage exists (or generates tiny test footage with ffmpeg).
 * Output goes to uploads/thumbnails/test-run-<timestamp>/ (contact sheet: _contact-sheet.jpg)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { spawnSync } = require('child_process');
const { ThumbnailDesignerAgent, DESIGN_FAMILIES } = require('../agents/thumbnail-designer-agent');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

async function placeholderBackground(file, i) {
  const hues = [['#2b1d3a', '#7a3b4a'], ['#10243a', '#2f6f7a'], ['#2a2a2a', '#8a6a3a'], ['#1b1030', '#4a3a8a']];
  const [c1, c2] = hues[i % hues.length];
  const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <radialGradient id="s"><stop offset="0" stop-color="#e2b79a"/><stop offset="1" stop-color="#b98466"/></radialGradient></defs>
    <rect width="1280" height="720" fill="url(#g)"/>
    <ellipse cx="900" cy="640" rx="300" ry="250" fill="#20242c"/>
    <ellipse cx="900" cy="330" rx="150" ry="195" fill="url(#s)"/>
    <ellipse cx="850" cy="300" rx="22" ry="12" fill="#222"/><ellipse cx="950" cy="300" rx="22" ry="12" fill="#222"/>
    <rect x="860" y="400" width="80" height="10" rx="5" fill="#8a4a4a"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

(async () => {
  const outDir = path.join(__dirname, '..', 'uploads', 'thumbnails', 'test-run-' + stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const agent = new ThumbnailDesignerAgent(null, {});
  await agent.initialize();
  ok(DESIGN_FAMILIES.length >= 12, `design families available: ${DESIGN_FAMILIES.length}`);
  console.log('Fonts:', JSON.stringify(agent.getFontReport(), null, 1));
  // Token-only Cloudflare configuration must use local Sharp/footage fallback without throwing.
  const oldCfToken=process.env.CLOUDFLARE_API_TOKEN, oldCfAccount=process.env.CLOUDFLARE_ACCOUNT_ID;
  const oldWorkerUrl=process.env.CLOUDFLARE_WORKER_URL, oldWorkerToken=process.env.CLOUDFLARE_WORKER_TOKEN;
  const oldLocal=agent.generateABVariantsLocal, oldCf=agent.generateCloudflareVariants;
  try {
    process.env.CLOUDFLARE_API_TOKEN='token-only-test'; delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_WORKER_URL; delete process.env.CLOUDFLARE_WORKER_TOKEN;
    agent.generateABVariantsLocal=async()=>[{provider:'local-sharp'}];
    let cfCalled=false; agent.generateCloudflareVariants=async()=>{cfCalled=true;return[];};
    const localOnly=await agent.generateABVariants({title:'Fallback test'},{});
    ok(!cfCalled&&localOnly[0].provider==='local-footage-fallback','token-only Cloudflare safely selects local thumbnail fallback');
    process.env.CLOUDFLARE_WORKER_URL='https://worker.example/run';process.env.CLOUDFLARE_WORKER_TOKEN='worker-token';
    agent.generateCloudflareVariants=async()=>{cfCalled=true;return[{provider:'cloudflare-worker'}];};
    const workerMode=await agent.generateABVariants({title:'Worker test'},{});
    ok(cfCalled&&workerMode[0].provider==='cloudflare-worker','Worker URL + token activates optional Cloudflare route without Account ID');
  } finally {
    agent.generateABVariantsLocal=oldLocal;agent.generateCloudflareVariants=oldCf;
    for(const [key,value] of [['CLOUDFLARE_API_TOKEN',oldCfToken],['CLOUDFLARE_ACCOUNT_ID',oldCfAccount],['CLOUDFLARE_WORKER_URL',oldWorkerUrl],['CLOUDFLARE_WORKER_TOKEN',oldWorkerToken]]) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
  }

  // 0) Regression checks for candidate rejection, title curiosity gap and mobile overlays.
  const originalVisionReview = agent.inspectThumbnailVisual;
  agent.inspectThumbnailVisual = async () => ({ available: false, passed: false, score: 0, concerns: [] });
  const validChecks = { hardFailure: false, decodes: true, correctDimensions: true, underTwoMB: true, textFit: true, contrastOk: true, readableAtSmallSize: true, notBlank: true, contrastRatio: 8, minFontSize: 110, pixelStdev: 48 };
  const goodCandidate = {
    path: 'not-read-by-stubbed-review.jpg', hook: 'WHO PULLS YOUR STRINGS?',
    sourceTitle: '7 Signs You Are Being Gaslighted',
    layout: { blockBounds: [{ x: 90, y: 160, w: 440, h: 180 }] },
    qualityChecks: validChecks
  };
  const goodReview = await agent.scoreThumbnailCandidate(goodCandidate);
  ok(goodReview.passed && goodReview.mobileSafeZone, 'strong curiosity hook and mobile-safe placement pass');
  const weakMetricsReview = await agent.scoreThumbnailCandidate({ ...goodCandidate, qualityChecks: { ...validChecks, contrastRatio: 3.1, minFontSize: 56, pixelStdev: 13 } });
  ok(goodReview.score > weakMetricsReview.score, 'heuristic comparison ranks stronger contrast, larger type and clearer image detail higher');
  ok(goodReview.score < 90, 'heuristic-only scores stay below the AI-visual-review score range');
  const repeatedCandidate = { ...goodCandidate, hook: 'SIGNS BEING GASLIGHTED' };
  const repeatedReview = await agent.scoreThumbnailCandidate(repeatedCandidate);
  ok(!repeatedReview.passed && repeatedReview.titleOverlap > 0.8, 'headline that repeats the title is automatically rejected');
  const unsafeCandidate = { ...goodCandidate, layout: { blockBounds: [{ x: 1080, y: 635, w: 170, h: 65 }] } };
  const unsafeReview = await agent.scoreThumbnailCandidate(unsafeCandidate);
  ok(!unsafeReview.passed && !unsafeReview.mobileSafeZone, 'bottom-right YouTube timestamp safe-zone collision is rejected');
  const missingBoundsReview = await agent.scoreThumbnailCandidate({ ...goodCandidate, layout: { blockBounds: [] } });
  ok(!missingBoundsReview.passed && !missingBoundsReview.mobileSafeZone, 'missing layout bounds cannot bypass mobile safe-zone checks');
  agent.inspectThumbnailVisual = originalVisionReview;

  // Verify Cloudflare's actual image-review request/response contract without using credentials.
  const originalFetch = global.fetch;
  const oldToken = process.env.CLOUDFLARE_API_TOKEN;
  const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  let visionRequest = null;
  const visionTestImage = path.join(outDir, 'vision-request-test.png');
  await placeholderBackground(visionTestImage, 0);
  try {
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    global.fetch = async (url, options) => {
      visionRequest = { url: String(url), body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ result: { response: JSON.stringify({ score: 91, passed: true, subjectQuality: 9, clutter: 1, focalPoint: 9, textReadability: 9, composition: 9, curiosity: 9, concerns: [] }) } }) };
    };
    const visionReview = await agent.inspectThumbnailVisual(visionTestImage, { hook: 'WHO PULLS YOUR STRINGS?', sourceTitle: 'Why people manipulate you', designFamily: 'test' });
    ok(visionReview.available && visionReview.passed && visionReview.score === 91, 'Cloudflare Vision response is parsed into a visual quality review');
    ok(visionRequest?.url.includes('@cf/meta/llama-3.2-11b-vision-instruct') && typeof visionRequest?.body.messages?.[0]?.content === 'string' && visionRequest.body.messages[0].content.includes('strict professional YouTube thumbnail art director') && visionRequest.body.messages[0].content.includes('Video title: Why people manipulate you') && visionRequest.body.image.startsWith('data:image/jpeg;base64,'), 'Cloudflare Vision request includes the actual thumbnail image');
  } finally {
    global.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = oldToken;
    if (oldAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = oldAccount;
    try { fs.unlinkSync(visionTestImage); } catch (_) {}
  }


  // 1) Planning variety across different videos
  const videos = [
    { title: '7 Signs You Are Being Gaslighted', script: 'Gaslighting makes you doubt your memory. Signs of gaslighting include denial, rewriting events and blaming you.' },
    { title: 'How Narcissists Use Charm As A Weapon' },
    { title: 'Body Language Secrets Of Liars', keywords: ['eye contact', 'micro expressions'] },
    { title: 'Why Your Boss Plays Mind Games At Work' },
    { title: 'Confirmation Bias: How Your Brain Fools You' },
    { title: 'The Psychology Of Peer Pressure' }
  ];
  const seenTrios = new Set();
  for (const v of videos) {
    const concept = await agent.generateConcept(v);
    const titleTokens = new Set(String(v.title).toUpperCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const titleOverlap = headline => {
      const words = String(headline).toUpperCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
      return words.length ? words.filter(w => titleTokens.has(w)).length / words.length : 1;
    };
    ok(concept.variantPlans.every(p => p.headline.split(/\s+/).length <= 5 && titleOverlap(p.headline) <= 0.8), `three concise curiosity-gap headlines for "${v.title}"`);
    ok(new Set(concept.variantPlans.map(p => p.headline)).size === 3, 'three different headline hooks');
    const trio = concept.variantPlans.map(p => p.familyId).join('+');
    seenTrios.add(trio);
    console.log(`\n${v.title}\n  topic=${concept.analysis.topicId} emotion=${concept.analysis.emotionalAngle}`);
    concept.variantPlans.forEach(p => console.log(`  ${p.label} | "${p.headline}" (${p.headlineType}) | scene: ${p.scene.subject.slice(0, 60)}...`));
    ok(new Set(concept.variantPlans.map(p => p.familyId)).size === 3, 'three distinct families for: ' + v.title);
    ok(new Set(concept.variantPlans.map(p => p.headline)).size === 3, 'three distinct headlines for: ' + v.title);
    ok(concept.variantPlans.every(p => p.headline.replace(/[^\w ]/g, '') !== v.title.toUpperCase().replace(/[^\w ]/g, '')), 'headline != title');
    ok(concept.variantPlans.every(p => p.headline.split(/\s+/).length <= 5), 'headline <= 5 words');
    ok(new Set(concept.variantPlans.map(p => p.visualStrategy?.id)).size === 3, 'three different visual strategies (close-up / split / conceptual)');
    ok(new Set(concept.variantPlans.map(p => p.familyId)).size === 3, 'three non-repeating design families');
    const prompt = agent.buildImagePrompt(concept, concept.variantPlans[0], 1);
    ok(prompt.length < 2000 && !/\b(text|letters|words|caption|logo|watermark)\b/i.test(prompt.replace(/wordless/gi, '')), 'prompt has no text-generation request, length ' + prompt.length);
  }
  ok(seenTrios.size >= 4, `different videos get different design trios (${seenTrios.size}/${videos.length})`);

  // 2) Render EVERY family on a synthetic placeholder background (layout/typography test only)
  const sheetFiles = [];
  for (let i = 0; i < DESIGN_FAMILIES.length; i++) {
    const fam = DESIGN_FAMILIES[i];
    const bg = path.join(outDir, `.bg_${i}.png`);
    await placeholderBackground(bg, i);
    const headline = ['WHO PULLS YOUR STRINGS?', 'THE QUIET RED FLAGS', 'THEY REWRITE YOUR MEMORY'][i % 3];
    try {
      const composed = await agent.composeCloudflareThumbnail(bg, headline, 'editorial-left', 'test' + i, agent.getTopicProfile({ title: 'manipulation' }), fam.id, { plan: { paletteIdx: i % 2, badge: 'WATCH CLOSELY' }, title: 'test' });
      const dest = path.join(outDir, `family-${String(i + 1).padStart(2, '0')}-${fam.id}.jpg`);
      fs.copyFileSync(composed.path, dest); fs.unlinkSync(composed.path);
      const q = composed.qualityChecks;
      const safeBounds = composed.layout?.blockBounds?.length ? composed.layout.blockBounds : [composed.layout?.textBounds].filter(Boolean);
      const mobileSafe = safeBounds.length > 0 && safeBounds.every(b => {
        const valid = [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1280 && b.y + b.h <= 720;
        return valid && !(b.x + b.w > 1040 && b.y + b.h > 600) && !(b.x + b.w > 1110 && b.y < 120);
      });
      ok(mobileSafe, `${fam.id}: mobile timestamp and top-right overlay safe zones`);
      ok(q.valid, `${fam.id}: ${composed.dimensions.width}x${composed.dimensions.height}, ${(composed.fileSize / 1024).toFixed(0)}KB, fit=${q.textFit}, contrast=${q.contrastRatio}${composed.layout.autoPanelAdded ? ' (auto panel)' : ''}, minFont=${q.minFontSize}, fonts=${composed.layout.fontsUsed.join('/')}` + (q.problems.length ? ' PROBLEMS: ' + q.problems : ''));
      sheetFiles.push(dest);
    } catch (e) { ok(false, `${fam.id}: ${e.message}`); }
    fs.unlinkSync(bg);
  }
  if (sheetFiles.length) {
    const cols = 3, tw = 640, th = 360, rows = Math.ceil(sheetFiles.length / cols);
    const comps = [];
    for (let i = 0; i < sheetFiles.length; i++) comps.push({ input: await sharp(sheetFiles[i]).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th });
    await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(comps).jpeg({ quality: 85 }).toFile(path.join(outDir, '_contact-sheet.jpg'));
    console.log('Contact sheet:', path.join(outDir, '_contact-sheet.jpg'));
  }

  // 3) End-to-end generation
  const hasCf = process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID;
  let tmpWorkspace = null;
  if (!hasCf) {
    const existing = await agent.getFootageSources().catch(() => []);
    if (!existing.length) {
      tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-ws-'));
      const vis = path.join(tmpWorkspace, 'assets', 'visuals'); fs.mkdirSync(vis, { recursive: true });
      const names = ['couple_argument_serious.mp4', 'person_thinking_alone.mp4', 'business_meeting_office.mp4'];
      names.forEach((n, i) => spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=24:duration=3`, '-vf', `hue=h=${i * 90}`, '-pix_fmt', 'yuv420p', path.join(vis, n)]));
      process.env.OPENMONTAGE_WORKSPACE = tmpWorkspace;
      console.log('\nNo Cloudflare credentials and no footage: using synthetic test footage (ffmpeg testsrc2) for the LOCAL fallback test only.');
    } else console.log('\nNo Cloudflare credentials: testing local footage fallback with existing workspace footage.');
  } else console.log('\nCloudflare credentials found: running REAL FLUX generation.');

  try {
    const result = await agent.generateThumbnail({ title: '7 Signs You Are Being Gaslighted', script: 'Gaslighting makes you doubt your memory and your reality.' });
    console.log('mode:', result.generationMode, '| provider:', result.imageProvider);
    result.variants.forEach((v, i) => {
      const exists = fs.existsSync(v.path);
      ok(exists && v.dimensions.width === 1280 && v.dimensions.height === 720 && v.fileSize <= 2 * 1024 * 1024, `variant ${i + 1} ${v.label} "${v.hook}" -> ${v.path} (${(v.fileSize / 1024).toFixed(0)}KB, valid=${v.qualityChecks.valid})`);
      if (exists) fs.copyFileSync(v.path, path.join(outDir, `e2e-variant-${i + 1}.jpg`));
    });
    console.log('diversity:', JSON.stringify(result.qualityChecks.diversity));
    ok(result.qualityChecks.diversity.distinctFamilies === 3, 'three distinct families in end-to-end run');
    ok(new Set(result.variants.map(v => v.layoutClass)).size === 3, 'three distinct composition/layout classes');
    ok(new Set(result.variants.map(v => v.visualStrategyId)).size === 3, 'three distinct visual strategy IDs survive into final output');
    ok(result.variants.every(v => v.reviewPassed), 'only approved candidates survive final quality gate');
    ok(result.variants.every(v => Number.isFinite(v.reviewScore) && v.reviewScore >= 0 && v.reviewScore <= 100), 'every candidate receives a 0-100 quality score');
    if (!result.qualityChecks.visionInspectionAvailable) ok(new Set(result.variants.map(v => v.reviewScore)).size > 1, 'heuristic-only comparison differentiates candidates instead of giving every thumbnail the same score');
    ok(result.comparison.length === 3 && result.recommendedCandidate === result.variants[0].label, 'three-way comparison and best-candidate recommendation');
    ok(result.qualityChecks.mobileSafeZonesChecked === true, 'mobile timestamp safe-zone validation enabled');
  } catch (e) { ok(false, 'end-to-end generation: ' + e.message); }

  console.log(`\nOutput folder: ${outDir}\n${failures ? failures + ' FAILURE(S)' : 'ALL CHECKS PASSED'} (programmatic checks only; look at the images yourself)`);
  process.exit(failures ? 1 : 0);
})();
