'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wordsOf=s=>String(s||'').toLowerCase().match(/[\p{L}\p{N}']+/gu)||[];
function normalizeTranscript(input){
 const rows=Array.isArray(input)?input:(input&&Array.isArray(input.words)?input.words:[]);
 return rows.map((w,i)=>({start:Number(w.start??w.startSeconds),end:Number(w.end??w.endSeconds),text:String(w.text??w.word??'').trim(),index:i}))
 .filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.start>=0&&w.end>w.start&&w.text);
}
function scoreCandidate(text,duration){
 const t=String(text||''),w=wordsOf(t),unique=new Set(w);
 const hook=/\b(why|secret|truth|never|hidden|mistake|actually|shocking|because|imagine|what if|the reason)\b/i.test(t.slice(0,180));
 const payoff=/\b(therefore|that means|in reality|the lesson|remember|finally|the result|so)\b/i.test(t);
 const evidence=/\b(study|research|data|evidence|according|experiment|documented|scientists)\b/i.test(t);
 const complete=/[.!?]["')\]]?\s*$/.test(t);
 const density=clamp(unique.size/Math.max(1,w.length),0,1);
 const durationFit=1-Math.min(1,Math.abs(duration-42)/42);
 const score=durationFit*25+(hook?22:0)+(payoff?14:0)+(evidence?12:0)+(complete?10:0)+density*17;
 return {score:Number(score.toFixed(2)),signals:{hook,payoff,evidence,complete,lexicalDiversity:Number(density.toFixed(2))}};
}
function makeSrt(words,{maxWords=5,maxChars=38}={}){
 const groups=[];let current=[];
 for(const word of words){const candidate=[...current,word],text=candidate.map(x=>x.text).join(' ');
  if(current.length&&(candidate.length>maxWords||text.length>maxChars)){groups.push(current);current=[word];}else current=candidate;}
 if(current.length)groups.push(current);
 const stamp=s=>{const ms=Math.max(0,Math.round(s*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),sec=Math.floor(ms%60000/1000),milli=ms%1000;return [h,m,sec].map(x=>String(x).padStart(2,'0')).join(':')+','+String(milli).padStart(3,'0');};
 return groups.map((g,i)=>(i+1)+'\n'+stamp(g[0].start)+' --> '+stamp(g[g.length-1].end)+'\n'+g.map(x=>x.text).join(' ')+'\n').join('\n');
}
function planShorts({transcript,scenes=[],count=3,minSeconds=20,maxSeconds=60,targetSeconds=42}={}){
 const words=normalizeTranscript(transcript);
 if(words.length<8)throw new Error('Shorts Factory needs word-level transcript timestamps.');
 if(minSeconds<15||maxSeconds>60||minSeconds>maxSeconds)throw new Error('Short duration bounds must be 15-60 seconds.');
 const candidates=[];
 const starts=new Set([0,...scenes.map(s=>Number(s.start??s.startSeconds)).filter(Number.isFinite)]);
 for(const w of words){if(w.start<=words[0].start+2)starts.add(w.start);if(/\b(why|truth|secret|mistake|because|research|study|finally|result)\b/i.test(w.text))starts.add(w.start);}
 for(const start of starts){
  const endTarget=start+targetSeconds;
  let selected=words.filter(w=>w.start>=start&&w.end<=start+maxSeconds);
  if(!selected.length)continue;
  while(selected.length&&selected[selected.length-1].end-selected[0].start>maxSeconds)selected.pop();
  if(!selected.length)continue;
  const duration=selected[selected.length-1].end-selected[0].start;
  if(duration<minSeconds)continue;
  const text=selected.map(w=>w.text).join(' ');
  const quality=scoreCandidate(text,duration);
  candidates.push({startSeconds:selected[0].start,endSeconds:selected[selected.length-1].end,durationSeconds:Number(duration.toFixed(2)),text,words:selected,score:quality.score,signals:quality.signals,captionSrt:makeSrt(selected)});
 }
 candidates.sort((a,b)=>b.score-a.score);
 const chosen=[];
 for(const c of candidates){if(chosen.every(x=>Math.min(x.endSeconds,c.endSeconds)-Math.max(x.startSeconds,c.startSeconds)<8)){chosen.push(c);if(chosen.length>=count)break;}}
 return {version:1,engine:'dark-phys-shorts-factory',independentQcRequired:true,aspectRatio:'9:16',resolution:{width:1080,height:1920},candidatesEvaluated:candidates.length,shorts:chosen.map((c,i)=>({id:'short-'+String(i+1).padStart(2,'0'),...c,renderStatus:'planned',sourceProvenance:{startSeconds:c.startSeconds,endSeconds:c.endSeconds}}))};
}
function renderShort({input,short,output,ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',subtitlePath}={}){
 if(!input||!short||!output)throw new Error('input, short and output are required.');
 if(!fs.existsSync(input))throw new Error('Source video not found: '+input);
 const duration=Number(short.endSeconds)-Number(short.startSeconds);
 if(!Number.isFinite(duration)||duration<15||duration>60)throw new Error('Short duration must be 15-60 seconds.');
 const srt=subtitlePath||output.replace(/\.[^.]+$/,'')+'.srt';
 fs.writeFileSync(srt,short.captionSrt||'','utf8');
 const escaped=path.resolve(srt).replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
 const vf="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,subtitles='"+escaped+"':force_style='FontName=Arial,FontSize=18,Outline=2,Shadow=1,Alignment=2,MarginV=150'";
 const args=['-y','-ss',String(short.startSeconds),'-i',input,'-t',String(duration),'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',output];
 const r=spawnSync(ffmpeg,args,{encoding:'utf8',windowsHide:true});
 if(r.error)throw r.error;if(r.status!==0)throw new Error('Short render failed: '+(r.stderr||'ffmpeg exit '+r.status).slice(-1200));
 return {output,srt,durationSeconds:duration,resolution:'1080x1920',aspectRatio:'9:16',manualReviewRequired:true};
}
module.exports={normalizeTranscript,scoreCandidate,makeSrt,planShorts,renderShort};
