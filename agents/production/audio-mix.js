'use strict';
function buildAudioFilter(options={}) {
 const voiceGain=Number.isFinite(Number(options.voiceGainDb))?Number(options.voiceGainDb):0;
 const musicGain=Number.isFinite(Number(options.musicGainDb))?Number(options.musicGainDb):-24;
 const sfx=Array.isArray(options.sfx)?options.sfx:[];
 const chains=[];
 if(options.duckMusic===false){
  chains.push('[1:a]volume='+voiceGain+'dB,highpass=f=75,acompressor=threshold=0.12:ratio=2.5:attack=15:release=180[voicemix]');
  chains.push('[2:a]volume='+musicGain+'dB[musicduck]');
 }else{
  chains.push('[1:a]volume='+voiceGain+'dB,highpass=f=75,acompressor=threshold=0.12:ratio=2.5:attack=15:release=180,asplit=2[voicekey][voicemix]');
  chains.push('[2:a]volume='+musicGain+'dB[musicbase]');
  chains.push('[musicbase][voicekey]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=450[musicduck]');
 }
 const inputs=['[voicemix]','[musicduck]'];
 sfx.forEach((item,i)=>{const index=i+3,gain=Number.isFinite(Number(item.gainDb))?Number(item.gainDb):-8,delay=Math.max(0,Math.round((Number(item.atSeconds)||0)*1000)),label='sfx'+i;chains.push('['+index+':a]volume='+gain+'dB,adelay='+delay+'|'+delay+'['+label+']');inputs.push('['+label+']');});
 chains.push(inputs.join('')+'amix=inputs='+inputs.length+':duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]');
 return {filter:chains.join(';'),output:'[aout]'};
}
function ffmpegArgs({video,voice,music,output,filter,sfx=[],profile={}}) {
 if(!video||!voice||!music||!output)throw new Error('video, voice, music and output paths are required');
 const args=['-y','-i',video,'-i',voice,'-stream_loop','-1','-i',music];
 for(const item of sfx){if(!item||!item.path)throw new Error('Every sound effect needs a path');args.push('-i',item.path);}
 args.push('-filter_complex',filter||buildAudioFilter({sfx}).filter,'-map','0:v:0','-map','[aout]','-c:v','libx264','-preset',profile.preset||'ultrafast','-crf',String(profile.crf==null?26:profile.crf),'-threads',String(profile.threads||2),'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest',output);
 return args;
}
module.exports={buildAudioFilter,ffmpegArgs};
