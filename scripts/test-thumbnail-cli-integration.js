'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {generateThumbnails}=require('./phase4-package');

(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-thumbnail-cli-'));
 try{
  const source=path.join(root,'source');fs.mkdirSync(source);
  const variants=['closeup','split','concept'].map((strategy,index)=>{
   const file=path.join(source,'candidate-'+index+'.jpg');fs.writeFileSync(file,Buffer.from('mock-jpeg-'+index));
   return {label:'Candidate '+(index+1),path:file,designFamilyId:'family-'+index,layoutClass:'layout-'+index,visualStrategyId:strategy,reviewPassed:true,reviewScore:90-index,hook:['WHO PULLS YOUR STRINGS?','THEY SEE TWO WORLDS','THE HIDDEN PATTERN'][index],qualityChecks:{valid:true}};
  });
  let received=null;
  const result=await generateThumbnails({
   title:'Why People Manipulate You',subtitle:'An evidence-led psychology documentary.',
   outputDir:path.join(root,'output'),workspacePath:path.join(root,'workspace'),
   agentFactory:()=>({generateThumbnail:async input=>{received=input;return{
    path:variants[0].path,variants,variantCount:3,recommendedCandidate:variants[0].label,
    comparison:variants.map((v,i)=>({rank:i+1,label:v.label,score:v.reviewScore,passed:true})),
    imageProvider:'cloudflare-workers-ai',qualityChecks:{allCandidatesPassedVisualGate:true,visionInspectionAvailable:true}
   };}})
  });
  assert.equal(received.title,'Why People Manipulate You');
  assert.equal(received.script,'An evidence-led psychology documentary.');
  assert.equal(received.workspacePath,path.join(root,'workspace'));
  assert.equal(result.variants.length,3);
  assert.equal(result.qualityChecks.allCandidatesPassedVisualGate,true);
  assert.deepEqual(result.variants.map(v=>v.visualStrategyId),['closeup','split','concept']);
  for(let i=0;i<3;i++)assert(fs.existsSync(path.join(root,'output','candidate-'+(i+1)+'.jpg')));
  const saved=JSON.parse(fs.readFileSync(path.join(root,'output','concepts.json'),'utf8'));
  assert.equal(saved.designVersion,'visual-review-v6');
  assert.equal(saved.recommendedCandidate,'Candidate 1');
  await assert.rejects(()=>generateThumbnails({
   title:'A second title',outputDir:path.join(root,'rejected'),
   agentFactory:()=>({generateThumbnail:async()=>({variants:[{...variants[0]},{...variants[1],reviewPassed:false},variants[2]],qualityChecks:{allCandidatesPassedVisualGate:false}})})
  }),/quality gate did not approve/);
  console.log('PASS Phase 4 thumbnails command integration: reviewed engine, 3 distinct strategies, file export, recommendation and weak-candidate refusal');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
