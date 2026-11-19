'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const API='https://api.elevenlabs.io/v1/text-to-speech/';
class ElevenLabsNarration {
 constructor(options={}){this.apiKey=options.apiKey||process.env.ELEVENLABS_API_KEY||'';this.voiceId=options.voiceId||process.env.ELEVENLABS_VOICE_ID||'';this.modelId=options.modelId||process.env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2';this.fetch=options.fetch||globalThis.fetch;}
 async synthesize(text,outputPath,options={}){
  const body=String(text||'').trim();if(!body)throw new Error('Narration text is required.');
  if(!this.apiKey||!this.voiceId)throw new Error('Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID locally to generate narration.');
  if(typeof this.fetch!=='function')throw new Error('Node fetch is unavailable; use Node.js 18 or newer.');
  if(!outputPath)throw new Error('An output audio path is required.');
  const voiceSettings={stability:.48,similarity_boost:.78,style:.22,use_speaker_boost:true,...(options.voiceSettings||{})};
  const url=API+encodeURIComponent(this.voiceId)+'?output_format=mp3_44100_128';
  const response=await this.fetch(url,{method:'POST',headers:{'xi-api-key':this.apiKey,'Content-Type':'application/json','Accept':'audio/mpeg'},body:JSON.stringify({text:body,model_id:this.modelId,voice_settings:voiceSettings}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error('ElevenLabs narration failed with HTTP '+response.status+'. Check voice access, quota and API configuration.');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<256)throw new Error('ElevenLabs returned an empty or invalid narration audio payload.');
  const destination=path.resolve(outputPath);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes,{flag:'w'});
  return {provider:'ElevenLabs',modelId:this.modelId,voiceId:this.voiceId,output:destination,bytes:bytes.length,format:'mp3',reviewRequired:true};
 }
}
module.exports={ElevenLabsNarration};
