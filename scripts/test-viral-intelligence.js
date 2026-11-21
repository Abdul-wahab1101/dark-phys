'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {scoreTopic,makeBrief,auditScript,WEIGHTS}=require('../agents/viral-intelligence-engine');
const {prepareResearchPackage}=require('./viral-intelligence');
const base={title:'Why people doubt their own memory',audience:'Psychology documentary viewers',language:'en',researchAgeDays:5,
 factors:{audience_fit:5,demand_evidence:4,freshness:4,curiosity:5,story_depth:4,visual_potential:4,differentiation:4,evidence_quality:5,series_potential:3},
 evidence:[{title:'Peer-reviewed research',url:'https://example.org/research'}],
 competitors:[{title:'How memory works',url:'https://example.org/video',views:100000,ageDays:30}]};
const score=scoreTopic(base);
assert.equal(score.label,'PRIORITY_CANDIDATE');assert.equal(score.coverage,100);assert.equal(score.confidence,100);assert.ok(score.score>80);
assert.match(score.disclaimer,/not a prediction/i);
assert.throws(()=>scoreTopic({title:'x',factors:{curiosity:6}}),/between 0 and 5/);
assert.equal(scoreTopic({title:'x',factors:{curiosity:4}}).label,'NEEDS_MORE_EVIDENCE');
assert.equal(scoreTopic({...base,researchAgeDays:45}).label,'RESEARCH_REFRESH_REQUIRED');
const brief=makeBrief(base,{format:'long',durationSec:600});
assert.equal(brief.hookBattle.length,5);assert.ok(brief.structure.length>=6);assert.equal(brief.safety.autoPublish,false);
assert.ok(brief.research.requiredBeforeScript.length>=4);assert.ok(brief.scriptBlueprint.requirements.some(x=>/imitate/i.test(x)));
const short=makeBrief(base,{format:'short'});assert.equal(short.durationSec,45);assert.ok(short.structure.some(x=>x.time==='0–2s'));
const audit=auditScript({script:'What if memory is not a perfect recording? '.repeat(35),claims:[{text:'A claim',sourceIds:[]}],sections:[]});
assert.equal(audit.readiness,'BLOCKED');assert.ok(audit.flags.some(x=>x.code==='UNSOURCED_CLAIMS'));
const unknownSourceAudit=auditScript({script:'What if this is a useful example? '.repeat(30),sources:[{id:'known'}],claims:[{text:'A claim',sourceIds:['missing']}]});
assert.equal(unknownSourceAudit.readiness,'BLOCKED');
assert.ok(Object.keys(WEIGHTS).length>=8);
const research={topic:'Memory and human behavior',audience:'Psychology viewers',sources:[{id:'s1',title:'Research',url:'https://example.org/paper'}],claims:[{id:'c1',text:'Memory is reconstructive.',sourceIds:['s1']}],narration:{en:'A memory is not a perfect recording. Evidence suggests recall can be influenced by context.', 'ur-Latn':'Yaad-dasht aik perfect recording nahi hoti. Research ke mutabiq context yaad par asar dal sakta hai.'},viralFactors:{audience_fit:4,demand_evidence:3,freshness:4,curiosity:5,story_depth:4,visual_potential:4,differentiation:4,evidence_quality:5,series_potential:3}};
const integrated=prepareResearchPackage(research);
assert.ok(integrated.viralBrief && integrated.writerPrompts.en && integrated.writerPrompts['ur-Latn']);
assert.equal(integrated.approval.autoPublish,false);
assert.throws(()=>prepareResearchPackage({...research,viralFactors:undefined}),/will not invent scores/);
console.log('PASS Original Content Studio handoff, bilingual writer prompts and human approval gate');
console.log('PASS Viral Intelligence: evidence scoring, confidence, briefs, Shorts, script audit and safety gates');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-viral-'));
try {
 const topicFile=path.join(temp,'topic.json'),briefOut=path.join(temp,'brief.json');
 fs.writeFileSync(topicFile,JSON.stringify({...base,output:briefOut}));
 const cli=path.join(__dirname,'viral-intelligence.js');
 const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});
 assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/prepare research-package/);
 const briefRun=spawnSync(process.execPath,[cli,'brief',topicFile],{encoding:'utf8'});
 assert.equal(briefRun.status,0,briefRun.stderr);assert.ok(fs.existsSync(briefOut));
 const briefData=JSON.parse(fs.readFileSync(briefOut,'utf8'));
 assert.equal(briefData.brief.topic,base.title);assert.equal(briefData.brief.safety.autoPublish,false);
 const researchFile=path.join(temp,'research.json'),preparedOut=path.join(temp,'prepared.json');
 fs.writeFileSync(researchFile,JSON.stringify({...research,output:preparedOut}));
 const prepareRun=spawnSync(process.execPath,[cli,'prepare',researchFile],{encoding:'utf8'});
 assert.equal(prepareRun.status,0,prepareRun.stderr);assert.ok(fs.existsSync(preparedOut));
 const prepared=JSON.parse(fs.readFileSync(preparedOut,'utf8'));
 assert.equal(prepared.approval.autoPublish,false);assert.ok(prepared.writerPrompts['ur-Latn']);
 const badFile=path.join(temp,'bad.json');
 fs.writeFileSync(badFile,JSON.stringify({...research,narration:{en:'English only'},output:path.join(temp,'bad-out.json')}));
 const badRun=spawnSync(process.execPath,[cli,'prepare',badFile],{encoding:'utf8'});
 assert.notEqual(badRun.status,0);assert.match(badRun.stderr,/ur-Latn/);assert.ok(!fs.existsSync(path.join(temp,'bad-out.json')));
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log('PASS CLI end-to-end: help, brief generation, bilingual prepare, validation failure and safe output');

