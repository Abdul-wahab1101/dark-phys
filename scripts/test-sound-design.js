'use strict';
const assert = require('node:assert/strict');
const { buildSoundDesignPlan, classifyScene } = require('../agents/production/sound-design');
const scenes = [
 { title: 'Cold open hook', durationSeconds: 8 },
 { title: 'Research evidence', durationSeconds: 12 },
 { title: 'Unexpected reveal', durationSeconds: 7 },
 { title: 'Final payoff', durationSeconds: 6 }
];
const library = [
 { id: 'impact-1', path: 'assets/impact.wav', tags: ['impact'] },
 { id: 'tick-1', path: 'assets/tick.wav', tags: ['subtle-tick'] },
 { id: 'riser-1', path: 'assets/riser.wav', tags: ['riser'] },
 { id: 'tail-1', path: 'assets/tail.wav', tags: ['tail'] }
];
const plan = buildSoundDesignPlan({ scenes, library, musicPath: 'assets/score.mp3', voicePath: 'voice.mp3' });
assert.equal(classifyScene(scenes[0], 0, 4), 'hook');
assert.equal(plan.durationSeconds, 33);
assert.equal(plan.scenes.length, 4);
assert.equal(plan.music.ducking, true);
assert.equal(plan.mix.targetIntegratedLufs, -14);
assert(plan.cues.every(cue => cue.path && cue.atSeconds >= 0 && cue.atSeconds <= 33));
assert.equal(new Set(plan.cues.map(cue => cue.id)).size, plan.cues.length);
console.log('PASS cinematic sound-design timeline and asset matching');
