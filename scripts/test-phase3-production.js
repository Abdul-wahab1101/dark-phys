'use strict';
const assert=require('node:assert/strict');
const {PixabayPool}=require('../agents/production/pixabay-pool');
const {planScenes}=require('../agents/production/scene-planner');
const {buildAudioFilter,ffmpegArgs}=require('../agents/production/audio-mix');
(async()=>{
 const p=planScenes({title:'Human Behavior',beats:[{narration:'People hide motives.',visual:'silhouette in city',durationSeconds:9},{narration:'Patterns reveal intent.',footageQuery:'crowd walking at night'}]});
 assert.equal(p.scenes.length,2);assert.equal(p.workflow.realFootageRequired,true);assert.equal(p.workflow.stillImageSlideshow,false);
 assert.match(p.scenes[0].movement,/push|pan|static|parallax/);
 const f=buildAudioFilter();assert.match(f.filter,/sidechaincompress/);assert.match(f.filter,/loudnorm/);
 const args=ffmpegArgs({video:'v.mp4',voice:'v.wav',music:'m.mp3',output:'out.mp4'});assert(args.includes('libx264'));assert(args.includes('[aout]'));
 const pool=new PixabayPool({keys:['one','two'],fetch:async()=>{throw new Error('mock failure');}});
 assert.equal(pool.clients.length,2);assert.equal(pool.configured,true);
 const missing=new PixabayPool({keys:[]});assert.equal((await missing.search('test')).status,'needs_api_keys');
 console.log('PASS Phase 3 production planner, dual-key pool and audio mix tests');
})().catch(e=>{console.error(e);process.exit(1);});
