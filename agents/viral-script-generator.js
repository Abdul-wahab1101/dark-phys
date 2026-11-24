'use strict';
require('./local-secrets').loadLocalSecrets();
/**
 * Optional OpenAI-compatible script generation adapter.
 * Sends only the supplied research package and editorial brief to the configured provider.
 * Generated text is always an unverified draft; no publish/upload action exists here.
 */
const {buildWriterPrompt,validateResearch}=require('./original-content-studio');
const {makeBrief}=require('./viral-intelligence-engine');
const LANGS=['en','ur-Latn'];
function parseJson(text){
 const raw=String(text||'').trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
 try{return JSON.parse(raw);}catch(e){throw new Error('LLM response was not valid JSON: '+e.message);}
}
function validateDraft(draft,knownSourceIds,knownClaimIds=new Set()){
 const errors=[];
 if(!draft||typeof draft!=='object')return {ok:false,errors:['Draft must be a JSON object']};
 if(!Array.isArray(draft.titleOptions)||draft.titleOptions.filter(x=>typeof x==='string'&&x.trim()).length<3)errors.push('At least three non-empty titleOptions are required');
 if(!Array.isArray(draft.hooks)||draft.hooks.filter(x=>typeof x==='string'&&x.trim()).length<3)errors.push('At least three non-empty hooks are required');
 if(typeof draft.narration!=='string'||draft.narration.trim().length<200)errors.push('Narration is missing or too short');
 if(!Array.isArray(draft.chapters)||!draft.chapters.length)errors.push('Chapter/beat plan is required');
 if(!Array.isArray(draft.visualPlan)||!draft.visualPlan.length)errors.push('Visual plan is required');
 const refs=Array.isArray(draft.sourceReferences)?draft.sourceReferences:[];
 const unknown=refs.filter(x=>!knownSourceIds.has(String(x.sourceId)));
 if(unknown.length)errors.push('Draft references unknown source IDs: '+unknown.map(x=>x.sourceId).join(', '));
 const unknownClaims=refs.flatMap(x=>Array.isArray(x.claimIds)?x.claimIds:[]).filter(id=>knownClaimIds.size&&!knownClaimIds.has(String(id)));
 if(unknownClaims.length)errors.push('Draft references unknown claim IDs: '+unknownClaims.join(', '));
 if(!refs.length)errors.push('No sourceReferences returned; factual review cannot proceed');
 return {ok:errors.length===0,errors};
}
class ViralScriptGenerator{
 constructor({apiKey=process.env.DARK_PHYS_LLM_API_KEY,baseUrl=process.env.DARK_PHYS_LLM_BASE_URL||'https://api.openai.com/v1',model=process.env.DARK_PHYS_LLM_MODEL,accountId=process.env.CLOUDFLARE_ACCOUNT_ID,cloudflareToken=process.env.CLOUDFLARE_API_TOKEN,cloudflareModel=process.env.CLOUDFLARE_TEXT_MODEL||'@cf/openai/gpt-oss-20b',fetchImpl=globalThis.fetch,timeoutMs=120000}={}) {
  const geminiKeys=[process.env.GEMINI_API_KEY,process.env.GEMINI_API_KEY_2,process.env.GOOGLE_API_KEY].filter((v,i,a)=>v&&a.indexOf(v)===i);
  this.geminiKeys=geminiKeys; this.geminiCursor=0;
  this.apiKey=apiKey||(cloudflareToken&&accountId?cloudflareToken:''); this.baseUrl=String(baseUrl).replace(/\/$/,'');
  const requested=String(process.env.DARK_PHYS_LLM_PROVIDER||'').toLowerCase();
  const geminiSelected=requested==='gemini'||(!apiKey&&geminiKeys.length>0);
  this.model=geminiSelected?(process.env.GEMINI_SCRIPT_MODEL||'gemini-2.5-flash'):(model||cloudflareModel); this.accountId=accountId; this.cloudflareToken=cloudflareToken;
  this.provider=requested==='gemini'&&geminiKeys.length?'gemini':(apiKey?'openai-compatible':(geminiKeys.length?'gemini':(cloudflareToken&&accountId?'cloudflare-workers-ai':'openai-compatible')));
  this.fetch=fetchImpl; this.timeoutMs=timeoutMs;
 }
 async request(prompt,language) {
  if(this.provider==='gemini'&&!this.geminiKeys.length) throw new Error('Configure GEMINI_API_KEY (optionally GEMINI_API_KEY_2) locally');
  if(this.provider!=='gemini'&&!this.apiKey) throw new Error('Configure GEMINI_API_KEY, DARK_PHYS_LLM_API_KEY, or Cloudflare Account ID + API token locally');
  if(!this.model) throw new Error('DARK_PHYS_LLM_MODEL or CLOUDFLARE_TEXT_MODEL is not configured');
  if(typeof this.fetch!=='function') throw new Error('Node.js fetch is unavailable; use Node 18+');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  const messages=[
   {role:'system',content:'You are a rigorous documentary scriptwriter. Output JSON only. Never invent facts, studies, quotes, statistics, sources or cases. Use only supplied claims and sources. Keep all claims traceable. Generated work is an unverified draft for human review.'},
   {role:'user',content:prompt+'\n\nReturn the exact requested JSON schema. Do not include a claim unless supported by the supplied source register. Language must be '+(language==='ur-Latn'?'natural Pakistani Roman Urdu':'clear international English')+'.'}
  ];
  try {
   let response, body;
   if(this.provider==='gemini') {
    const errors=[];
    for(let i=0;i<this.geminiKeys.length;i++) {
     const index=(this.geminiCursor+i)%this.geminiKeys.length, key=this.geminiKeys[index];
     try {
      response=await this.fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(this.model)+':generateContent?key='+encodeURIComponent(key),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:'You are a rigorous documentary scriptwriter. Output valid JSON only. Never invent facts, studies, quotes, statistics, sources or cases. Use only supplied claims and sources. Generated work is an unverified draft for human review.'}]},contents:[{role:'user',parts:[{text:prompt+'\n\nReturn the exact requested JSON schema. Do not include a claim unless supported by the supplied source register. Language must be '+(language==='ur-Latn'?'natural Pakistani Roman Urdu':'clear international English')+'.'}]}],generationConfig:{temperature:0.55,responseMimeType:'application/json',maxOutputTokens:8192}}),signal:controller.signal});
      body=await response.json().catch(()=>({}));
      if(!response.ok) { const status=response.status; errors.push('HTTP '+status+': '+(body.error?.message||'Gemini request failed')); if(status===429||status>=500||status===403) continue; throw new Error(errors.join(' | ')); }
      const content=(body.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('\n').trim();
      if(!content) { errors.push('Gemini returned no text'); continue; }
      this.geminiCursor=(index+1)%this.geminiKeys.length; return parseJson(content);
     } catch(error) { if(controller.signal.aborted) throw error; errors.push(error.message); }
    }
    throw new Error('All configured Gemini keys failed: '+errors.join(' | '));
   }
   if(this.provider==='cloudflare-workers-ai') {
    const endpoint='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(this.accountId)+'/ai/run/'+this.model.split('/').map(encodeURIComponent).join('/');
    response=await this.fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+this.cloudflareToken,'content-type':'application/json'},body:JSON.stringify({messages,max_tokens:4096,temperature:0.55,response_format:{type:'json_object'}}),signal:controller.signal});
    body=await response.json().catch(()=>({}));
    if(!response.ok||body.success===false) throw new Error('Cloudflare Workers AI '+response.status+': '+(body.errors||[]).map(x=>x.message||x.code).join('; '));
    const result=body.result||{};
    const content=result.response||result.output_text||result.generated_text||result.text||result.choices?.[0]?.message?.content;
    if(!content) throw new Error('Cloudflare Workers AI returned no extractable text');
    return parseJson(typeof content==='string'?content:JSON.stringify(content));
   }
   response=await this.fetch(this.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+this.apiKey,'content-type':'application/json'},body:JSON.stringify({model:this.model,temperature:0.55,response_format:{type:'json_object'},messages}),signal:controller.signal});
   body=await response.json().catch(()=>({}));
   if(!response.ok) throw new Error('LLM provider '+response.status+': '+(body.error?.message||response.statusText));
   const content=body.choices?.[0]?.message?.content;
   if(!content) throw new Error('LLM provider returned an empty completion');
   return parseJson(content);
  } finally { clearTimeout(timer); }
 }
 async generate(pkg,{format='long-form',durationSec=600}={}){
  const validation=validateResearch(pkg);
  if(!validation.ok)throw new Error('Research package invalid: '+validation.errors.join('; '));
  const factors=pkg.viralFactors;
  if(!factors)throw new Error('Researcher-rated viralFactors are required; the model must not invent the topic score');
  const evidence=pkg.sources.map(s=>({title:s.title,url:s.url,publishedAt:s.publishedAt}));
  const brief=makeBrief({title:pkg.topic,audience:pkg.audience,language:'en',researchAgeDays:pkg.researchAgeDays,factors,evidence,competitors:pkg.competitors||[]},{format:format==='short'?'short':'long',durationSec});
  const known=new Set(pkg.sources.map(s=>String(s.id)));
  const results={};
  for(const lang of LANGS){
   const prompt=buildWriterPrompt(pkg,lang,format==='short'?'short':'long-form')+'\n\nVIRAL EDITORIAL BRIEF:\n'+JSON.stringify(brief)+'\n\nAUDIENCE: '+(pkg.audience||'channel audience')+'\nFORMAT: '+format+'; target duration '+(format==='short'?45:durationSec)+' seconds.\nWrite for strong viewer value and retention without misleading clickbait. Deliver all requested JSON fields.';
   const draft=await this.request(prompt,lang);
   const claimIds=new Set(pkg.claims.map((x,i)=>String(x.id||'claim-'+(i+1))));
   const checked=validateDraft(draft,known,claimIds);
   results[lang]={...draft,validation:checked,status:checked.ok?'draft_requires_human_review':'draft_blocked_for_revision'};
  }
  return {schemaVersion:1,engine:'Dark Phys Viral Intelligence Engine',topic:pkg.topic,format,createdAt:new Date().toISOString(),editorialBrief:brief,scripts:results,approval:{autoPublish:false,status:'human_review_required',requiredGates:['verify every factual claim against source context','review source-reference mapping','native-language editorial review','originality and reused-content review','media rights and policy review','approve final rendered video']},disclaimer:'AI-generated drafts and editorial scores do not predict virality or guarantee factual accuracy, retention, views or monetization.'};
 }
}
module.exports={ViralScriptGenerator,validateDraft,parseJson};
