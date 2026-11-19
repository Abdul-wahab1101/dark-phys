'use strict';
const assert=require('node:assert/strict');
const {ViralScriptGenerator,validateDraft}=require('../agents/viral-script-generator');
const pkg={topic:'Memory and human behavior',audience:'Documentary viewers',researchAgeDays:3,sources:[{id:'s1',title:'Memory research',url:'https://example.org/paper'}],claims:[{id:'c1',text:'Memory recall can be influenced by context.',sourceIds:['s1']}],narration:{en:'This is supplied English narration. '.repeat(8),'ur-Latn':'Yeh supplied Roman Urdu narration hai. '.repeat(8)},viralFactors:{audience_fit:4,demand_evidence:4,freshness:4,curiosity:5,story_depth:4,visual_potential:4,differentiation:4,evidence_quality:5,series_potential:3}};
const draft={titleOptions:['A','B','C'],hooks:['one','two','three'],narration:'A sourced narration. '.repeat(15),chapters:[{time:'0:00',title:'Open',purpose:'Hook'}],visualPlan:[{time:'0:00',visual:'Relevant footage',assetType:'stock'}],sourceReferences:[{sourceId:'s1',claimIds:['c1']}],claimsToVerify:['Check claim']};
assert.equal(validateDraft(draft,new Set(['s1'])).ok,true);
assert.equal(validateDraft({...draft,sourceReferences:[{sourceId:'unknown'}]},new Set(['s1'])).ok,false);
assert.equal(validateDraft({...draft,sourceReferences:[{sourceId:'s1',claimIds:['unknown-claim']}]},new Set(['s1']),new Set(['c1'])).ok,false);
const calls=[];
const fetchImpl=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(draft)}}]})};};
(async()=>{
 await assert.rejects(()=>new ViralScriptGenerator({apiKey:''}).generate(pkg),/DARK_PHYS_LLM_API_KEY/);
 const generator=new ViralScriptGenerator({apiKey:'test',model:'test-model',fetchImpl,timeoutMs:5000});
 const result=await generator.generate(pkg,{format:'short'});
 assert.equal(calls.length,2);assert.ok(result.scripts.en.validation.ok);assert.ok(result.scripts['ur-Latn'].validation.ok);
 assert.equal(result.approval.autoPublish,false);assert.match(calls[0].opts.headers.authorization,/Bearer test/);
 console.log('PASS script generator: provider-key guard, bilingual separate drafts, schema/source validation and no-auto-publish gate');
})().catch(e=>{console.error(e);process.exitCode=1;});
