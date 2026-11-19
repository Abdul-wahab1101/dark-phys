'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

function clean(s){return String(s??'').replace(/\s+/g,' ').trim();}
function slug(s){return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function parseTimestamp(value){
 const m=String(value||'').match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
 if(!m)return null;
 return Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]);
}
function formatTimestamp(seconds){
 const n=Math.max(0,Math.floor(seconds)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;
 return h?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function suggestChapters(input,durationSeconds){
 if(Array.isArray(input.chapters)&&input.chapters.length)return {chapters:input.chapters.map(c=>({time:clean(c.time),title:clean(c.title)})),method:'user_supplied_timestamps',humanReviewRequired:true};
 const duration=Number(durationSeconds);
 if(!Number.isFinite(duration)||duration<30)return {chapters:[],method:'timestamps_required_for_short_video',humanReviewRequired:true};
 const sections=Array.isArray(input.chapterBeats)?input.chapterBeats:(Array.isArray(input.structure)?input.structure:(Array.isArray(input.sections)?input.sections:[]));
 const labels=sections.map(s=>clean(typeof s==='string'?s:(s.title||s.name||s.heading))).filter(Boolean);
 const chosen=(labels.length>=3?labels:['The central question','Evidence and explanation','Key takeaways']).slice(0,6);
 const count=Math.min(chosen.length,Math.max(3,Math.floor(duration/60)+1));
 const chapters=[];
 for(let i=0;i<count;i++){
  const seconds=i===0?0:Math.floor((duration-10)*(i/(count-1))/10)*10;
  chapters.push({time:formatTimestamp(seconds),title:chosen[i]||('Chapter '+(i+1))});
 }
 return {chapters,method:'evenly_spaced_draft_timestamps',humanReviewRequired:true};
}
function buildSeo(input={}){
 const topic=clean(input.topic||input.title);
 const audience=clean(input.audience||'');
 const sourceTitle=clean(input.title||topic);
 const title=clean(input.seoTitle||sourceTitle).slice(0,100);
 const description=clean(input.description||[sourceTitle,audience?'A practical guide for '+audience+'.':'',clean(input.valueProposition)].filter(Boolean).join(' ')).slice(0,5000);
 const duration=Number(input.durationSeconds||input.targetDurationSec||600);
 const chapterDraft=suggestChapters(input,duration);
 const tags=[...new Set((Array.isArray(input.tags)?input.tags:[]).map(clean).filter(Boolean))].slice(0,30);
 const titleOptions=[title,clean(sourceTitle+' — Explained').slice(0,100),clean('What to Know About '+sourceTitle).slice(0,100)].filter((v,i,a)=>v.length>=10&&a.indexOf(v)===i).slice(0,3);
 return {title, titleOptions, description, tags, chapters:chapterDraft.chapters, chapterGeneration:chapterDraft.method, chapterTimestampsRequireHumanReview:true, slug:slug(title), language:clean(input.language||'en'), generatedAt:new Date().toISOString(), humanReviewRequired:true};
}
function checkSeo(seo={}){
 const errors=[];
 const title=clean(seo.title),description=clean(seo.description);
 if(title.length<10||title.length>100)errors.push('SEO title must be 10-100 characters');
 if(description.length<50||description.length>5000)errors.push('SEO description must be 50-5000 characters');
 if(!Array.isArray(seo.tags)||seo.tags.length===0)errors.push('At least one relevant SEO tag is required');
 if(Array.isArray(seo.tags)){
  if(seo.tags.length>30)errors.push('Use no more than 30 SEO tags');
  if(seo.tags.some(t=>!clean(t)||clean(t).length>100))errors.push('SEO tags must be 1-100 characters');
  if(new Set(seo.tags.map(t=>clean(t).toLowerCase())).size!==seo.tags.length)errors.push('SEO tags must be unique');
 }
 return {passed:errors.length===0,errors};
}
function checkChapters(chapters,durationSeconds){
 const errors=[],seen=new Set();let previous=-1;
 const duration=Number(durationSeconds);
 if(!Number.isFinite(duration)||duration<30)errors.push('A valid video duration of at least 30 seconds is required for chapters');
 if(!Array.isArray(chapters)||chapters.length<3)errors.push('At least 3 chapters are required');
 (Array.isArray(chapters)?chapters:[]).forEach((c,i)=>{
  const seconds=parseTimestamp(c.time);
  if(seconds===null){errors.push('Chapter '+(i+1)+' has invalid timestamp');return;}
  if(seconds<previous)errors.push('Chapter timestamps must be ascending');
  if(seconds<0||seconds>duration)errors.push('Chapter '+(i+1)+' exceeds video duration');
  if(i===0&&seconds!==0)errors.push('First chapter must start at 00:00');
  if(i>0&&seconds-previous<10)errors.push('YouTube chapters must be at least 10 seconds apart');
  if(seconds===0&&i!==0)errors.push('Only the first chapter may start at 00:00');
  if(seen.has(seconds))errors.push('Duplicate chapter timestamp '+c.time);
  seen.add(seconds);previous=seconds;
  if(clean(c.title).length<3)errors.push('Chapter '+(i+1)+' needs a descriptive title');
 });
 return {passed:errors.length===0,errors};
}
const PATTERNS=[
 ['potential_hate_or_harassment',/\b(slur|dehumaniz\w*|go harass|attack them|doxx)\b/i],
 ['potential_violent_or_dangerous',/\b(build a bomb|make an explosive|how to poison|kill (?:yourself|them))\b/i],
 ['potential_misinformation_or_unsubstantiated_claim',/\b(cure[s]? cancer|guaranteed cure|100% proven)\b/i],
 ['potential_shocking_or_graphic',/\b(gore|graphic dismemberment|real execution)\b/i],
 ['potential_sensitive_event',/\b(recent tragedy|mass casualty|terror attack)\b/i],
 ['potential_shocking_language',/\b(f[u*]ck(?:ing)?|c[u*]nt|motherfucker)\b/i]
];
function tokens(text){return (String(text||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]);}
function shingles(text,size=5){
 const words=tokens(text),out=new Set();
 for(let i=0;i<=words.length-size;i++)out.add(words.slice(i,i+size).join(' '));
 return out;
}
function similarity(a,b){
 const A=shingles(a),B=shingles(b);if(!A.size||!B.size)return 0;
 let intersection=0;for(const x of A)if(B.has(x))intersection++;
 return intersection/(A.size+B.size-intersection);
}
function originalityReview(input={}){
 const script=clean(input.script||input.narration||'');
 const previous=Array.isArray(input.previousScripts)?input.previousScripts:[];
 const comparisons=previous.map((entry,i)=>{
  const prior=typeof entry==='string'?entry:(entry.script||entry.narration||'');
  return {index:i+1,title:typeof entry==='string'?'':clean(entry.title),similarity:Number(similarity(script,prior).toFixed(3))};
 }).sort((a,b)=>b.similarity-a.similarity);
 const flags=[];
 if(!script)flags.push({code:'script_missing_for_similarity_review',severity:'review'});
 if(comparisons.some(x=>x.similarity>=0.72))flags.push({code:'possible_reused_script_overlap',severity:'high',matches:comparisons.filter(x=>x.similarity>=0.72)});
 const recentTemplates=Array.isArray(input.recentTemplateIds)?input.recentTemplateIds.map(clean).filter(Boolean):[];
 const templateId=clean(input.templateId);
 if(templateId&&recentTemplates.filter(x=>x===templateId).length>=2)flags.push({code:'repeated_template_pattern',severity:'review',templateId});
 return {method:'local_five_word_shingle_similarity_and_template_history',comparisons,highestSimilarity:comparisons.length?comparisons[0].similarity:null,templateId:templateId||null,flags,checks:[
  {id:'reused_content',status:'human_review_required',detail:'Compare the final video with other channels and prior uploads; permission and attribution do not by themselves establish monetization originality.'},
  {id:'inauthentic_content',status:'human_review_required',detail:'Check for mass-produced, repetitive or minimally varied videos, scripts, visuals and templates.'},
  {id:'original_contribution',status:'human_review_required',detail:'Confirm meaningful original explanation, commentary, analysis or creative transformation.'}
 ],advisoryOnly:true};
}
function complianceReview(input={}){
 const tagText=Array.isArray(input.tags)?input.tags.join(' '):input.tags;
 const text=[input.title,input.description,input.script,input.narration,input.captions,input.thumbnailText,tagText].filter(Boolean).join(' ');
 const flags=PATTERNS.filter(([,re])=>re.test(text)).map(([code])=>({code,severity:'review',status:'human_review_required'}));
 const originality=originalityReview(input);
 const checks=[
  {id:'community_guidelines',status:'human_review_required',detail:'Review full context, narration, visuals, metadata and thumbnail against current YouTube Community Guidelines.'},
  {id:'advertiser_suitability',status:'human_review_required',detail:'Review the complete video, spoken language, on-screen text, title, description and thumbnail against current advertiser-friendly guidelines.'},
  {id:'factual_accuracy',status:'human_review_required',detail:'Verify every factual claim against primary sources and remove unsupported or misleading claims.'},
  ...originality.checks
 ];
 return {automatedScreening:'advisory_only',flags,originality,checks,status:'human_review_required',passed:false,requiresHumanReview:true,disclaimer:'No automated keyword or similarity check can determine YouTube policy compliance or monetization eligibility.'};
}
function importAssetManifest(manifest=[]){
 const rows=Array.isArray(manifest)?manifest:(Array.isArray(manifest?.assets)?manifest.assets:[]);
 return rows.map((a,i)=>{
  const provider=clean(a.provider||a.source);
  const licenseUrl=clean(a.licenseUrl)||(provider.toLowerCase()==='pixabay'?'https://pixabay.com/service/license-summary/':'');
  const commercialUseVerified=a.commercialUseVerified===true;
  const attributionReviewed=a.attributionReviewed===true;
  const reviewStatus=a.reviewStatus==='approved'&&commercialUseVerified&&attributionReviewed?'approved':'pending';
  return {assetId:clean(a.assetId||a.id||'asset-'+(i+1)),kind:clean(a.kind||'video'),source:provider,sourceUrl:clean(a.sourceUrl||a.sourcePage),creator:clean(a.creator),license:clean(a.license),licenseUrl,retrievedAt:clean(a.retrievedAt),proofPath:clean(a.proofPath||a.licenseProofPath),commercialUseVerified,modifications:clean(a.modifications),attributionRequired:typeof a.attributionRequired==='boolean'?a.attributionRequired:false,attributionReviewed,attributionText:clean(a.attributionText),reviewStatus};
 });
}
function rightsLedger(assets=[]){
 return (Array.isArray(assets)?assets:[]).map((a,i)=>{
  a=a&&typeof a==='object'?a:{};
  const commercialUseVerified=a.commercialUseVerified===true,attributionReviewed=a.attributionReviewed===true;
  return {assetId:clean(a.assetId||'asset-'+(i+1)),kind:clean(a.kind||'unknown'),source:clean(a.source),sourceUrl:clean(a.sourceUrl),creator:clean(a.creator),license:clean(a.license),licenseUrl:clean(a.licenseUrl),retrievedAt:clean(a.retrievedAt),proofPath:clean(a.proofPath),commercialUseVerified,modifications:clean(a.modifications),attributionRequired:a.attributionRequired===true,attributionReviewed,attributionText:clean(a.attributionText),reviewStatus:a.reviewStatus==='approved'&&commercialUseVerified&&attributionReviewed?'approved':'pending'};
 });
}
function isHttps(value){try{return new URL(String(value)).protocol==='https:';}catch(_){return false;}}
function checkRights(assets=[]){
 const errors=[],ids=new Set();
 if(!Array.isArray(assets)||assets.length===0)errors.push('At least one media asset must have a rights record');
 (Array.isArray(assets)?assets:[]).forEach((a,i)=>{
  const label='Asset '+(i+1);
  if(!clean(a.assetId))errors.push(label+' missing assetId');
  else if(ids.has(clean(a.assetId)))errors.push(label+' has duplicate assetId '+a.assetId);
  else ids.add(clean(a.assetId));
  ['source','creator','license','retrievedAt','proofPath'].forEach(k=>{if(!clean(a[k]))errors.push(label+' missing '+k);});
  if(!isHttps(a.sourceUrl))errors.push(label+' sourceUrl must be a valid HTTPS URL');
  if(!isHttps(a.licenseUrl))errors.push(label+' licenseUrl must be a valid HTTPS URL');
  if(!Number.isFinite(Date.parse(a.retrievedAt)))errors.push(label+' retrievedAt must be a valid date/time');
  if(clean(a.proofPath)&&!isHttps(a.proofPath)&&!fs.existsSync(path.resolve(a.proofPath)))errors.push(label+' license proof file does not exist: '+a.proofPath);
  if(a.commercialUseVerified!==true)errors.push(label+' commercial-use permission not verified');
  if(a.reviewStatus!=='approved')errors.push(label+' rights review is not approved');
  if(a.attributionReviewed!==true)errors.push(label+' attribution requirements have not been reviewed');
  if(a.attributionRequired===true&&!clean(a.attributionText))errors.push(label+' requires attribution text');
  if(!clean(a.modifications))errors.push(label+' must describe modifications or state "none"');
 });
 return {passed:errors.length===0,errors,assetsReviewed:Array.isArray(assets)?assets.length:0};
}
async function requestThumbnailConcepts(endpoint,token,title,subtitle='',fetchImpl=globalThis.fetch){
 if(!/^https:\/\//i.test(String(endpoint||'')))throw new Error('A deployed HTTPS Worker endpoint is required');
 if(!clean(token))throw new Error('Cloudflare thumbnail Worker API token is required');
 if(clean(title).length<4||clean(title).length>72||clean(subtitle).length>90)throw new Error('Thumbnail title must be 4-72 chars and subtitle max 90');
 if(typeof fetchImpl!=='function')throw new Error('Fetch is unavailable in this Node runtime');
 const response=await fetchImpl(endpoint.replace(/\/+$/, '')+'/v1/concepts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+String(token)},body:JSON.stringify({title,subtitle})});
 if(!response.ok)throw new Error('Thumbnail Worker returned HTTP '+response.status);
 const data=await response.json();
 if(!Array.isArray(data.concepts)||data.concepts.length!==3)throw new Error('Thumbnail Worker must return exactly three concepts');
 const ids=new Set();
 for(const c of data.concepts){
  if(!c||!/^[-a-z0-9]{2,32}$/.test(c.id)||ids.has(c.id)||c.width!==1280||c.height!==720||typeof c.svg!=='string'||c.svg.length>100000||!/^<svg\b/i.test(c.svg.trim())||/<script\b|<foreignObject\b|\b(?:href|xlink:href)\s*=|url\s*\(\s*https?:/i.test(c.svg))throw new Error('Thumbnail Worker response failed SVG safety or concept validation');
  ids.add(c.id);
 }
 if(data.requiresHumanSelection!==true)throw new Error('Thumbnail Worker must require human concept selection');
 return data;
}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function approvalPayload(pkg,approval){
 const packageCore={...pkg};delete packageCore.approval;
 const approvalCore={...approval};delete approvalCore.packageHash;
 return JSON.stringify({package:packageCore,approval:approvalCore});
}
function createApproval(pkg,reviewer,checks={}){
 if(!clean(reviewer))throw new Error('A human reviewer name is required');
 const rights=checkRights(pkg.rightsLedger||[]);
 const compliance=pkg.compliance||complianceReview(pkg);
 const seo=checkSeo(pkg.seo||{});
 const chapter=checkChapters(pkg.seo?.chapters||[],Number(pkg.durationSeconds||0));
 if(!rights.passed)throw new Error('Rights review blocked: '+rights.errors.join('; '));
 if(!seo.passed)throw new Error('SEO metadata blocked: '+seo.errors.join('; '));
 if(!chapter.passed)throw new Error('Chapter review blocked: '+chapter.errors.join('; '));
 const required=['guidelines','advertiserSuitability','originality','reusedContent','inauthenticContent','claims','thumbnail','policyFlagsReviewed'];
 if(required.some(k=>checks[k]!==true))throw new Error('Every human review confirmation must be true');
 if(!pkg.finalVideo||!/^([a-f0-9]{64})$/i.test(String(pkg.finalVideoSha256||''))||!pkg.seo?.title||!pkg.seo?.description)throw new Error('Final video file hash and SEO metadata are required');
 if(!fs.existsSync(pkg.finalVideo))throw new Error('Final video file does not exist');
 if(sha256(fs.readFileSync(pkg.finalVideo))!==pkg.finalVideoSha256)throw new Error('Final video changed before approval');
 const approval={status:'approved_for_manual_upload_only',reviewer:clean(reviewer),approvedAt:new Date().toISOString(),checks:{guidelines:true,advertiserSuitability:true,originality:true,reusedContent:true,inauthenticContent:true,claims:true,thumbnail:true,policyFlagsReviewed:true,rights:true,chapters:true},publishingPermission:false,automatedUploadAllowed:false};
 approval.packageHash=sha256(approvalPayload(pkg,approval));
 return approval;
}
function verifyApproval(pkg,approval){
 if(!pkg.finalVideo||!pkg.finalVideoSha256||!fs.existsSync(pkg.finalVideo))return {valid:false,reason:'Approved final video file is missing'};
 if(sha256(fs.readFileSync(pkg.finalVideo))!==pkg.finalVideoSha256)return {valid:false,reason:'Final video file changed after approval'};
 if(!approval||approval.status!=='approved_for_manual_upload_only'||approval.publishingPermission!==false||approval.automatedUploadAllowed!==false||!clean(approval.reviewer)||!Number.isFinite(Date.parse(approval.approvedAt)))return {valid:false,reason:'No valid manual-upload approval'};
 const required=['guidelines','advertiserSuitability','originality','reusedContent','inauthenticContent','claims','thumbnail','policyFlagsReviewed','rights','chapters'];
 if(required.some(k=>approval.checks?.[k]!==true))return {valid:false,reason:'Approval is missing one or more human review confirmations'};
 const hash=sha256(approvalPayload(pkg,approval));
 return {valid:hash===approval.packageHash,reason:hash===approval.packageHash?'Approval matches current package and reviewer confirmations':'Package or approval record changed after approval; re-review required'};
}
function loadJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');}
module.exports={buildSeo,checkSeo,checkChapters,complianceReview,originalityReview,rightsLedger,importAssetManifest,checkRights,createApproval,verifyApproval,loadJson,writeJson,sha256,requestThumbnailConcepts,parseTimestamp,suggestChapters};
