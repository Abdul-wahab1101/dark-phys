'use strict';
const assert=require('node:assert/strict');
const semantic=require('../agents/production/semantic-similarity');
(async()=>{
 const paraphrase='A person who repeatedly experiences emotional pressure may begin to doubt their own memory and judgment.';
 const reworded='Ongoing psychological coercion can make someone question what they remember and whether their decisions are reliable.';
 const unrelated='A spacecraft uses solar panels to generate electricity while orbiting a distant planet.';
 const a=await semantic.embedText(paraphrase),b=await semantic.embedText(reworded),c=await semantic.embedText(unrelated);
 assert.equal(a.length,384,'MiniLM-L6-v2 must return a 384-dimensional embedding');
 const related=semantic.cosine(a,b),different=semantic.cosine(a,c);
 assert(related>different+0.12,'semantic model must rank a meaning-preserving paraphrase above unrelated content: '+related+' vs '+different);
 const result=await semantic.compareHistorySemantic({script:paraphrase,history:[{id:'paraphrase',script:reworded},{id:'unrelated',script:unrelated}]});
 assert.equal(result.model,semantic.MODEL_ID);assert.equal(result.comparisons[0].id,'paraphrase');assert(result.comparisons[0].score>result.comparisons[1].score);
 console.log('PASS real '+semantic.MODEL_ID+' embeddings, vector dimensions, paraphrase ranking and episode-history comparison');
})().catch(error=>{console.error(error);process.exit(1);});
