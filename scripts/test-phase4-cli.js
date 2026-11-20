'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-phase4-cli-'));
const file=path.join(dir,'package.json');
const proof=path.join(dir,'pixabay-license-proof.txt');
const video=path.join(dir,'final.mp4');
function run(args,input=''){
 const result=spawnSync(process.execPath,[path.join(root,'scripts/phase4-package.js'),...args],{cwd:root,input,encoding:'utf8'});
 if(result.error)throw result.error;
 return result;
}
try{
 let result=run(['init','--file',file]);
 assert.equal(result.status,0,result.stderr);assert(fs.existsSync(file));
 result=run(['init','--file',file]);assert.notEqual(result.status,0,'init must never overwrite an existing package');
 const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
 fs.writeFileSync(proof,'Captured license summary and source rights review.');
 fs.writeFileSync(video,'test MP4 bytes for approval hash');
 Object.assign(pkg,{topic:'Memory and the Mind',title:'Why Memory Can Mislead You',description:'A clear documentary description about memory, evidence and the psychology behind everyday decisions.',tags:['memory','psychology'],durationSeconds:600,chapterBeats:['The central question','What research shows','Practical takeaway'],script:'This original documentary explains how memory can be influenced by context, stress and repeated suggestions, using sourced examples and practical explanations.',previousScripts:[],recentTemplateIds:[],templateId:'documentary-v1',finalVideo:video,assets:[{assetId:'clip-01',kind:'video',source:'Pixabay',sourceUrl:'https://pixabay.com/videos/example',creator:'Example Creator',license:'Pixabay Content License',licenseUrl:'https://pixabay.com/service/license-summary/',retrievedAt:new Date().toISOString(),proofPath:proof,commercialUseVerified:true,modifications:'Trimmed for the scene',attributionRequired:false,attributionReviewed:true,attributionText:'',reviewStatus:'approved'}]});
 fs.writeFileSync(file,JSON.stringify(pkg,null,2));
 result=run(['build','--file',file]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).packagingTests.variants.length,3,'Phase 4 build must include three script-matched title/thumbnail combinations');
 result=run(['check','--file',file]);assert.equal(result.status,0,result.stderr);
 const answers=['APPROVE',...Array(8).fill('YES')].join('\n')+'\n';
 result=run(['approve','--file',file,'--reviewer','phase4-cli-test'],answers);assert.equal(result.status,0,result.stderr+result.stdout);
 result=run(['verify','--file',file]);assert.equal(result.status,0,result.stderr+result.stdout);
 const approved=JSON.parse(fs.readFileSync(file,'utf8'));approved.seo.title+=' edited after approval';fs.writeFileSync(file,JSON.stringify(approved,null,2));
 result=run(['verify','--file',file]);assert.equal(result.status,2,'metadata edits must invalidate the approval');
 console.log('PASS Phase 4 CLI init/build/check/interactive human approval/verify and tamper rejection');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
