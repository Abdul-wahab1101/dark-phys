'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {resolveChannelId}=require('../agents/production/v11-integration');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-channel-handoff-'));
try{
 const input=path.join(dir,'approved-script.json'),output=path.join(dir,'scene-plan.json');
 const pkg={topic:'A channel-specific documentary',channelId:'dark-phys-ur',editorialAngle:'How coercive control changes memory',templateId:'documentary-roman-urdu-v3',layoutId:'split-evidence',structureFingerprint:'scene-sequence-9f21',realisticSyntheticMedia:true,syntheticDisclosureDecision:'disclose',deceptiveRealScene:false,approval:{status:'approved'},scripts:{en:{status:'draft_requires_human_review',approvalStatus:'approved',sentenceVisuals:[{sentence:'A complete sentence for the opening scene.',visualIntent:'A person examining evidence',footageQuery:'person examining old photographs',sourceType:'stock_video',durationSeconds:4}]}}};
 fs.writeFileSync(input,JSON.stringify(pkg));
 const run=spawnSync(process.execPath,[path.join(root,'scripts/plan-scenes.js'),input,output,'--language=en'],{cwd:root,encoding:'utf8',timeout:30000});
 assert.equal(run.status,0,run.stderr||run.stdout);
 const plan=JSON.parse(fs.readFileSync(output,'utf8'));
 for(const [key,value] of Object.entries({channelId:'dark-phys-ur',editorialAngle:pkg.editorialAngle,templateId:pkg.templateId,layoutId:pkg.layoutId,structureFingerprint:pkg.structureFingerprint,realisticSyntheticMedia:true,syntheticDisclosureDecision:'disclose'}))assert.equal(plan[key],value,'scene-plan handoff must preserve '+key);
 assert.equal(resolveChannelId({plan}), 'dark-phys-ur','v11 must select the originating channel history, not unassigned');
 assert.equal(resolveChannelId({}), 'dark-phys-en','default history must match Phase 4 package default');
 console.log('PASS Script Engine -> Scene Planner -> v11 channel/originality metadata handoff');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
