'use strict';
const assert=require('node:assert/strict');
const {scoreTopic,makeBrief,auditScript,WEIGHTS}=require('../agents/viral-intelligence-engine');
const base={title:'Why people doubt their own memory',audience:'Psychology documentary viewers',language:'en',researchAgeDays:5,
 factors:{audience_fit:5,demand_evidence:4,freshness:4,curiosity:5,story_depth:4,visual_potential:4,differentiation:4,evidence_quality:5,series_potential:3},
 evidence:[{title:'Peer-reviewed research',url:'https://example.org/research'}],
 competitors:[{title:'How memory works',url:'https://example.org/video',views:100000,ageDays:30}]};
const score=scoreTopic(base);
assert.equal(score.label,'PRIORITY_CANDIDATE');assert.equal(score.coverage,100);assert.equal(score.confidence,100);assert.ok(score.score>80);
assert.match(score.disclaimer,/not a prediction/i);
assert.throws(()=>scoreTopic({title:'x',factors:{curiosity:6}}),/between 0 and 5/);
assert.equal(scoreTopic({title:'x',factors:{curiosity:4}}).label,'NEEDS_MORE_EVIDENCE');
const brief=makeBrief(base,{format:'long',durationSec:600});
assert.equal(brief.hookBattle.length,5);assert.ok(brief.structure.length>=6);assert.equal(brief.safety.autoPublish,false);
assert.ok(brief.research.requiredBeforeScript.length>=4);assert.ok(brief.scriptBlueprint.requirements.some(x=>/imitate/i.test(x)));
const short=makeBrief(base,{format:'short'});assert.equal(short.durationSec,45);assert.ok(short.structure.some(x=>x.time==='0–2s'));
const audit=auditScript({script:'What if memory is not a perfect recording? '.repeat(35),claims:[{text:'A claim',sourceIds:[]}],sections:[]});
assert.equal(audit.readiness,'BLOCKED');assert.ok(audit.flags.some(x=>x.code==='UNSOURCED_CLAIMS'));
assert.ok(Object.keys(WEIGHTS).length>=8);
console.log('PASS Viral Intelligence: evidence scoring, confidence, briefs, Shorts, script audit and safety gates');
