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
  const out=path.resolve(arg('output','uploads/thumbnail-concepts.json'));p.writeJson(out,result);console.log('Saved '+result.concepts.length+' thumbnail concepts:',out);return;
 }
 if(command==='build'){
  const input=p.loadJson(file),pkg={...input,seo:p.buildSeo(input.seo||input),rightsLedger:p.rightsLedger(input.assets||input.rightsLedger||[]),compliance:p.complianceReview(input)};
  p.writeJson(file,pkg);console.log('Phase 4 package built:',file);console.log('Rights records:',pkg.rightsLedger.length,'; advisory flags:',pkg.compliance.flags.length);return;
 }
 if(command==='check'){
  const pkg=p.loadJson(file),rights=p.checkRights(pkg.rightsLedger||[]),chapters=p.checkChapters(pkg.seo?.chapters||[],Number(pkg.durationSeconds||0)),compliance=pkg.compliance||p.complianceReview(pkg);
  const report={rights,chapters,compliance,approval:p.verifyApproval(pkg,pkg.approval)};
  console.log(JSON.stringify(report,null,2));if(!rights.passed||!chapters.passed||!report.approval.valid)process.exitCode=2;return;
 }
 if(command==='approve'){
  const pkg=p.loadJson(file),reviewer=arg('reviewer')||await ask('Human reviewer full name/handle: ');
  const confirm=await ask('Type APPROVE only after watching the final video and reviewing rights, originality, claims, guidelines, ad suitability and thumbnail: ');
  if(confirm!=='APPROVE')throw new Error('Approval cancelled; no approval record written');
  const checks={guidelines:true,advertiserSuitability:true,originality:true,claims:true,thumbnail:true};
  pkg.approval=p.createApproval(pkg,reviewer,checks);p.writeJson(file,pkg);console.log('Approved for manual upload only. Automated publishing remains disabled.');return;
 }
 if(command==='verify'){
  const pkg=p.loadJson(file),result=p.verifyApproval(pkg,pkg.approval);console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=2;return;
 }
 console.log('Usage: node scripts/phase4-package.js thumbnails|build|check|approve|verify --file uploads/phase4-package.json [--reviewer name]');
}
main().catch(e=>{console.error('Phase 4:',e.message);process.exit(1);});
