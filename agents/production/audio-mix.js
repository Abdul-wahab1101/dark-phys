'use strict';
const path=require('node:path');
function buildAudioFilter(options={}) {
 const voice=options.voiceInput||'[1:a]'; const music=options.musicInput||'[2:a]';
 const voiceGain=Number.isFinite(Number(options.voiceGainDb))?Number(options.voiceGainDb):0;
 const musicGain=Number.isFinite(Number(options.musicGainDb))?Number(options.musicGainDb):-24;
 const duck=options.duckMusic!==false;
 const musicChain=duck?'[2:a]volume='+musicGain+'dB,sidechaincompress=threshold=0.025:ratio=8:attack=20:release=450[musicduck]':'[2:a]volume='+musicGain+'dB[musicduck]';
 return {filter: '[1:a]volume='+voiceGain+'dB,highpass=f=75,acompressor=threshold=0.12:ratio=2.5:attack=15:release=180[voice];'+musicChain+';[voice][musicduck]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]',output:'[aout]'};
}
function ffmpegArgs({video,voice,music,output,filter}) {
 if(!video||!voice||!music||!output) throw new Error('video, voice, music and output paths are required');
 return ['-y','-i',video,'-i',voice,'-stream_loop','-1','-i',music,'-filter_complex',filter||buildAudioFilter().filter,'-map','0:v:0','-map','[aout]','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest',output];
}
module.exports={buildAudioFilter,ffmpegArgs};
