'use strict';
const crypto = require('node:crypto');
function slug(s) { return String(s || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'scene'; }
function splitSentences(text) {
  return String(text || '').match(/[^.!?؟۔\n]+[.!?؟۔]?/g)?.map(x => x.trim()).filter(Boolean) || [];
}
function cleanIntent(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function planScenes(input = {}) {
  const title = cleanIntent(input.title);
  if (!title) throw new Error('title is required');
  const beats = Array.isArray(input.beats) ? input.beats : [];
  if (!beats.length) throw new Error('beats must contain at least one approved narrative beat');
  const scenes = [];
  let previousShot = '', previousMovement = '';
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const beat = beats[beatIndex];
    const narration = cleanIntent(beat.narration);
    if (!narration) throw new Error('Each beat needs narration');
    const sentences = splitSentences(narration);
    const sentenceIntents = Array.isArray(beat.visualIntents) ? beat.visualIntents : [];
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
      const sentence = sentences[sentenceIndex];
      const intent = sentenceIntents[sentenceIndex] || {};
      const visual = cleanIntent(intent.visual || intent.meaning || beat.visual || beat.description);
      const footageQuery = cleanIntent(intent.footageQuery || beat.footageQuery || visual || title);
      if (!footageQuery) throw new Error('Sentence ' + (sentenceIndex + 1) + ' in beat ' + (beatIndex + 1) + ' needs a visual intent or footageQuery');
      const estimated = Math.max(1.5, wordsPerSecond(sentence) / 2.6);
      const duration = Math.min(4, Math.max(1.5, Number(intent.durationSeconds) || estimated));
      const shotTypes = ['wide', 'medium', 'detail', 'tracking', 'macro', 'over-shoulder'];
      const movements = ['slow-push', 'lateral-pan', 'locked-off', 'tracking', 'tilt', 'rack-focus'];
      let shotType = cleanIntent(intent.shotType || beat.shotType) || shotTypes[(scenes.length + beatIndex) % shotTypes.length];
      let movement = cleanIntent(intent.movement || beat.movement) || movements[(scenes.length + beatIndex) % movements.length];
      if (shotType === previousShot) shotType = shotTypes[(shotTypes.indexOf(shotType) + 1) % shotTypes.length];
      if (movement === previousMovement) movement = movements[(movements.indexOf(movement) + 1) % movements.length];
      previousShot = shotType; previousMovement = movement;
      const sourceType = cleanIntent(intent.sourceType || beat.sourceType || 'stock_video');
      if (!['stock_video', 'archive_video'].includes(sourceType)) throw new Error('Unsupported sourceType for current renderer: ' + sourceType + ' (use stock_video or archive_video)');
      scenes.push({
        id: 'scene-' + String(scenes.length + 1).padStart(3, '0'), beat: beatIndex + 1,
        sentenceIndex: sentenceIndex + 1, narration: sentence, visualIntent: visual || 'Illustrate the meaning of this sentence without literal keyword matching',
        visual: visual || footageQuery, footageQuery, sourceType, durationSeconds: duration,
        shotType, movement, colourGrade: input.colourGrade || 'consistent-documentary-neutral',
        overlays: Array.isArray(intent.overlays) ? intent.overlays : (Array.isArray(beat.overlays) ? beat.overlays : []),
        map: intent.map || beat.map || null,
        sourceCredit: intent.sourceCredit || beat.sourceCredit || { required: true, display: 'Creator/source attribution in end credits and project ledger' },
        asset: null, needsHumanSelection: sourceType === 'stock_video' || sourceType === 'archive_video'
      });
    }
  }
  if (!scenes.length) throw new Error('No sentence-level scenes could be planned');
  const id = crypto.createHash('sha256').update(title + '\n' + scenes.map(s => s.narration).join('\n')).digest('hex').slice(0, 16);
  return {
    schemaVersion: 2, projectId: id, title, createdAt: new Date().toISOString(),
    format: { aspectRatio: '16:9', width: 1920, height: 1080, fps: 30 },
    visualContinuity: { colourGrade: input.colourGrade || 'consistent-documentary-neutral', avoidConsecutiveShotRepeats: true, maxShotDurationSeconds: 4 },
    scenes,
    workflow: { realFootageRequired: true, stillImageSlideshow: false,
      approvalRequired: ['sentence-visual-review', 'scene-plan', 'asset-rights', 'source-credit-review', 'sample-render', 'final-render'], humanRightsReview: true }
  };
}
function wordsPerSecond(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }
module.exports = { planScenes, slug, splitSentences };
