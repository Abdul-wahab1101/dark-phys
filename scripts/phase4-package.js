'use strict';
const path=require('node:path');
const fs=require('node:fs');
const readline=require('node:readline');
const p=require('../agents/production/phase4-packaging');
const {buildPackagingTests}=require('../agents/production/packaging-experiments');
function loadLocalEnv(){
 for(const file of [path.resolve('.env'),path.resolve(__dirname,'../.env')]){
  if(!fs.existsSync(file))continue;
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
   const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
   if(!m||Object.prototype.hasOwnProperty.call(process.env,m[1]))continue;
   let value=m[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
   process.env[m[1]]=value;
  }
 }
}
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
  previousScripts:[],recentTemplateIds:[],templateId:'documentary-v1',
  finalVideo:'uploads/final.mp4',
  seo:{}
 };
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
  const ai=require('../agents/production/cloudflare-workers-ai');
  const result=await ai.generateThumbnailConcepts({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,textModel:process.env.CLOUDFLARE_TEXT_MODEL,imageModel:process.env.CLOUDFLARE_IMAGE_MODEL,title:arg('title'),subtitle:arg('subtitle'),outputDir:arg('output','uploads/thumbnail-concepts')});
  p.writeJson(path.join(path.resolve(arg('output','uploads/thumbnail-concepts')),'concepts.json'),result);
  console.log('Generated '+result.concepts.length+' Cloudflare AI thumbnail variations:',path.resolve(arg('output','uploads/thumbnail-concepts')));
  console.log('Review the three JPGs and manually select one. No automatic publishing.');
  return;
 }
 if(command==='build'){
  const input=p.loadJson(file);
  const manifestPath=arg('manifest',input.assetManifestFile||'');
  let assets=input.assets||input.rightsLedger||[];
  if(manifestPath)assets=p.importAssetManifest(p.loadJson(path.resolve(manifestPath)));
  else if(Array.isArray(input.assetManifest))assets=p.importAssetManifest(input.assetManifest);
  const pkg={...input,seo:p.buildSeo({...input,...(input.seo||{})}),rightsLedger:p.rightsLedger(assets)};
  pkg.packagingTests=buildPackagingTests({topic:input.topic,title:input.title,script:input.script,thumbnailConcepts:input.thumbnailConcepts||[],youtubeTestCompareAvailable:input.youtubeTestCompareAvailable===true,oauthAuthorized:input.youtubeAnalyticsOAuthAuthorized===true});
  if(manifestPath)pkg.importedAssetManifest=path.resolve(manifestPath);
  pkg.compliance=p.complianceReview({...input,...pkg.seo});
  p.writeJson(file,pkg);
  console.log('Phase 4 package built:',file);
  console.log('Rights records:',pkg.rightsLedger.length,'; advisory flags:',pkg.compliance.flags.length,'; originality comparisons:',pkg.compliance.originality.comparisons.length);
  console.log('All metadata, rights evidence and policy decisions still require human review.');
  return;
 }
 if(command==='check'){
  const pkg=p.loadJson(file),rights=p.checkRights(pkg.rightsLedger||[]),seo=p.checkSeo(pkg.seo||{}),chapters=p.checkChapters(pkg.seo?.chapters||[],Number(pkg.durationSeconds||0)),compliance=pkg.compliance||p.complianceReview(pkg);
  const approval=p.verifyApproval(pkg,pkg.approval);
  const report={rights,seo,chapters,compliance:{status:compliance.status,automatedScreening:compliance.automatedScreening,flags:compliance.flags,originality:compliance.originality,requiresHumanReview:true},approval,readyForHumanReview:rights.passed&&seo.passed&&chapters.passed};
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
   ['policyFlagsReviewed','Have all automated warning and similarity flags been reviewed in context?']
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
 console.log('Usage: node scripts/phase4-package.js init|thumbnails|build [--manifest uploads/stock-footage/asset-manifest.json]|check|approve|verify --file uploads/phase4-package.json [--reviewer name]');
}
main().catch(e=>{console.error('Phase 4:',e.message);process.exitCode=1;}).finally(()=>{if(approvalReadline)approvalReadline.close();});
