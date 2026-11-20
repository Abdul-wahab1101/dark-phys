'use strict';
function check(name,passed,detail,category='technical',required=true){return {name,category,passed:Boolean(passed),detail:String(detail),required};}
function evaluateQc({mode='long',probe={},files={},editorial={},visual={},audio={}}={}){
 if(!['long','short'].includes(mode))throw new Error('mode must be long or short');
 const streams=Array.isArray(probe.streams)?probe.streams:[],v=streams.find(x=>x.codec_type==='video'),a=streams.find(x=>x.codec_type==='audio');
 const duration=Number(probe.format?.duration||v?.duration||0),width=Number(v?.width||0),height=Number(v?.height||0);
 const aspect=height>0?width/height:0;
 const fpsParts=String(v?.avg_frame_rate||'0/1').split('/'),fps=Number(fpsParts[1])?Number(fpsParts[0])/Number(fpsParts[1]):0;
 const audioRate=Number(a?.sample_rate||0),audioChannels=Number(a?.channels||0);
 const audioCodec=String(a?.codec_name||'').toLowerCase(),videoCodec=String(v?.codec_name||'').toLowerCase();
 const checks=[];
 checks.push(check('video_stream',!!v,v?.codec_name||'missing'));
 checks.push(check('audio_stream',!!a,a?.codec_name||'missing'));
 checks.push(check('duration',mode==='short'?duration>=15&&duration<=60:duration>=480&&duration<=720,duration+' seconds'));
 checks.push(check('resolution',mode==='short'?width>=720&&height>width:width>=1280&&width>height,width+'x'+height));
 checks.push(check('frame_rate',fps>=23&&fps<=60,fps+' fps'));
 checks.push(check('aspect_ratio',mode==='short'?aspect>=0.52&&aspect<=0.62:aspect>=1.65&&aspect<=1.9,aspect.toFixed(3)));
 checks.push(check('video_codec',['h264','hevc'].includes(videoCodec),videoCodec||'unknown'));
 checks.push(check('pixel_format',String(v?.pix_fmt||'')==='yuv420p',v?.pix_fmt||'unknown'));
 checks.push(check('audio_codec',['aac','opus'].includes(audioCodec),audioCodec||'unknown'));
 checks.push(check('audio_sample_rate',audioRate>=44100,audioRate+' Hz'));
 checks.push(check('audio_channels',audioChannels>=2,audioChannels+' channels'));
 checks.push(check('container',String(probe.format?.format_name||'').includes('mp4'),'MP4 expected'));
 checks.push(check('captions',Boolean(files.captions),files.captions||'not supplied'));
 checks.push(check('thumbnail',mode==='short'?true:Boolean(files.thumbnail),files.thumbnail||'not required for individual Short QC'));
 checks.push(check('voice_clarity',audio.voiceClear===true,audio.voiceClear===true?'human-confirmed':'human confirmation required','audio'));
 checks.push(check('music_ducking',audio.musicDucked===true,audio.musicDucked===true?'human-confirmed':'human confirmation required','audio'));
 checks.push(check('clipping',audio.noClipping===true,audio.noClipping===true?'no clipping confirmed':'human confirmation required','audio'));
 checks.push(check('noise_floor',audio.noDistractingNoise===true,audio.noDistractingNoise===true?'human-confirmed':'noise-floor listening check required','audio'));
 checks.push(check('level_consistency',audio.levelsConsistent===true,audio.levelsConsistent===true?'human-confirmed':'section-to-section level check required','audio'));
 checks.push(check('pronunciation',audio.pronunciationVerified===true,audio.pronunciationVerified===true?'human-confirmed':'names, numbers and technical terms need review','audio'));
 checks.push(check('visual_continuity',visual.continuity===true,visual.continuity===true?'human-confirmed':'human confirmation required','visual'));
 checks.push(check('caption_sync',visual.captionSync===true,visual.captionSync===true?'human-confirmed':'human confirmation required','visual'));
 checks.push(check('safe_margins',visual.safeMargins===true,visual.safeMargins===true?'human-confirmed':'human confirmation required','visual'));
 checks.push(check('no_black_or_frozen_frames',visual.noBlackOrFrozenFrames===true,visual.noBlackOrFrozenFrames===true?'human-confirmed':'scan for black/frozen frames','visual'));
 checks.push(check('visuals_match_narration',visual.visualsMatchNarration===true,visual.visualsMatchNarration===true?'human-confirmed':'check every visual against spoken context','visual'));
 checks.push(check('script_factual_accuracy',editorial.factsVerified===true,editorial.factsVerified===true?'human-confirmed':'source/claim review required','editorial'));
 checks.push(check('rights_and_attribution',editorial.rightsCleared===true,editorial.rightsCleared===true?'human-confirmed':'rights evidence review required','editorial'));
 checks.push(check('original_value',editorial.originalValue===true,editorial.originalValue===true?'human-confirmed':'original commentary/value review required','editorial'));
 checks.push(check('title_thumbnail_match',editorial.metadataMatches===true,editorial.metadataMatches===true?'human-confirmed':'metadata must match delivered content','editorial'));
 checks.push(check('community_guidelines',editorial.communityGuidelinesReviewed===true,editorial.communityGuidelinesReviewed===true?'human-confirmed':'full context review required','editorial'));
 checks.push(check('advertiser_suitability',editorial.advertiserSuitabilityReviewed===true,editorial.advertiserSuitabilityReviewed===true?'human-confirmed':'advertiser suitability review required','editorial'));
 const failed=checks.filter(x=>x.required&&!x.passed),manual=checks.filter(x=>['audio','visual','editorial'].includes(x.category)&&!x.passed);
 return {version:1,mode,technical:{passed:checks.filter(x=>x.category==='technical').every(x=>x.passed)},visual:{passed:checks.filter(x=>x.category==='visual').every(x=>x.passed)},audio:{passed:checks.filter(x=>x.category==='audio').every(x=>x.passed)},editorial:{passed:checks.filter(x=>x.category==='editorial').every(x=>x.passed)},checks,blockers:failed.map(x=>x.name),manualReviewItems:manual.map(x=>x.name),readyForManualApproval:failed.length===0,autoPublish:false,publishingMode:'manual_by_default',humanReviewRequired:true};
}
function buildFiveMinuteReview(mode='long'){
 const longItems=[
  ['Pass 1 · Opening','Opening and promise','Confirm the hook is accurate, compelling and matched by the opening visuals.'],
  ['Pass 2 · Claims','Narration and factual claims','Listen across the full video for clarity, pacing and pronunciation; verify key claims against sources.'],
  ['Pass 3 · Picture','Visuals and captions','Scan the full timeline for scene relevance, continuity, caption timing, spelling and safe margins.'],
  ['Pass 4 · Sound','Audio and rights','Check voice/music balance, clipping, silence, SFX, ambience and every asset license/credit.'],
  ['Pass 5 · Finish','Ending and packaging','Check payoff, title/thumbnail honesty, description, chapters and final export.']
 ];
 const shortItems=[
  ['Pass 1 · First seconds','Hook and first frame','Check the first 1–2 seconds, immediate context and visual hook.'],
  ['Pass 2 · One idea','Clarity and payoff','Confirm the Short makes sense independently, delivers one clear idea and has a complete payoff.'],
  ['Pass 3 · Vertical frame','Framing and captions','Check 9:16 composition, subject visibility, caption sync, spelling and platform-safe margins.'],
  ['Pass 4 · Sound','Voice, music and effects','Check voice clarity, music ducking, SFX timing, clipping and consistent loudness.'],
  ['Pass 5 · Finish','Ending and packaging','Check the final cut, loop/ending, source credit, title and thumbnail where used.']
 ];
 const items=mode==='short'?shortItems:longItems;
 return {mode,durationMinutes:5,items:items.map((x,i)=>({minute:i+1,time:x[0],title:x[1],instructions:x[2],confirmed:false})),decision:'manual_review_required',publishing:'manual_by_default'};
}
module.exports={evaluateQc,buildFiveMinuteReview};
