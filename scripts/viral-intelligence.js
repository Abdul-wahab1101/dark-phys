#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {buildReport}=require('../agents/viral-intelligence-engine');
const {buildWriterPrompt,validateResearch}=require('../agents/original-content-studio');
function usage(){console.log('Dark Phys Viral Intelligence Engine\\nUsage:\\n  node scripts/viral-intelligence.js brief topic.json [--short] [--language=en|ur-Latn]\\n  node scripts/viral-intelligence.js score topic.json\\n  node scripts/viral-intelligence.js audit script.json\\n  node scripts/viral-intelligence.js prepare research-package.json [--short]\\nInput topic JSON: {title,audience,language,researchAgeDays,factors:{...},evidence:[{title,url}],competitors:[{title,url,views,ageDays}],...}\\nScores are editorial prioritisation only, never viral/view predictions.');}
function prepareResearchPackage(input,format='long'){
 const validation=validateResearch(input);
 if(!validation.ok){const e=new Error('Original Content Studio research validation failed: '+validation.errors.join('; '));e.validation=validation;throw e;}
 if(!input.viralFactors||typeof input.viralFactors!=='object')throw new Error('Add researcher-rated viralFactors (0–5) to the package; the engine will not invent scores');
 const evidence=input.sources.map(s=>({title:s.title,url:s.url,publishedAt:s.publishedAt,accessedAt:s.accessedAt}));
 const brief=buildReport({title:input.topic,audience:input.audience,language:input.language||'en',researchAgeDays:input.researchAgeDays,factors:input.viralFactors,evidence,competitors:input.competitors||[]},{format}).brief;
 return {schemaVersion:1,topic:input.topic,viralBrief:brief,writerPrompts:{en:buildWriterPrompt(input,'en',format==='short'?'short':'long-form'),'ur-Latn':buildWriterPrompt(input,'ur-Latn',format==='short'?'short':'long-form')},sourceClaims:input.claims,approval:{status:'draft_requires_review',autoPublish:false,requiredGates:['source verification','fact check','originality','native-language review','rights review','final human approval']}};
}
function main(argv=process.argv.slice(2)){
 const [cmd,file]=argv;if(!cmd||cmd==='--help'||cmd==='help'){usage();return 0;}
 if(!file)throw new Error('Input JSON path is required');
 const input=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
 let result;
 if(cmd==='score'){result=buildReport(input).brief.editorialScore;}
 else if(cmd==='brief'){result=buildReport(input,{format:argv.includes('--short')?'short':'long',language:(argv.find(x=>x.startsWith('--language='))||'').split('=')[1]||undefined});}
 else if(cmd==='audit'){result=buildReport({title:input.topic||'Script audit',factors:{audience_fit:3}}, {script:input.script,claims:input.claims,sources:input.sources,sections:input.sections}).scriptAudit;}
 else if(cmd==='prepare'){result=prepareResearchPackage(input,argv.includes('--short')?'short':'long');}
 else throw new Error('Unknown command: '+cmd);
 const out=path.resolve(input.output||path.join('uploads','viral-intelligence',(input.title||input.topic||'topic').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60)+'-'+Date.now()+'.json'));
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output:out,command:cmd,summary:cmd==='score'?result:cmd==='brief'?{topic:result.brief.topic,score:result.brief.editorialScore,goNoGo:result.brief.goNoGo}:cmd==='prepare'?{topic:result.topic,score:result.viralBrief.editorialScore,approval:result.approval.status}:result.readiness},null,2));
 return 0;
}
if(require.main===module){try{process.exitCode=main();}catch(e){console.error('Viral Intelligence error:',e.message);process.exitCode=1;}}
module.exports={main,prepareResearchPackage};
