'use strict';
const assert=require('node:assert/strict');
const {PixabayPool}=require('../agents/production/pixabay-pool');
const {planScenes}=require('../agents/production/scene-planner');
const {buildAudioFilter,ffmpegArgs}=require('../agents/production/audio-mix');
const {buildMotionFilters}=require('../agents/production/motion-graphics');
const {getRenderProfile}=require('../agents/production/render-profile');
(async()=>{
 const p=planScenes({title:'Human Behavior',beats:[{narration:'People hide motives.',visual:'silhouette in city',durationSeconds:9},{narration:'Patterns reveal intent.',footageQuery:'crowd walking at night'}]});
 assert.equal(p.scenes.length,2);assert.equal(p.workflow.realFootageRequired,true);assert.equal(p.workflow.stillImageSlideshow,false);
 assert.match(p.scenes[0].movement,/push|pan|static|parallax/);
 const f=buildAudioFilter();assert.match(f.filter,/sidechaincompress/);assert.match(f.filter,/loudnorm/);
 const mix=buildAudioFilter({sfx:[{path:'whoosh.wav',atSeconds:2,gainDb:-10}]});assert.match(mix.filter,/sidechaincompress/);assert.match(mix.filter,/adelay=2000/);assert.match(mix.filter,/amix=inputs=3/);const args=ffmpegArgs({video:'v.mp4',voice:'v.wav',music:'m.mp3',sfx:[{path:'whoosh.wav',atSeconds:2}],output:'out.mp4'});assert(args.includes('libx264'));assert(args.includes('[aout]'));assert(args.includes('whoosh.wav'));const graphics=buildMotionFilters([{title:'Opening scene',durationSeconds:5,overlays:[{text:'KEY IDEA'}],map:{title:'ROUTE',points:[{x:.1,y:.2,label:'A'},{x:.8,y:.7,label:'B'}]}}]);assert.match(graphics.filter,/drawtext/);assert.match(graphics.filter,/drawbox/);assert.equal(graphics.durationSeconds,5);const low=getRenderProfile({totalMemoryBytes:8*1024*1024*1024});assert.equal(low.width,1280);assert.equal(low.threads,2);const high=getRenderProfile({totalMemoryBytes:16*1024*1024*1024,mode:'final'});assert.equal(high.width,1920);
 const pool=new PixabayPool({keys:['one','two'],fetch:async()=>{throw new Error('mock failure');}});
 assert.equal(pool.clients.length,2);assert.equal(pool.configured,true);
 const missing=new PixabayPool({keys:[]});assert.equal((await missing.search('test')).status,'needs_api_keys');
 console.log('PASS Phase 3 production planner, dual-key pool and audio mix tests');
})().catch(e=>{console.error(e);process.exit(1);});
