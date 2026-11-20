'use strict';
const assert=require('node:assert/strict');
const {planShorts,makeSrt,scoreCandidate,normalizeTranscript}=require('../agents/production/shorts-factory');
const transcript=[];
const text='Why does this happen? The hidden truth is that researchers studied the evidence carefully. Their experiment showed a surprising result. Because the data changed everything, we should remember the lesson. ';
const tokens=text.trim().split(/\s+/);let t=0;
for(const token of tokens){const d=0.9;transcript.push({start:t,end:t+d,text:token});t+=d;}
const words=normalizeTranscript(transcript);assert.equal(words.length,tokens.length);
const plan=planShorts({transcript,count:3,minSeconds:20,maxSeconds:60,targetSeconds:28});
assert(plan.shorts.length>=1);assert(plan.shorts.every(s=>s.durationSeconds>=20&&s.durationSeconds<=60));
assert.equal(plan.aspectRatio,'9:16');assert(plan.shorts.every(s=>s.captionSrt.includes('-->')&&s.sourceProvenance));
assert(scoreCandidate('Why this truth is hidden. The research proves the result.',25).score>scoreCandidate('A list of ordinary words in a flat paragraph.',25).score);
assert(makeSrt(words).includes('00:00:00,000'));
assert.throws(()=>planShorts({transcript:[{start:0,end:1,text:'few'}]}),/word-level/);
console.log('PASS Shorts Factory highlight extraction, non-overlap, captions, 9:16 profile and provenance');
