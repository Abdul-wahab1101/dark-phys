'use strict';
const path=require('node:path');
const fs=require('node:fs');
const readline=require('node:readline');
const p=require('../agents/production/phase4-packaging');
function arg(name,fallback=''){const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];}
async function ask(question){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(resolve=>rl.question(question,a=>{rl.close();resolve(a.trim());}));}
async function main(){
 const command=process.argv[2],file=path.resolve(arg('file','uploads/phase4-package.json'));
 if(command==='thumbnails'){
  const result=await p.requestThumbnailConcepts(arg('endpoint'),process.env.CLOUDFLARE_THUMBNAIL_TOKEN,arg('title'),arg('subtitle'));
  const out=path.resolve(arg('output','uploads/thumbnail-concepts'));fs.mkdirSync(out,{recursive:true});p.writeJson(path.join(out,'concepts.json'),result);let sharp;try{sharp=require('sharp');}catch(_){throw new Error('Install sharp in the project root to convert SVG concepts to YouTube-ready PNG files');}for(const concept of result.concepts){await sharp(Buffer.from(concept.svg)).png().toFile(path.join(out,concept.id+'.png'));}console.log('Saved '+result.concepts.length+' PNG thumbnail concepts:',out);return;
 }
 if(command==='build'){
  const input=p.loadJson(file),pkg={...input,seo:p.buildSeo(input.seo||input),rightsLedger:p.rightsLedger(input.assets||input.rightsLedger||[]),compliance:p.complianceReview(input)};
  p.writeJson(file,pkg);console.log('Phase 4 package built:',file);console.log('Rights records:',pkg.rightsLedger.length,'; advisory flags:',pkg.compliance.flags.length);return;
 }
 if(command==='check'){
  const pkg=p.loadJson(file),rights=p.checkRights(pkg.rightsLedger||[]),seo=p.checkSeo(pkg.seo||{}),chapters=p.checkChapters(pkg.seo?.chapters||[],Number(pkg.durationSeconds||0)),compliance=pkg.compliance||p.complianceReview(pkg);
  const report={rights,seo,chapters,compliance,approval:p.verifyApproval(pkg,pkg.approval)};
  console.log(JSON.stringify(report,null,2));if(!rights.passed||!seo.passed||!chapters.passed)process.exitCode=2;return;
 }
 if(command==='approve'){
  const pkg=p.loadJson(file),reviewer=arg('reviewer')||await ask('Human reviewer full name/handle: ');
  const confirm=await ask('Type APPROVE only after watching the final video and reviewing rights, originality, claims, guidelines, ad suitability and thumbnail: ');
  if(confirm!=='APPROVE')throw new Error('Approval cancelled; no approval record written');
  const items=[['guidelines','Have you checked the complete video against Community Guidelines?'],['advertiserSuitability','Have you checked advertiser suitability across video, title and thumbnail?'],['originality','Does this add meaningful original value and commentary?'],['reusedContent','Have you checked reused-content risks and rights separately?'],['inauthenticContent','Is this not mass-produced or repetitively templated?'],['claims','Are factual claims and sources verified?'],['thumbnail','Is the selected thumbnail accurate and non-misleading?'],['policyFlagsReviewed','Have all automated warning flags been reviewed in context?']];
  const checks={};for(const [key,question] of items){checks[key]=(await ask(question+' Type YES to confirm: '))==='YES';if(!checks[key])throw new Error('Approval stopped: '+key+' was not confirmed');}
  pkg.approval=p.createApproval(pkg,reviewer,checks);p.writeJson(file,pkg);console.log('Approved for manual upload only. Automated publishing remains disabled.');return;
 }
 if(command==='verify'){
  const pkg=p.loadJson(file),result=p.verifyApproval(pkg,pkg.approval);console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=2;return;
 }
 console.log('Usage: node scripts/phase4-package.js thumbnails|build|check|approve|verify --file uploads/phase4-package.json [--reviewer name]');
}
main().catch(e=>{console.error('Phase 4:',e.message);process.exit(1);});
