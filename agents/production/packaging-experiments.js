'use strict';
const STOP=new Set('a an and are as at be been because but by can could did do does for from had has have how i in into is it its may might more most not of on or our people should so than that the their them there these they this those through to was we were what when where which who why will with you your'.split(' '));
const words=s=>(String(s||'').toLowerCase().match(/[\p{L}\p{N}']+/gu)||[]).filter(w=>!STOP.has(w));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function overlapScore(title,script){
 const a=new Set(words(title)),b=new Set(words(script));if(!a.size||!b.size)return 0;
 let n=0;for(const x of a)if(b.has(x))n++;
 return Number((n/a.size).toFixed(3));
}
function unsupportedClaims(title,script){
 const risky=['guaranteed','cure','proven','shocking','exposed','impossible','always','never','secret','truth','destroyed','debunked','scientifically proven'];
 const titleWords=new Set(words(title)),scriptWords=new Set(words(script));
 return risky.filter(word=>titleWords.has(word)&&!scriptWords.has(word));
}
function buildPackagingTests({topic,title,script,thumbnailConcepts=[],channelName='Dark Phys',youtubeTestCompareAvailable=false,oauthAuthorized=false}={}){
 const source=clean(title||topic);
 if(source.length<5)throw new Error('Provide a clear topic/title.');
 if(clean(script).length<80)throw new Error('A substantial approved script is required to match packaging to content.');
 const base=source.replace(/[.!?]+$/,'');
 const candidates=[
  base,
  'What '+base+' Reveals',
  'The Evidence Behind '+base
 ];
 const defaults=[
  {id:'curiosity',direction:'one concrete visual question; one dominant subject',text:base.slice(0,30),visual:'one clear documentary subject, visual question, strong focal point'},
  {id:'evidence',direction:'evidence-led credibility; restrained documentary styling',text:'THE EVIDENCE',visual:'documentary evidence motif, restrained contrast, credible visual'},
  {id:'consequence',direction:'human consequence and clear narrative payoff',text:'WHY IT MATTERS',visual:'human-scale consequence, emotional but not sensational'}
 ];
 const concepts=Array.isArray(thumbnailConcepts)?thumbnailConcepts:[];
 const variants=candidates.map((raw,i)=>{
  const candidate=clean(raw).slice(0,100);
  const concept=concepts[i]||defaults[i];
  const thumbText=clean(concept.text||concept.overlayText||concept.hookText||defaults[i].text).slice(0,42);
  const titleMatch=overlapScore(candidate,script),thumbnailMatch=overlapScore(thumbText,script);
  const unsupported=unsupportedClaims(candidate+' '+thumbText,script);
  const titleStatus=titleMatch>=0.3&&!unsupported.length?'content_aligned_draft':'human_rewrite_required';
  return {
   id:'variant-'+String(i+1),title:candidate,titleScriptMatch:titleMatch,
   thumbnailScriptMatch:thumbnailMatch,titleMatchStatus:titleStatus,
   claimRisk:{unsupportedTerms:unsupported,passed:unsupported.length===0},
   thumbnail:{conceptId:concept.id||defaults[i].id,direction:concept.direction||concept.label||defaults[i].direction,
    overlayText:thumbText,visualPrompt:concept.visual||concept.visualPrompt||concept.prompt||defaults[i].visual,
    imagePath:concept.imagePath||concept.file||null},
   combination:{title:candidate,thumbnailConcept:concept.id||defaults[i].id},
   humanReviewRequired:true
  };
 });
 const distinct=new Set(variants.map(v=>v.title.toLowerCase()));
 if(variants.length!==3||distinct.size!==3)throw new Error('Could not create three distinct packaging combinations.');
 return {
  version:2,sourceScriptWordCount:words(script).length,
  matching:{method:'stopword-filtered script token coverage; heuristic only, not factual verification',minimumTitleCoverage:0.3},
  variants,
  seo:{descriptionRequired:true,tagsRequired:true,chaptersRequireVerifiedTimestamps:true},
  youtubeTestCompare:{available:false,ownerReportedAvailable:Boolean(youtubeTestCompareAvailable),oauthAuthorized:Boolean(oauthAuthorized),eligibleForManualStudioExperiment:Boolean(youtubeTestCompareAvailable&&oauthAuthorized),
   requiresLiveDashboardVerification:true,fallback:'manual packaging review; do not claim an API experiment was started',startAutomatically:false},
  selection:'manual',publishing:'manual_by_default',channelName:clean(channelName)
 };
}
module.exports={buildPackagingTests,overlapScore,unsupportedClaims};