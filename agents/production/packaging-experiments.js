'use strict';
const words=s=>String(s||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function overlapScore(title,script){const a=new Set(words(title)),b=new Set(words(script));if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return Number((n/a.size).toFixed(3));}
function buildPackagingTests({topic,title,script,thumbnailConcepts=[],channelName='Dark Phys',youtubeTestCompareAvailable=false,oauthAuthorized=false}={}){
 const source=clean(title||topic);if(source.length<5)throw new Error('Provide a clear topic/title.');
 if(clean(script).length<80)throw new Error('A substantial approved script is required to match packaging to content.');
 const base=source.replace(/[.!?]+$/,'');
 const titleCandidates=[base, /^why\s/i.test(base)?'The Truth About '+base.replace(/^why\s/i,''):'Why '+base+' Matters', 'What the Evidence Reveals About '+base];
 const defaults=[
  {id:'curiosity',direction:'curiosity with a concrete question',text:base,visual:'one clear subject, visual question, strong focal point'},
  {id:'evidence',direction:'evidence-led credibility',text:'THE EVIDENCE',visual:'documentary evidence motif, restrained contrast, credible visual'},
  {id:'consequence',direction:'human consequence and payoff',text:'WHY IT MATTERS',visual:'human-scale consequence, emotional but not sensational'}
 ];
 const concepts=Array.isArray(thumbnailConcepts)?thumbnailConcepts:[];
 const variants=titleCandidates.map((candidate,i)=>{
  const concept=concepts[i]||defaults[i];
  const thumbText=clean(concept.text||concept.overlayText||concept.hookText||defaults[i].text).slice(0,42);
  const score=overlapScore(candidate+' '+thumbText,script);
  return {id:'variant-'+String(i+1),title:candidate.slice(0,100),titleScriptMatch:score,titleMatchStatus:score>=0.08?'content_aligned_draft':'human_rewrite_required',thumbnail:{conceptId:concept.id||defaults[i].id,direction:concept.direction||concept.label||defaults[i].direction,overlayText:thumbText,visualPrompt:concept.visual||concept.visualPrompt||concept.prompt||defaults[i].visual,imagePath:concept.imagePath||concept.file||null},combination:{title:candidate.slice(0,100),thumbnailConcept:concept.id||defaults[i].id},humanReviewRequired:true};
 });
 const distinct=new Set(variants.map(v=>v.title.toLowerCase()));if(variants.length!==3||distinct.size!==3)throw new Error('Could not create three distinct packaging combinations.');
 return {version:1,sourceScriptWordCount:words(script).length,variants,seo:{descriptionRequired:true,tagsRequired:true,chaptersRequireVerifiedTimestamps:true},youtubeTestCompare:{available:Boolean(youtubeTestCompareAvailable&&oauthAuthorized),authorized:Boolean(oauthAuthorized),fallback:'manual packaging review; do not claim an API experiment was started',startAutomatically:false},selection:'manual',publishing:'manual_by_default'};
}
module.exports={buildPackagingTests,overlapScore};
