'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wordsOf=s=>String(s||'').toLowerCase().match(/[\p{L}\p{N}']+/gu)||[];
const SENTENCE_END=/[.!?]["')\]]?$/;
function normalizeTranscript(input){
 const rows=Array.isArray(input)?input:(input&&Array.isArray(input.words)?input.words:[]);
 return rows.map((w,i)=>({start:Number(w.start??w.startSeconds),end:Number(w.end??w.endSeconds),text:String(w.text??w.word??'').trim(),index:i}))
 .filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.start>=0&&w.end>w.start&&w.text)
 .sort((a,b)=>a.start-b.start||a.end-b.end)
 .map((word,index)=>({...word,index}));
}
function scoreCandidate(text,duration,meta={}){
 const t=String(text||''),w=wordsOf(t),unique=new Set(w);
 const hook=/\b(why|secret|truth|never|hidden|mistake|actually|because|imagine|what if|reason|how)\b/i.test(t.slice(0,180));
 const payoff=/\b(therefore|that means|in reality|the lesson|remember|finally|the result|so)\b/i.test(t);
 const evidence=/\b(study|research|data|evidence|according|experiment|documented|scientists)\b/i.test(t);
 const complete=meta.endsAtSentence===undefined?SENTENCE_END.test(t.trim()):Boolean(meta.endsAtSentence);
 const startsClean=meta.startsClean===undefined?/^[“"'(\[]?[A-Z0-9]/.test(t.trim()):Boolean(meta.startsClean);
 const density=clamp(unique.size/Math.max(1,w.length),0,1);
 const durationFit=1-Math.min(1,Math.abs(duration-(meta.targetSeconds||42))/(meta.targetSeconds||42));
 const score=durationFit*24+(hook?18:0)+(payoff?12:0)+(evidence?12:0)+(complete?16:0)+(startsClean?6:0)+density*12;
 return {score:Number(score.toFixed(2)),signals:{hook,payoff,evidence,complete,startsClean,lexicalDiversity:Number(density.toFixed(2))}};
}
function makeSrt(words,{maxWords=5,maxChars=38,offsetSeconds=0}={}){
 const groups=[];let current=[];
 for(const word of words){
  const candidate=[...current,word],text=candidate.map(x=>x.text).join(' ');
  if(current.length&&(candidate.length>maxWords||text.length>maxChars)){groups.push(current);current=[word];}else current=candidate;
 }
 if(current.length)groups.push(current);
 const stamp=s=>{const ms=Math.max(0,Math.round((s-offsetSeconds)*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),sec=Math.floor(ms%60000/1000),milli=ms%1000;return [h,m,sec].map(x=>String(x).padStart(2,'0')).join(':')+','+String(milli).padStart(3,'0');};
 return groups.map((g,i)=>(i+1)+'\n'+stamp(g[0].start)+' --> '+stamp(g[g.length-1].end)+'\n'+g.map(x=>x.text).join(' ')+'\n').join('\n');
}
function planShorts({transcript,scenes=[],count=3,minSeconds=20,maxSeconds=60,targetSeconds=42}={}){
 const words=normalizeTranscript(transcript);
 if(words.length<8)throw new Error('Shorts Factory needs word-level transcript timestamps.');
 if(!Number.isInteger(count)||count<1||count>10)throw new Error('Short count must be between 1 and 10.');
 if(![minSeconds,maxSeconds,targetSeconds].every(Number.isFinite)||minSeconds<20||maxSeconds>60||minSeconds>maxSeconds)throw new Error('Short duration bounds must be valid numbers within 20-60 seconds.');
 const target=clamp(Number(targetSeconds)||42,minSeconds,maxSeconds);
 const sceneStarts=new Set(scenes.map(s=>Number(s.start??s.startSeconds)).filter(x=>Number.isFinite(x)&&x>=0));
 const starts=new Set([words[0].start,...sceneStarts]);
 for(let i=0;i<words.length;i++){
  if(i===0||/[.!?]["')\]]?$/.test(words[i-1].text))starts.add(words[i].start);
  if(/\b(why|truth|secret|mistake|because|research|study|finally|result|imagine)\b/i.test(words[i].text))starts.add(words[i].start);
 }
 const candidates=[];
 for(const start of starts){
  const firstWord=words.find(w=>w.start>=start);if(!firstWord)continue;
  const previousWord=words[firstWord.index-1];
  const startsClean=firstWord.index===0||Boolean(previousWord&&SENTENCE_END.test(previousWord.text))||sceneStarts.has(start);
  if(!startsClean)continue;
  let selected=[];
  for(const word of words){
   if(word.start<start)continue;
   if(word.start-start>maxSeconds)break;
   if(selected.length&&word.start-selected[selected.length-1].end>2.25)break;
   if(word.end-start>maxSeconds)break;
   selected.push(word);
   const duration=word.end-selected[0].start;
   if(duration<minSeconds||duration>maxSeconds||!SENTENCE_END.test(word.text))continue;
   const text=selected.map(x=>x.text).join(' ');
   const quality=scoreCandidate(text,duration,{targetSeconds:target,endsAtSentence:true,startsClean});
   candidates.push({startSeconds:selected[0].start,endSeconds:word.end,durationSeconds:Number(duration.toFixed(2)),text,words:selected.slice(),score:quality.score,signals:quality.signals,captionSrt:makeSrt(selected,{offsetSeconds:selected[0].start})});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||Math.abs(a.durationSeconds-target)-Math.abs(b.durationSeconds-target));
 const chosen=[];
 for(const c of candidates){
  if(chosen.every(x=>Math.min(x.endSeconds,c.endSeconds)-Math.max(x.startSeconds,c.startSeconds)<10)){
   chosen.push(c);if(chosen.length>=count)break;
  }
 }
 return {version:2,engine:'dark-phys-shorts-factory',independentQcRequired:true,aspectRatio:'9:16',resolution:{width:1080,height:1920},targetSeconds:target,candidatesEvaluated:candidates.length,shorts:chosen.map((c,i)=>({id:'short-'+String(i+1).padStart(2,'0'),...c,renderStatus:'planned',sourceProvenance:{startSeconds:c.startSeconds,endSeconds:c.endSeconds,source:'word-level-transcript'},qc:{required:true,mode:'short',status:'not_run'}}))};
}
function renderShort({input,short,output,ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',subtitlePath,voicePath,musicPath,musicGainDb=-25,layout='blur-fill',focusX=0.5}={}){
 if(!input||!short||!output)throw new Error('input, short and output are required.');
 if(!fs.existsSync(input))throw new Error('Source video not found: '+input);
 if(path.extname(output).toLowerCase()!=='.mp4')throw new Error('Short output must use an .mp4 extension.');
 if([input,voicePath,musicPath].filter(Boolean).some(source=>path.resolve(source)===path.resolve(output)))throw new Error('Short output must not overwrite the source video or audio.');
 if(voicePath&&!fs.existsSync(voicePath))throw new Error('Voice track not found: '+voicePath);
 if(musicPath&&!fs.existsSync(musicPath))throw new Error('Music track not found: '+musicPath);
 if(!['blur-fill','crop'].includes(layout))throw new Error('layout must be blur-fill or crop.');
 const duration=Number(short.endSeconds)-Number(short.startSeconds);
 if(!Number.isFinite(duration)||duration<20||duration>60)throw new Error('Short duration must be 20-60 seconds.');
 fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
 const srt=subtitlePath||output.replace(/\.[^.]+$/,'')+'.srt';
 fs.writeFileSync(srt,short.captionSrt||'','utf8');
 const escaped=path.resolve(srt).replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
 const subtitleFilter="filename='"+escaped+"':force_style='FontName=Arial,FontSize=18,Outline=2,Shadow=1,Alignment=2,MarginV=150'";
 const args=['-y','-ss',String(short.startSeconds),'-i',input];
 let voiceIndex=0,musicIndex=-1;
 if(voicePath){voiceIndex=1;args.push('-ss',String(short.startSeconds),'-i',voicePath);}
 if(musicPath){musicIndex=voicePath?2:1;args.push('-stream_loop','-1','-i',musicPath);}
 const focus=clamp(Number(focusX)||0.5,0,1);
 const videoGraph=layout==='blur-fill'
  ? '[0:v]split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:12[blur];[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fit];[blur][fit]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,subtitles='+subtitleFilter+'[vout]'
  : '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)*'+focus+':(ih-oh)/2,setsar=1,fps=30,subtitles='+subtitleFilter+'[vout]';
 const filters=[videoGraph];
 if(musicPath){
  const voiceLabel=voicePath?'['+voiceIndex+':a]':'[0:a]';
  filters.push(voiceLabel+'volume=0dB,highpass=f=80,acompressor=threshold=0.10:ratio=3[voice]');
  const musicGain=Number.isFinite(Number(musicGainDb))?Number(musicGainDb):-25;
  filters.push('['+musicIndex+':a]volume='+clamp(musicGain,-48,0)+'dB[music]');
  filters.push('[music][voice]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=450[ducked]');
  filters.push('[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5[aout]');
 }
 args.push('-t',String(duration),'-filter_complex',filters.join(';'),'-map','[vout]');
 if(musicPath)args.push('-map','[aout]');
 else if(voicePath)args.push('-map',voiceIndex+':a:0');
 else args.push('-map','0:a?');
 args.push('-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',output);
 const r=spawnSync(ffmpeg,args,{encoding:'utf8',windowsHide:true});
 if(r.error)throw r.error;if(r.status!==0)throw new Error('Short render failed: '+(r.stderr||'ffmpeg exit '+r.status).slice(-1600));
 return {output,srt,durationSeconds:duration,resolution:'1080x1920',aspectRatio:'9:16',layout,captionTimebase:'clip-relative',musicDucking:Boolean(musicPath),manualReviewRequired:true,qcCommand:'node scripts/quality-control.js --video "'+output+'" --mode short --captions "'+srt+'"'} ;
}
module.exports={normalizeTranscript,scoreCandidate,makeSrt,planShorts,renderShort};