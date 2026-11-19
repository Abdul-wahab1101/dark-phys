'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
function slug(s){return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function buildSeo(input={}){
 const topic=clean(input.topic||input.title), audience=clean(input.audience||'');
 const sourceTitle=clean(input.title||topic);
 const title=clean(input.seoTitle||sourceTitle).slice(0,100);
 const description=clean(input.description||[sourceTitle,audience?'A practical guide for '+audience+'.':'',clean(input.valueProposition)].filter(Boolean).join(' ')).slice(0,5000);
 const chapters=(Array.isArray(input.chapters)?input.chapters:[]).map(c=>({time:clean(c.time),title:clean(c.title)}));
 const tags=[...new Set((Array.isArray(input.tags)?input.tags:[]).map(clean).filter(Boolean))].slice(0,30);
 return {title,description,tags,chapters,slug:slug(title),language:clean(input.language||'en'),generatedAt:new Date().toISOString(),humanReviewRequired:true};
}
function checkChapters(chapters,durationSeconds){
 const errors=[],seen=new Set();let previous=-1;
 if(!Array.isArray(chapters)||chapters.length<3)errors.push('At least 3 chapters are required');
 (chapters||[]).forEach((c,i)=>{
  const m=String(c.time||'').match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
  if(!m){errors.push('Chapter '+(i+1)+' has invalid timestamp');return;}
  const seconds=(Number(m[1]||0)*3600)+(Number(m[2])*60)+Number(m[3]);
  if(seconds<previous)errors.push('Chapter timestamps must be ascending');
  if(seconds===0&&i!==0)errors.push('Only the first chapter may start at 00:00');
  if(seconds>durationSeconds)errors.push('Chapter '+(i+1)+' exceeds video duration');
  if(seen.has(seconds))errors.push('Duplicate chapter timestamp '+c.time);
  seen.add(seconds);previous=seconds;
  if(clean(c.title).length<3)errors.push('Chapter '+(i+1)+' needs a descriptive title');
 });
 if((chapters||[]).length&&String(chapters[0].time)!=='00:00'&&String(chapters[0].time)!=='0:00')errors.push('First chapter must start at 00:00');
 return {passed:errors.length===0,errors};
}
const PATTERNS=[
 ['potential_hate_or_harassment',/\b(slur|dehumaniz\w*|go harass|attack them|doxx)\b/i],
 ['potential_violent_or_dangerous',/\b(build a bomb|make an explosive|how to poison|kill (?:yourself|them))\b/i],
 ['potential_misinformation_or_unsubstantiated_claim',/\b(cure[s]? cancer|guaranteed cure|100% proven)\b/i],
 ['potential_shocking_or_graphic',/\b(gore|graphic dismemberment|real execution)\b/i],
 ['potential_sensitive_event',/\b(recent tragedy|mass casualty|terror attack)\b/i]
];
function complianceReview(input={}){
 const text=[input.title,input.description,input.script,...(input.tags||[])].filter(Boolean).join(' ');
 const flags=PATTERNS.filter(([,re])=>re.test(text)).map(([code])=>({code,severity:'review',status:'human_review_required'}));
 const checks=[
  {id:'community_guidelines',status:'human_review_required',detail:'Automated keyword screening is only a warning signal; review full context and current YouTube rules.'},
  {id:'advertiser_suitability',status:'human_review_required',detail:'Review narration, visuals, title, thumbnail and context against current advertiser-friendly guidelines.'},
  {id:'factual_accuracy',status:'human_review_required',detail:'Verify every factual claim against the cited primary sources.'},
  {id:'reused_content',status:'human_review_required',detail:'Confirm meaningful original commentary, editing and educational/entertainment value; copyright permission alone does not establish monetization originality.'},
  {id:'inauthentic_content',status:'human_review_required',detail:'Confirm the video is not mass-produced, repetitive or template-generated with minimal variation.'}
 ];
 return {automatedScreening:'advisory_only',flags,checks,passed:flags.length===0,requiresHumanReview:true};
}
function rightsLedger(assets=[]){
 return assets.map((a,i)=>({assetId:clean(a.assetId||'asset-'+(i+1)),kind:clean(a.kind||'unknown'),source:clean(a.source),sourceUrl:clean(a.sourceUrl),creator:clean(a.creator),license:clean(a.license),licenseUrl:clean(a.licenseUrl),retrievedAt:clean(a.retrievedAt),proofPath:clean(a.proofPath),commercialUseVerified:a.commercialUseVerified===true,modifications:clean(a.modifications),attributionRequired:a.attributionRequired===true,attributionText:clean(a.attributionText),reviewStatus:'pending'}));
}
function checkRights(assets=[]){
 const missing=[];
 if(!Array.isArray(assets)||assets.length===0)missing.push('At least one media asset must have a rights record');
 (assets||[]).forEach((a,i)=>{
  ['source','sourceUrl','creator','license','licenseUrl','retrievedAt'].forEach(k=>{if(!clean(a[k]))missing.push('Asset '+(i+1)+' missing '+k);});
  if(a.commercialUseVerified!==true)missing.push('Asset '+(i+1)+' commercial-use permission not verified');
  if(a.attributionRequired===true&&!clean(a.attributionText))missing.push('Asset '+(i+1)+' requires attribution text');
 });
 return {passed:missing.length===0,errors:missing,assetsReviewed:(assets||[]).length};
}
async function requestThumbnailConcepts(endpoint,token,title,subtitle='',fetchImpl=globalThis.fetch){
 if(!/^https:\/\//i.test(String(endpoint||'')))throw new Error('A deployed HTTPS Worker endpoint is required');
 if(typeof fetchImpl!=='function')throw new Error('Fetch is unavailable in this Node runtime');
 const response=await fetchImpl(endpoint.replace(/\\/$/,'')+'/v1/concepts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+String(token||'')},body:JSON.stringify({title,subtitle})});
 if(!response.ok)throw new Error('Thumbnail Worker returned HTTP '+response.status);
 const data=await response.json();
 if(!Array.isArray(data.concepts)||data.concepts.length<2||data.concepts.some(c=>!c.svg||c.width!==1280||c.height!==720))throw new Error('Thumbnail Worker response failed concept validation');
 return data;
}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function canonical(value){return JSON.stringify(value,Object.keys(value||{}).sort());}
function createApproval(pkg,reviewer,checks={}){
 if(!clean(reviewer))throw new Error('A human reviewer name is required');
 const rights=checkRights(pkg.rightsLedger||[]);
 const compliance=pkg.compliance||complianceReview(pkg);
 const chapter=checkChapters(pkg.seo?.chapters||[],Number(pkg.durationSeconds||0));
 if(!rights.passed)throw new Error('Rights review blocked: '+rights.errors.join('; '));
 if(!chapter.passed)throw new Error('Chapter review blocked: '+chapter.errors.join('; '));
 if(checks.guidelines!==true||checks.advertiserSuitability!==true||checks.originality!==true||checks.claims!==true||checks.thumbnail!==true)
  throw new Error('All human review confirmations must be true');
 if(!pkg.finalVideo||!pkg.seo?.title||!pkg.seo?.description)throw new Error('Final video and SEO metadata are required');
 return {status:'approved_for_manual_upload_only',reviewer:clean(reviewer),approvedAt:new Date().toISOString(),packageHash:sha256(JSON.stringify({...pkg,approval:undefined})),checks:{guidelines:true,advertiserSuitability:true,originality:true,claims:true,thumbnail:true,rights:true,chapters:true},publishingPermission:false,automatedUploadAllowed:false};
}
function verifyApproval(pkg,approval){
 if(!approval||approval.status!=='approved_for_manual_upload_only'||approval.publishingPermission!==false)return {valid:false,reason:'No valid manual-upload approval'};
 const hash=sha256(JSON.stringify({...pkg,approval:undefined}));
 return {valid:hash===approval.packageHash,reason:hash===approval.packageHash?'Approval matches current package':'Package changed after approval; re-review required'};
}
function loadJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');}
module.exports={buildSeo,checkChapters,complianceReview,rightsLedger,checkRights,createApproval,verifyApproval,loadJson,writeJson,sha256,requestThumbnailConcepts};
