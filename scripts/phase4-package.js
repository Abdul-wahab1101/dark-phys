'use strict';
const path=require('node:path');
const fs=require('node:fs');
const readline=require('node:readline');
const p=require('../agents/production/phase4-packaging');
const {buildPackagingTests}=require('../agents/production/packaging-experiments');
const {loadLocalEnv}=require('../agents/production/local-env');
loadLocalEnv();

function arg(name,fallback=''){const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];}
let approvalReadline=null,approvalLines=null;
async function ask(question){if(!approvalReadline){approvalReadline=readline.createInterface({input:process.stdin,output:process.stdout});approvalLines=approvalReadline[Symbol.asyncIterator]();}process.stdout.write(question);const next=await approvalLines.next();if(next.done)throw new Error('Approval input ended before all confirmations were answered');return next.value.trim();}
function starterPackage(){
 return {
  topic:'Replace with the video topic',
  title:'Replace with an accurate video title',
  description:'Write a clear, accurate description of at least 50 characters. Summarise what viewers will actually learn.',
  tags:['replace-me'],
  durationSeconds:600,
  chapterBeats:['The central question','Evidence and explanation','Key takeaways'],
  assets:[{
   assetId:'replace-with-unique-asset-id',kind:'video or audio',source:'Provider or creator',sourceUrl:'https://example.com/source-page',
   creator:'Creator name or account',license:'Exact license name',licenseUrl:'https://example.com/license-terms',
   retrievedAt:new Date().toISOString(),proofPath:'uploads/rights-evidence/replace-with-proof.txt',
   commercialUseVerified:false,modifications:'Describe edits or state none',attributionRequired:false,attributionReviewed:false,attributionText:'',reviewStatus:'pending'
  }],
  script:'Paste the complete final narration/script for advisory screening and originality comparison.',
  channelId:'dark-phys-en',channelHistory:[],uploadHistory:[],scenes:[],
  realisticSyntheticMedia:false,syntheticDisclosureDecision:'not_applicable',deceptiveRealScene:false,
  audioAnalysis:{},previousScripts:[],recentTemplateIds:[],templateId:'documentary-v1',
  finalVideo:'uploads/final.mp4',
  seo:{}
 };
}
async function generateThumbnails({title,subtitle='',outputDir='uploads/thumbnail-concepts',workspacePath='',agentFactory}={}){
 if(!String(title||'').trim())throw new Error('A video title is required for thumbnail generation');
 const createAgent=agentFactory||(()=>{const {ThumbnailDesignerAgent}=require('../agents/thumbnail-designer-agent');return new ThumbnailDesignerAgent(null,{});});
 const agent=createAgent();
 const input={title:String(title).trim(),script:String(subtitle||'')};
 if(workspacePath)input.workspacePath=path.resolve(workspacePath);
 const result=await agent.generateThumbnail(input);
 if(!Array.isArray(result.variants)||result.variants.length!==3)throw new Error('Thumbnail engine must return exactly three reviewed candidates');
 const unique=(key)=>new Set(result.variants.map(v=>v[key]).filter(Boolean)).size;
 if(!result.variants.every(v=>v.reviewPassed===true)||result.qualityChecks?.allCandidatesPassedVisualGate!==true)throw new Error('Thumbnail quality gate did not approve all three candidates; refusing to export weak designs');
 if(unique('designFamilyId')!==3||unique('layoutClass')!==3||unique('visualStrategyId')!==3)throw new Error('Thumbnail candidates do not have three unique design families, layouts and visual strategies');
 const dir=path.resolve(outputDir);fs.mkdirSync(dir,{recursive:true});
 const variants=result.variants.map((variant,index)=>{
  if(!variant.path||!fs.existsSync(variant.path))throw new Error('Approved thumbnail image is missing: '+(variant.path||'unknown'));
  const destination=path.join(dir,'candidate-'+(index+1)+'.jpg');
  fs.copyFileSync(variant.path,destination);
  return {...variant,path:destination};
 });
 const saved={...result,path:variants[0].path,variants,outputDir:dir,provider:result.imageProvider||'thumbnail-designer-agent',designVersion:'visual-review-v6'};
 p.writeJson(path.join(dir,'concepts.json'),saved);
 return saved;
}

async function main(){
 const command=process.argv[2],file=path.resolve(arg('file','uploads/phase4-package.json'));
 if(command==='init'){
  if(fs.existsSync(file))throw new Error('Refusing to overwrite existing package: '+file);
  p.writeJson(file,starterPackage());
  console.log('Starter package created:',file);
  console.log('Replace every example value, add one evidence-backed rights record per asset, and create the referenced proof files.');
  return;
 }
 if(command==='thumbnails'){
  const result=await generateThumbnails({title:arg('title'),subtitle:arg('subtitle'),outputDir:arg('output','uploads/thumbnail-concepts'),workspacePath:arg('workspace')});
  console.log('Generated three approved, visually reviewed thumbnail candidates:',result.outputDir);
  console.log('Recommended:',result.recommendedCandidate,'| scores:',result.comparison.map(v=>v.score).join(', '));
  if(!result.qualityChecks.visionInspectionAvailable)console.log('WARNING: Cloudflare Vision was unavailable; technical/layout heuristics were used, not AI visual review.');
  console.log('Select the final thumbnail manually. No automatic publishing.');
  return;
 }
 if(command==='build'){
  const input=p.loadJson(file);
  const manifestPath=arg('manifest',input.assetManifestFile||'');
  let assets=input.assets||input.rightsLedger||[];
  if(manifestPath)assets=p.importAssetManifest(p.loadJson(path.resolve(manifestPath)));
  else if(Array.isArray(input.assetManifest))assets=p.importAssetManifest(input.assetManifest);
  const pkg={...input,seo:p.buildSeo({...input,...(input.seo||{})}),rightsLedger:p.rightsLedger(assets)};
  let thumbnailConcepts=Array.isArray(input.thumbnailConcepts)?input.thumbnailConcepts:[];
  const conceptsFile=path.resolve(arg('thumbnail-concepts','uploads/thumbnail-concepts/concepts.json'));
  if(!thumbnailConcepts.length&&fs.existsSync(conceptsFile)){const saved=p.loadJson(conceptsFile);thumbnailConcepts=Array.isArray(saved.concepts)?saved.concepts:[];}
  pkg.packagingTests=buildPackagingTests({topic:input.topic,title:input.title,script:input.script,thumbnailConcepts,youtubeTestCompareAvailable:input.youtubeTestCompareAvailable===true,oauthAuthorized:input.youtubeAnalyticsOAuthAuthorized===true});
  if(manifestPath)pkg.importedAssetManifest=path.resolve(manifestPath);
  pkg.compliance=p.complianceReview({...input,...pkg.seo});
  pkg.monetizationSafety=pkg.compliance.monetizationSafety;
  pkg.syntheticDisclosure={realisticSyntheticMedia:pkg.monetizationSafety.sections.syntheticMedia.realisticSyntheticMedia,decision:pkg.monetizationSafety.sections.syntheticMedia.disclosureDecision,required:pkg.monetizationSafety.sections.syntheticMedia.disclosureRequiredByReview,deceptiveRealScene:pkg.monetizationSafety.sections.syntheticMedia.deceptiveRealScene};
  pkg.sceneOriginalityChecklist=pkg.monetizationSafety.sections.sceneOriginality.scenes;
  const reportFiles=p.monetizationSafety.saveReport(pkg.monetizationSafety,path.join(path.dirname(file),'monetization-risk'));
  p.writeJson(file,pkg);
  console.log('Phase 4 package built:',file);
  console.log('Rights records:',pkg.rightsLedger.length,'; advisory flags:',pkg.compliance.flags.length,'; originality comparisons:',pkg.compliance.originality.comparisons.length);
  console.log('Monetization risk report:',reportFiles.markdownPath);
  console.log('Safety status:',pkg.monetizationSafety.status,'| auto-hold:',pkg.monetizationSafety.autoHold,'| stop batch:',pkg.monetizationSafety.stopBatch);
  console.log('All metadata, rights evidence and policy decisions still require human review.');
  if(pkg.monetizationSafety.autoHold){console.error('BATCH HOLD: high/critical risk detected; resolve flags before continuing.');process.exitCode=42;}
  return;
 }
 if(command==='check'){
  const pkg=p.loadJson(file),rights=p.checkRights(pkg.rightsLedger||[]),seo=p.checkSeo(pkg.seo||{}),chapters=p.checkChapters(pkg.seo?.chapters||[],Number(pkg.durationSeconds||0)),compliance=pkg.compliance||p.complianceReview(pkg);
  const approval=p.verifyApproval(pkg,pkg.approval);
  const safety=pkg.monetizationSafety||compliance.monetizationSafety||null;
  const report={rights,seo,chapters,compliance:{status:compliance.status,automatedScreening:compliance.automatedScreening,flags:compliance.flags,originality:compliance.originality,requiresHumanReview:true},monetizationSafety:safety,approval,readyForHumanReview:rights.passed&&seo.passed&&chapters.passed&&!safety?.autoHold};
  console.log(JSON.stringify(report,null,2));
  if(!report.readyForHumanReview)process.exitCode=2;
  return;
 }
 if(command==='approve'){
  const pkg=p.loadJson(file);
  if(!pkg.finalVideo)throw new Error('Package must include finalVideo path');
  pkg.finalVideo=path.resolve(pkg.finalVideo);
  if(!fs.existsSync(pkg.finalVideo))throw new Error('Final video file not found: '+pkg.finalVideo);
  pkg.finalVideoSha256=p.sha256(fs.readFileSync(pkg.finalVideo));
  const reviewer=arg('reviewer')||await ask('Human reviewer full name/handle: ');
  const confirm=await ask('Type APPROVE only after watching the final video and reviewing rights, originality, claims, guidelines, ad suitability and thumbnail: ');
  if(confirm!=='APPROVE')throw new Error('Approval cancelled; no approval record written');
  const items=[
   ['guidelines','Have you checked the complete video against current Community Guidelines?'],
   ['advertiserSuitability','Have you checked advertiser suitability across video, narration, title and thumbnail?'],
   ['originality','Does this add meaningful original value, explanation or commentary?'],
   ['reusedContent','Have you checked reused-content risks and rights separately?'],
   ['inauthenticContent','Have you checked that this is not mass-produced or repetitively templated?'],
   ['claims','Are factual claims and sources verified?'],
   ['thumbnail','Is the selected thumbnail accurate, readable and non-misleading?'],
   ['policyFlagsReviewed','Have all automated warning and similarity flags been reviewed in context?'],
   ['sceneOriginality','Have you reviewed every scene for original contribution, purpose, rights and viewer value?'],
   ['syntheticDisclosure','Have you confirmed the synthetic-media disclosure decision and checked for deceptive real-scene depictions?']
  ];
  const checks={};
  for(const [key,question] of items){checks[key]=(await ask(question+' Type YES to confirm: '))==='YES';if(!checks[key])throw new Error('Approval stopped: '+key+' was not confirmed');}
  pkg.approval=p.createApproval(pkg,reviewer,checks);p.writeJson(file,pkg);
  console.log('Approved for manual upload only. Automated publishing remains disabled.');
  return;
 }
 if(command==='verify'){
  const pkg=p.loadJson(file),result=p.verifyApproval(pkg,pkg.approval);
  console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=2;return;
 }
 console.log('Usage: node scripts/phase4-package.js init|thumbnails|build [--manifest uploads/stock-footage/asset-manifest.json]|check|approve|verify --file uploads/phase4-package.json [--reviewer name] [--thumbnail-concepts uploads/thumbnail-concepts/concepts.json]');
}
if(require.main===module)main().catch(e=>{console.error('Phase 4:',e.message);process.exitCode=1;}).finally(()=>{if(approvalReadline)approvalReadline.close();});
module.exports={main,generateThumbnails};
