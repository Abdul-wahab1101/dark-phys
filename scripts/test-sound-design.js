'use strict';
const assert = require('node:assert/strict');
const { buildSoundDesignPlan, classifyScene, validateMusicRights } = require('../agents/production/sound-design');
const scenes = [
 { title: 'Cold open hook', act: 'Act I', durationSeconds: 8 },
 { title: 'Research evidence', act: 'Act II', durationSeconds: 12, silence: true },
 { title: 'Unexpected reveal', durationSeconds: 7 },
 { title: 'Final payoff', durationSeconds: 6 }
];
const library = [
 { id: 'impact-1', path: 'assets/impact.wav', tags: ['impact'] },
 { id: 'tick-1', path: 'assets/tick.wav', tags: ['subtle-tick'] },
 { id: 'riser-1', path: 'assets/riser.wav', tags: ['riser'] },
 { id: 'tail-1', path: 'assets/tail.wav', tags: ['tail'] }
];
const plan = buildSoundDesignPlan({ scenes, library, musicPath: 'assets/score.mp3', voicePath: 'voice.mp3', musicRights: { source: 'Original score', licenseId: 'own', commercialUseVerified: true, reviewStatus: 'approved' } });
assert.equal(classifyScene(scenes[0], 0, 4), 'hook');
assert.equal(plan.durationSeconds, 33);
assert.equal(plan.scenes.length, 4);
assert.equal(plan.music.ducking, true);
assert.equal(plan.mix.targetIntegratedLufs, -14);
assert.equal(plan.version, 2);
assert.equal(plan.musicActs.length, 4);
assert.equal(plan.silenceWindows.length, 1);
assert(plan.cueSheet.some(c => c.type === 'intentional-silence'));
assert.equal(validateMusicRights(plan.musicRightsLedger).passed, true);
assert.equal(validateMusicRights({ source: 'Unknown', licenseId: 'unknown', reviewStatus: 'pending' }).passed, false);
assert(plan.cues.every(cue => cue.path && cue.atSeconds >= 0 && cue.atSeconds <= 33));
assert.equal(new Set(plan.cues.map(cue => cue.id)).size, plan.cues.length);
console.log('PASS cinematic sound-design timeline and asset matching');
