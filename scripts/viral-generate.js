#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ViralScriptGenerator}=require('../agents/viral-script-generator');
async function main(argv=process.argv.slice(2)){
 const file=argv[0];
 if(!file||file==='--help'||file==='help'){
  console.log('Dark Phys bilingual AI script generation\nUsage: node scripts/viral-generate.js research-package.json [--short]\nRequires DARK_PHYS_LLM_API_KEY and DARK_PHYS_LLM_MODEL. Optional DARK_PHYS_LLM_BASE_URL. Generates separate English and Roman Urdu drafts; no publishing.');
  return 0;
 }
 const pkg=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
 const generator=new ViralScriptGenerator();
 const result=await generator.generate(pkg,{format:argv.includes('--short')?'short':'long-form'});
 const out=path.resolve(pkg.output||path.join('uploads','viral-intelligence','script-drafts-'+Date.now()+'.json'));
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output:out,topic:result.topic,format:result.format,languages:Object.keys(result.scripts),statuses:Object.fromEntries(Object.entries(result.scripts).map(([k,v])=>[k,v.status])),approval:result.approval.status},null,2));
 return 0;
}
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(e=>{console.error('Viral script generation error:',e.message);process.exitCode=1;});
module.exports={main};
