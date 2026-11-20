'use strict';
function check(name,passed,detail,category='technical',required=true){return {name,category,passed:Boolean(passed),detail:String(detail),required};}
function evaluateQc({mode='long',probe={},files={},editorial={},visual={},audio={}}={}){
 if(!['long','short'].includes(mode))throw new Error('mode must be long or short');
 const streams=Array.isArray(probe.streams)?probe.streams:[],v=streams.find(x=>x.codec_type==='video'),a=streams.find(x=>x.codec_type==='audio');
 const duration=Number(probe.format?.duration||v?.duration||0),width=Number(v?.width||0),height=Number(v?.height||0);
 const fpsParts=String(v?.avg_frame_rate||'0/1').split('/'),fps=Number(fpsParts[1])?Number(fpsParts[0])/Number(fpsParts[1]):0;
 const checks=[];
 checks.push(check('video_stream',!!v,v?.codec_name||'missing'));
 checks.push(check('audio_stream',!!a,a?.codec_name||'missing'));
 checks.push(check('duration',mode==='short'?duration>=15&&duration<=60:duration>=480&&duration<=720,duration+' seconds'));
 checks.push(check('resolution',mode==='short'?width>=720&&height>width:width>=1280&&width>height,width+'x'+height));
 checks.push(check('frame_rate',fps>=23&&fps<=60,fps+' fps'));
 checks.push(check('container',String(probe.format?.format_name||'').includes('mp4'),'MP4 expected'));
 checks.push(check('captions',Boolean(files.captions),files.captions||'not supplied'));
 checks.push(check('thumbnail',mode==='short'?true:Boolean(files.thumbnail),files.thumbnail||'not required for individual Short QC'));
 checks.push(check('voice_clarity',audio.voiceClear===true,audio.voiceClear===true?'human-confirmed':'human confirmation required','audio'));
 checks.push(check('music_ducking',audio.musicDucked===true,audio.musicDucked===true?'human-confirmed':'human confirmation required','audio'));
 checks.push(check('clipping',audio.noClipping===true,audio.noClipping===true?'no clipping confirmed':'human confirmation required','audio'));
 checks.push(check('visual_continuity',visual.continuity===true,visual.continuity===true?'human-confirmed':'human confirmation required','visual'));
 checks.push(check('caption_sync',visual.captionSync===true,visual.captionSync===true?'human-confirmed':'human confirmation required','visual'));
 checks.push(check('safe_margins',visual.safeMargins===true,visual.safeMargins===true?'human-confirmed':'human confirmation required','visual'));
 checks.push(check('script_factual_accuracy',editorial.factsVerified===true,editorial.factsVerified===true?'human-confirmed':'source/claim review required','editorial'));
 checks.push(check('rights_and_attribution',editorial.rightsCleared===true,editorial.rightsCleared===true?'human-confirmed':'rights evidence review required','editorial'));
 checks.push(check('original_value',editorial.originalValue===true,editorial.originalValue===true?'human-confirmed':'original commentary/value review required','editorial'));
 checks.push(check('title_thumbnail_match',editorial.metadataMatches===true,editorial.metadataMatches===true?'human-confirmed':'metadata must match delivered content','editorial'));
 const failed=checks.filter(x=>x.required&&!x.passed),manual=checks.filter(x=>['audio','visual','editorial'].includes(x.category)&&!x.passed);
 return {version:1,mode,technical:{passed:checks.filter(x=>x.category==='technical').every(x=>x.passed)},visual:{passed:checks.filter(x=>x.category==='visual').every(x=>x.passed)},audio:{passed:checks.filter(x=>x.category==='audio').every(x=>x.passed)},editorial:{passed:checks.filter(x=>x.category==='editorial').every(x=>x.passed)},checks,blockers:failed.map(x=>x.name),manualReviewItems:manual.map(x=>x.name),readyForManualApproval:failed.length===0,autoPublish:false,publishingMode:'manual_by_default',humanReviewRequired:true};
}
function buildFiveMinuteReview(mode='long'){
 const items=[['00:00–01:00','Opening and promise','Confirm the hook is accurate, compelling and matched by the opening visuals.'],['01:00–02:00','Narration and factual claims','Listen for clarity, pacing, pronunciation and verify on-screen factual claims.'],['02:00–03:00','Visuals and captions','Check scene relevance, continuity, caption timing, spelling and safe margins.'],['03:00–04:00','Audio and rights','Check voice/music balance, clipping, silence, SFX and every asset license/credit.'],['04:00–05:00','Ending and packaging','Check payoff, title/thumbnail honesty, description and final export.']];
 return {mode,durationMinutes:5,items:items.map((x,i)=>({minute:i+1,time:x[0],title:x[1],instructions:x[2],confirmed:false})),decision:'manual_review_required',publishing:'manual_by_default'};
}
module.exports={evaluateQc,buildFiveMinuteReview};
