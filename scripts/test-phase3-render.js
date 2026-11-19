'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {buildMotionFilters}=require('../agents/production/motion-graphics');
const {buildAudioFilter,ffmpegArgs}=require('../agents/production/audio-mix');
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',dir=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-phase3-'));
function run(args){const r=spawnSync(ffmpeg,args,{encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error('FFmpeg failed: '+(r.stderr||'').slice(-5000));}
try{
 const voice=path.join(dir,'voice.wav'),music=path.join(dir,'music.wav'),sfx=path.join(dir,'whoosh.wav'),picture=path.join(dir,'picture.mp4'),output=path.join(dir,'master.mp4');
 for(const [file,freq] of [[voice,520],[music,180],[sfx,880]])run(['-y','-f','lavfi','-i','sine=frequency='+freq+':sample_rate=44100','-t','3','-c:a','pcm_s16le',file]);
 const graphics=buildMotionFilters([{title:'Cinematic opener',visual:'Night city skyline',durationSeconds:3,overlays:[{text:'A hidden pattern'}],map:{title:'MOVEMENT',points:[{x:.1,y:.2,label:'START'},{x:.8,y:.7,label:'END'}]}}],{width:640,height:360});
 assert(graphics.ass.includes('Cinematic opener')&&graphics.ass.includes('A hidden pattern')&&graphics.filter.includes('drawbox'));
 const assFile=path.join(dir,'graphics.ass');fs.writeFileSync(assFile,graphics.ass);const assPath=assFile.replace(/\\/g,'/').replace(/:/g,'\\:');const subtitleFilter="subtitles=filename='"+assPath+"':charenc=UTF-8";
 run(['-y','-f','lavfi','-i','testsrc=size=640x360:rate=24','-t','3','-vf',graphics.filter+','+subtitleFilter,'-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',picture]);
 const sfxTracks=[{path:sfx,atSeconds:.6,gainDb:-12}],mix=buildAudioFilter({sfx:sfxTracks});
 run(ffmpegArgs({video:picture,voice,music,sfx:sfxTracks,output,filter:mix.filter,profile:{preset:'ultrafast',crf:28,threads:2}}));
 assert(fs.statSync(output).size>10000,'rendered master MP4 should not be empty');
 console.log('PASS Phase 3 FFmpeg render: motion graphics, route map, narration/music ducking and timed SFX');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
